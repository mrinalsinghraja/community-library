import "server-only";

import type { AuthTokenType, Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { generateToken, hashIdentifier, hashToken } from "@/server/lib/crypto";

/**
 * Activation and password-reset tokens.
 *
 * Properties, all of which have tests:
 *   • 32 random bytes from a CSPRNG — 256 bits, not guessable
 *   • only the SHA-256 is stored, so a database dump yields no usable links
 *   • single use: consuming one marks it, and a second attempt fails
 *   • time limited, per type
 *   • issuing a new one revokes any live token of the same type for that user,
 *     so an old email cannot be used after a fresh link is requested
 *   • revoked, consumed and expired are three distinct states, because the
 *     audit trail needs to tell "cancelled" from "used twice"
 *
 * The raw token exists in exactly one place: the link inside the email. It is
 * never logged, never audited, and never stored.
 */

export const TOKEN_LIFETIME = {
  /** A parent may not open the email until the weekend. */
  ACTIVATION: { hours: 24 * 7, label: "7 days" },
  /** Short: it is a live path to taking over an account. */
  PASSWORD_RESET: { hours: 2, label: "2 hours" },
} as const satisfies Record<AuthTokenType, { hours: number; label: string }>;

type Db = Prisma.TransactionClient | typeof prisma;

export interface MintedToken {
  /** Put this in the email link. Nowhere else, ever. */
  rawToken: string;
  expiresAt: Date;
  tokenId: string;
}

/**
 * Issues a token, revoking any live token of the same type for that user.
 *
 * Pass the transaction client when minting as part of a larger change, so a
 * failed approval does not leave a live activation link behind.
 */
export async function mintToken(
  db: Db,
  params: {
    userId: string;
    type: AuthTokenType;
    createdById?: string | null;
    requestIp?: string | null;
  },
): Promise<MintedToken> {
  const { hours } = TOKEN_LIFETIME[params.type];
  const rawToken = generateToken(32);
  const expiresAt = new Date(Date.now() + hours * 3_600_000);

  // Only the newest link works. A parent who asks for a second reset email must
  // not leave the first one live in their inbox.
  await db.authToken.updateMany({
    where: {
      userId: params.userId,
      type: params.type,
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const created = await db.authToken.create({
    data: {
      userId: params.userId,
      type: params.type,
      tokenHash: hashToken(rawToken),
      expiresAt,
      createdById: params.createdById ?? null,
      requestedIpHash: params.requestIp ? hashIdentifier(params.requestIp) : null,
    },
  });

  return { rawToken, expiresAt, tokenId: created.id };
}

export type TokenRejection =
  | "NOT_FOUND"
  | "EXPIRED"
  | "ALREADY_USED"
  | "REVOKED"
  | "USER_UNAVAILABLE";

export type TokenLookup =
  | { ok: true; tokenId: string; userId: string }
  | { ok: false; reason: TokenRejection };

/**
 * Validates a token without consuming it — used to decide whether to render the
 * "choose a password" form at all.
 *
 * Every failure returns the same shape; the caller shows one generic message.
 * A visitor must not learn whether a link is unknown, spent or merely stale.
 */
export async function inspectToken(
  rawToken: string,
  type: AuthTokenType,
): Promise<TokenLookup> {
  if (!rawToken || rawToken.length < 16) return { ok: false, reason: "NOT_FOUND" };

  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!token || token.type !== type) return { ok: false, reason: "NOT_FOUND" };

  // Counted whether or not it succeeds: a spike of attempts against a spent
  // token is exactly the signal worth being able to see.
  await prisma.authToken.update({
    where: { id: token.id },
    data: { attemptCount: { increment: 1 } },
  });

  if (token.revokedAt) return { ok: false, reason: "REVOKED" };
  if (token.consumedAt) return { ok: false, reason: "ALREADY_USED" };
  if (token.expiresAt <= new Date()) return { ok: false, reason: "EXPIRED" };

  // A suspended or deactivated account cannot be activated or reset into.
  if (token.user.status === "SUSPENDED" || token.user.status === "DEACTIVATED" ||
      token.user.status === "ARCHIVED") {
    return { ok: false, reason: "USER_UNAVAILABLE" };
  }

  return { ok: true, tokenId: token.id, userId: token.user.id };
}

/**
 * Consumes a token atomically.
 *
 * The `consumedAt: null` in the WHERE clause is what makes this single-use even
 * under a double submit: the second update matches zero rows, and the caller is
 * told the link is spent. A read-then-write check would have a race here.
 */
export async function consumeToken(
  db: Db,
  tokenId: string,
): Promise<boolean> {
  const { count } = await db.authToken.updateMany({
    where: { id: tokenId, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  return count === 1;
}

/** Cancels every live token of a type — used when staff reissue a link. */
export async function revokeTokens(
  db: Db,
  userId: string,
  type: AuthTokenType,
): Promise<number> {
  const { count } = await db.authToken.updateMany({
    where: { userId, type, consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}
