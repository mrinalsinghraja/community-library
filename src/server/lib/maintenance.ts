import "server-only";

import { prisma } from "@/server/db";
import { pruneExpiredSessions } from "@/server/auth/session-store";
import { pruneOldLoginAttempts } from "@/server/lib/rate-limit";
import { sweepPendingMedia } from "@/server/services/media-service";
import {
  sendCirculationReminders,
  type ReminderRunResult,
} from "@/server/services/notification-service";

/**
 * Daily housekeeping.
 *
 * Hygiene first — expired sessions, spent tokens, stale throttling rows,
 * unclaimed uploads — and then, since Phase 4, the one thing this job does that
 * somebody outside the building notices: due-soon and overdue reminders.
 *
 * **Nothing here decides anything about a book.** Overdue is always derived
 * from `due_at < now()` at read time, so a day when this job fails to run
 * cannot leave the library believing something untrue. It leaves a few dead
 * rows behind and one morning's reminders unsent, and both of those are
 * visible: the run's result says what it did.
 *
 * The reminder pass is deliberately last and deliberately isolated. It is the
 * only step that talks to a mail server, and a mail server having a bad morning
 * must not stop the library's own housekeeping.
 */

export interface MaintenanceResult {
  expiredSessionsRemoved: number;
  spentTokensRemoved: number;
  oldLoginAttemptsRemoved: number;
  expiredVerificationChallenges: number;
  mediaPurged: number;
  mediaFailed: number;
  mediaNeedsAttention: number;
  reminders: ReminderRunResult;
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

  /*
   * Reminders last, and never fatal.
   *
   * If this throws — a mail provider misconfigured, a template failing to
   * render — the housekeeping above has already happened and its result is
   * still worth returning. The error is logged, the run reports zero sent, and
   * nobody's loan has changed, because this pass cannot write to one.
   */
  let reminders: ReminderRunResult;
  try {
    reminders = await sendCirculationReminders();
  } catch (error) {
    console.error("[maintenance] reminder pass failed:", error);
    reminders = { enabled: true, due: 0, sent: 0, failed: 0, alreadySent: 0, noRecipient: 0 };
  }

  return {
    expiredSessionsRemoved,
    spentTokensRemoved,
    oldLoginAttemptsRemoved,
    expiredVerificationChallenges,
    mediaPurged: media.purged,
    mediaFailed: media.failed,
    mediaNeedsAttention: media.needsAttention,
    reminders,
  };
}
