import "server-only";

import { prisma } from "@/server/db";
import { pruneExpiredSessions } from "@/server/auth/session-store";
import { pruneOldLoginAttempts } from "@/server/lib/rate-limit";
import { sweepPendingMedia } from "@/server/services/media-service";

/**
 * Daily housekeeping.
 *
 * Phase 0 scope is hygiene only: expired sessions, spent tokens, and stale
 * throttling rows. Overdue reminders join this job in a later phase.
 *
 * Nothing here decides anything. Overdue status in particular is always derived
 * from `due_at < now()` at read time, so a day when this job fails to run
 * cannot leave the library believing something untrue — it only leaves a few
 * dead rows behind.
 */

export interface MaintenanceResult {
  expiredSessionsRemoved: number;
  spentTokensRemoved: number;
  oldLoginAttemptsRemoved: number;
  expiredVerificationChallenges: number;
  mediaPurged: number;
  mediaFailed: number;
  mediaNeedsAttention: number;
}

/**
 * Expires guardian verification challenges nobody answered.
 *
 * The read path already treats a lapsed challenge as lapsed, so this is
 * housekeeping rather than enforcement — but it also clears the token hash,
 * which is what stops a very old link ever being matched again.
 */
export async function expireVerificationChallenges(): Promise<number> {
  const { count } = await prisma.guardianVerification.updateMany({
    where: { status: "PENDING", challengeExpiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", challengeTokenHash: null },
  });
  return count;
}

/**
 * Deletes activation and password-reset tokens that are expired or already
 * used. A consumed token is kept briefly so that a second click on an emailed
 * link can be told apart from an attack, then removed.
 */
export async function pruneAuthTokens(consumedRetentionDays = 7): Promise<number> {
  const { count } = await prisma.authToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { consumedAt: { lt: new Date(Date.now() - consumedRetentionDays * 86_400_000) } },
      ],
    },
  });
  return count;
}

export async function runDailyMaintenance(): Promise<MaintenanceResult> {
  const [
    expiredSessionsRemoved,
    spentTokensRemoved,
    oldLoginAttemptsRemoved,
    expiredVerificationChallenges,
  ] = await Promise.all([
    pruneExpiredSessions(),
    pruneAuthTokens(),
    pruneOldLoginAttempts(),
    expireVerificationChallenges(),
  ]);

  /*
   * The media sweep is the reconciliation half of the photo lifecycle: it
   * collects uploads nobody claimed and objects whose immediate deletion
   * failed. Run last and on its own, because it talks to the object store and
   * is the only step here that can be slow.
   *
   * It is a safety net, not the primary path — removal and replacement already
   * delete the bytes inline. A day when this does not run leaves a private
   * photograph in storage slightly longer, which is exactly why it is a daily
   * job and not a weekly one.
   */
  const media = await sweepPendingMedia();

  return {
    expiredSessionsRemoved,
    spentTokensRemoved,
    oldLoginAttemptsRemoved,
    expiredVerificationChallenges,
    mediaPurged: media.purged,
    mediaFailed: media.failed,
    mediaNeedsAttention: media.needsAttention,
  };
}
