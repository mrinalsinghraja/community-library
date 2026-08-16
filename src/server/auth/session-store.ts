import "server-only";

import type { UserKind, UserStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { generateToken, hashToken, hashIdentifier } from "@/server/lib/crypto";

/**
 * Server-side session records.
 *
 * Why this exists rather than Auth.js's built-in database sessions:
 * the Credentials provider in Auth.js v5 always issues a JWT cookie and never
 * calls `adapter.createSession` — verified in @auth/core's callback handler.
 * Native database sessions are therefore unavailable to any password login.
 *
 * So the cookie carries an *opaque random handle* and nothing else: no roles, no
 * permissions, no identity claims. Every request resolves that handle against
 * this table, re-reads the user's current status, and re-computes permissions.
 * That gives the property the requirement actually asks for — suspending an
 * account kills its live sessions on the very next request — while working
 * within the provider's constraints. See ADR-009 in docs/ARCHITECTURE_DECISIONS.md.
 *
 * Only the SHA-256 of the handle is stored, so a database dump yields no usable
 * sessions.
 */

/**
 * Staff sessions are short because staff act on children's data, often on a
 * device in a shared room. Member sessions are longer because a child logging in
 * repeatedly on a family tablet is a support burden, and the blast radius of a
 * member session is that child's own borrowing history.
 */
export const SESSION_TTL = {
  STAFF: { idleMinutes: 8 * 60, absoluteMinutes: 12 * 60 },
  MEMBER: { idleMinutes: 24 * 60, absoluteMinutes: 7 * 24 * 60 },
  GUARDIAN: { idleMinutes: 60, absoluteMinutes: 12 * 60 },
} as const satisfies Record<UserKind, { idleMinutes: number; absoluteMinutes: number }>;

/** Only refresh idle expiry if it has moved on meaningfully — avoids a write per request. */
const IDLE_REFRESH_THRESHOLD_MS = 5 * 60_000;

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface ResolvedSessionUser {
  sessionId: string;
  userId: string;
  libraryId: string;
  kind: UserKind;
  status: UserStatus;
  displayName: string;
  mustSetPassword: boolean;
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Creates a session and returns the raw handle for the cookie. The raw value is
 * never persisted and never logged.
 */
export async function createSession(
  userId: string,
  kind: UserKind,
  context: SessionContext = {},
): Promise<string> {
  const ttl = SESSION_TTL[kind];
  const rawToken = generateToken(32);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: minutesFromNow(ttl.absoluteMinutes),
      idleExpiresAt: minutesFromNow(ttl.idleMinutes),
      userAgentHash: context.userAgent ? hashIdentifier(context.userAgent) : null,
      ipHash: context.ip ? hashIdentifier(context.ip) : null,
    },
  });

  return rawToken;
}

/**
 * Resolves a raw session handle to its user, or null.
 *
 * Returns null — meaning "signed out" — when the session is unknown, revoked,
 * past either expiry, or when the user is no longer ACTIVE. The status check is
 * what makes suspension take effect immediately.
 */
export async function resolveSession(rawToken: string): Promise<ResolvedSessionUser | null> {
  if (!rawToken) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      user: {
        select: {
          id: true,
          libraryId: true,
          kind: true,
          status: true,
          displayName: true,
          mustSetPassword: true,
        },
      },
    },
  });

  if (!session) return null;

  const now = new Date();
  const isExpired =
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.idleExpiresAt <= now;

  if (isExpired) {
    // Clean up eagerly so the table does not accumulate dead rows.
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  // A suspended, deactivated or not-yet-activated account has no valid session.
  if (session.user.status !== "ACTIVE") {
    await prisma.session.deleteMany({ where: { userId: session.user.id } });
    return null;
  }

  await refreshIdleExpiry(session.id, session.idleExpiresAt, session.expiresAt, session.user.kind);

  return {
    sessionId: session.id,
    userId: session.user.id,
    libraryId: session.user.libraryId,
    kind: session.user.kind,
    status: session.user.status,
    displayName: session.user.displayName,
    mustSetPassword: session.user.mustSetPassword,
  };
}

async function refreshIdleExpiry(
  sessionId: string,
  currentIdleExpiry: Date,
  absoluteExpiry: Date,
  kind: UserKind,
): Promise<void> {
  const ttl = SESSION_TTL[kind];

  // Clamp to absolute expiry. Without this, a session late in its absolute life
  // would try to push idle expiry beyond it and violate the database constraint
  // session_idle_within_absolute — turning a routine page load into a 500.
  const nextIdleExpiry = new Date(
    Math.min(minutesFromNow(ttl.idleMinutes).getTime(), absoluteExpiry.getTime()),
  );

  if (nextIdleExpiry.getTime() - currentIdleExpiry.getTime() < IDLE_REFRESH_THRESHOLD_MS) {
    return;
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date(), idleExpiresAt: nextIdleExpiry },
  });
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

/**
 * Revokes every session for a user. Called when an account is suspended or
 * deactivated, and after a password change or reset.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

/** Housekeeping for the daily job. */
export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { idleExpiresAt: { lt: new Date() } }] },
  });
  return count;
}
