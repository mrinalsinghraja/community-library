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

  /**
   * Presenting an activation or reset link. Generous on purpose: a parent
   * clicking an emailed link three times because the first tap did not seem to
   * work is normal behaviour, not an attack. This exists to stop token
   * guessing, and a 256-bit token cannot be guessed anyway — this is the second
   * lock, not the first.
   */
  tokenAttemptsMax: 20,
  tokenAttemptsWindowMinutes: 60,

  /**
   * Password-reset requests per IP. Low, because each one sends an email to a
   * guardian and mail sent to families is not a resource to be spent freely.
   */
  passwordResetRequestsMax: 5,
  passwordResetWindowMinutes: 60,

  /**
   * Delivery tests per administrator, counted two ways.
   *
   * `emailTestsMax` counts only the tests that **actually left**, because those
   * are the ones that spend a message out of the same daily allowance the
   * families' activation links come out of.
   *
   * `emailTestAttemptsMax` counts every press, and exists only to stop a script
   * hammering the button. It is deliberately far looser: a refused send costs
   * the allowance nothing, and the moment somebody is setting the transport up
   * for the first time is exactly when they need to press this repeatedly —
   * change a key, press, read the reason, change something else, press again.
   * Locking them out mid-diagnosis with "that was a lot of tries" is the
   * software getting in the way of the one job this button has.
   */
  emailTestsMax: 5,
  emailTestAttemptsMax: 30,
  emailTestWindowMinutes: 60,
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

/**
 * A generic named throttle bucket, reusing the login_attempt table.
 *
 * `bucket` namespaces the counter (e.g. "token-attempt", "password-reset") so
 * that exhausting one does not lock a family out of another. The subject is
 * hashed, never stored raw.
 */
export async function checkActionThrottle(params: {
  bucket: string;
  subject: string | null;
  max: number;
  windowMinutes: number;
}): Promise<ThrottleDecision> {
  if (!params.subject) return ALLOWED;

  const used = await prisma.loginAttempt.count({
    where: {
      identifierHash: hashIdentifier(`${params.bucket}:${params.subject}`),
      attemptedAt: { gte: minutesAgo(params.windowMinutes) },
    },
  });

  if (used >= params.max) {
    return { allowed: false, retryAfterSeconds: params.windowMinutes * 60 };
  }
  return ALLOWED;
}

export async function recordAction(bucket: string, subject: string | null): Promise<void> {
  if (!subject) return;
  await prisma.loginAttempt.create({
    data: {
      identifierHash: hashIdentifier(`${bucket}:${subject}`),
      ipHash: hashIdentifier(subject),
      succeeded: true,
    },
  });
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
