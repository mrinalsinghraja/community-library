import "server-only";

import { prisma } from "@/server/db";
import { hashIdentifier } from "@/server/lib/crypto";

/**
 * Login throttling, backed by the database.
 *
 * Deliberately no Redis: adding a second datastore to a free community library
 * would be real infrastructure for a load measured in tens of logins per week.
 * The `login_attempt` table with an index on (identifier_hash, attempted_at) is
 * entirely adequate here, and it disappears with the database backup rather than
 * being a separate thing to operate.
 *
 * Two independent limits:
 *   • per identifier — stops someone grinding one child's card code
 *   • per IP         — stops someone sweeping many codes from one place
 */

export const RATE_LIMITS = {
  /** Failures against one identifier before it locks. */
  identifierMaxFailures: 5,
  identifierWindowMinutes: 15,
  identifierLockMinutes: 15,

  /** Failures from one IP across all identifiers. */
  ipMaxFailures: 20,
  ipWindowMinutes: 60,

  /** Public form submissions (registration) per IP. */
  publicFormMaxSubmissions: 5,
  publicFormWindowMinutes: 60,
} as const;

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * Checks whether a login attempt may proceed. Call before verifying a password,
 * so that a locked account costs an attacker a query rather than a hash.
 */
export async function checkLoginThrottle(
  identifier: string,
  ip: string | null,
): Promise<ThrottleDecision> {
  const identifierHash = hashIdentifier(identifier);

  const recentIdentifierFailures = await prisma.loginAttempt.count({
    where: {
      identifierHash,
      succeeded: false,
      attemptedAt: { gte: minutesAgo(RATE_LIMITS.identifierWindowMinutes) },
    },
  });

  if (recentIdentifierFailures >= RATE_LIMITS.identifierMaxFailures) {
    return {
      allowed: false,
      retryAfterSeconds: RATE_LIMITS.identifierLockMinutes * 60,
    };
  }

  if (ip) {
    const recentIpFailures = await prisma.loginAttempt.count({
      where: {
        ipHash: hashIdentifier(ip),
        succeeded: false,
        attemptedAt: { gte: minutesAgo(RATE_LIMITS.ipWindowMinutes) },
      },
    });

    if (recentIpFailures >= RATE_LIMITS.ipMaxFailures) {
      return { allowed: false, retryAfterSeconds: RATE_LIMITS.ipWindowMinutes * 60 };
    }
  }

  return ALLOWED;
}

/** Records the outcome of a login attempt. Identifier and IP are never stored raw. */
export async function recordLoginAttempt(params: {
  identifier: string;
  ip: string | null;
  succeeded: boolean;
  libraryId?: string | null;
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      identifierHash: hashIdentifier(params.identifier),
      ipHash: params.ip ? hashIdentifier(params.ip) : null,
      succeeded: params.succeeded,
      libraryId: params.libraryId ?? null,
    },
  });
}

/** Rate limit for unauthenticated form submissions such as /join. */
export async function checkPublicFormThrottle(ip: string | null): Promise<ThrottleDecision> {
  if (!ip) return ALLOWED;

  const recent = await prisma.loginAttempt.count({
    where: {
      ipHash: hashIdentifier(`public-form:${ip}`),
      attemptedAt: { gte: minutesAgo(RATE_LIMITS.publicFormWindowMinutes) },
    },
  });

  if (recent >= RATE_LIMITS.publicFormMaxSubmissions) {
    return { allowed: false, retryAfterSeconds: RATE_LIMITS.publicFormWindowMinutes * 60 };
  }
  return ALLOWED;
}

export async function recordPublicFormSubmission(ip: string | null): Promise<void> {
  if (!ip) return;
  await prisma.loginAttempt.create({
    data: {
      identifierHash: hashIdentifier(`public-form:${ip}`),
      ipHash: hashIdentifier(ip),
      succeeded: true,
    },
  });
}

/**
 * Housekeeping for the daily job. Attempts older than the longest window have no
 * further purpose, and keeping hashed IPs longer than they are useful would be
 * collecting data for its own sake.
 */
export async function pruneOldLoginAttempts(olderThanDays = 30): Promise<number> {
  const { count } = await prisma.loginAttempt.deleteMany({
    where: { attemptedAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) } },
  });
  return count;
}
