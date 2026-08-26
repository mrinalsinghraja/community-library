import "server-only";

import { retireGrownUpReaders, type GrowingUpResult } from "@/server/lib/growing-up";
import { prisma } from "@/server/db";
import { pruneExpiredSessions } from "@/server/auth/session-store";
import { pruneOldLoginAttempts } from "@/server/lib/rate-limit";
import { runRetentionPass, type RetentionResult } from "@/server/lib/retention";
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
  /** Readers retired because they have grown out of the library's age range. */
  grownUpRetired: number;
  expiredSessionsRemoved: number;
  spentTokensRemoved: number;
  oldLoginAttemptsRemoved: number;
  expiredVerificationChallenges: number;
  mediaPurged: number;
  mediaFailed: number;
  mediaNeedsAttention: number;
  retention: RetentionResult;
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
   * Retiring readers who have grown out of the library.
   *
   * Not fatal, and before the erasing below for a reason: an account this pass
   * closes tonight starts its retention clock tonight rather than tomorrow. A
   * day when this does not run leaves a reader with a card slightly longer than
   * the range allows, which is the harmless direction for it to fail in.
   */
  let grownUp: GrowingUpResult;
  try {
    grownUp = await retireGrownUpReaders();
  } catch (error) {
    console.error("[maintenance] growing-up pass failed:", error);
    grownUp = { retired: 0, cutoffBirthYear: 0 };
  }

  /*
   * Erasing what the library has decided not to keep.
   *
   * The only destructive step in this job, and it does nothing at all until a
   * Super Admin has set a period — see src/server/lib/retention.ts. Isolated
   * like the rest: if it throws, the housekeeping above still happened, and
   * nothing half-erased is left behind because each row is its own transaction.
   *
   * Deliberately BEFORE the media sweep. Retention schedules a child's
   * photograph for deletion; the sweep is what actually removes the bytes, and
   * running it afterwards means the face is gone the same night rather than the
   * next one.
   */
  let retention: RetentionResult;
  try {
    retention = await runRetentionPass();
  } catch (error) {
    console.error("[maintenance] retention pass failed:", error);
    retention = { photosRemoved: 0, readersArchived: 0, guardiansRedacted: 0, policyUnset: true };
  }

  /*
   * The media sweep is the reconciliation half of the photo lifecycle: it
   * collects uploads nobody claimed, photographs the retention pass has just
   * scheduled, and objects whose immediate deletion failed. Run late and on its
   * own, because it talks to the object store and is the only step here that
   * can be slow.
   *
   * It is a safety net for the inline path, not a replacement: removal and
   * replacement already delete the bytes as they happen. A day when this does
   * not run leaves a private photograph in storage slightly longer, which is
   * exactly why it is a daily job and not a weekly one.
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
    grownUpRetired: grownUp.retired,
    expiredSessionsRemoved,
    spentTokensRemoved,
    oldLoginAttemptsRemoved,
    expiredVerificationChallenges,
    mediaPurged: media.purged,
    mediaFailed: media.failed,
    mediaNeedsAttention: media.needsAttention,
    retention,
    reminders,
  };
}
