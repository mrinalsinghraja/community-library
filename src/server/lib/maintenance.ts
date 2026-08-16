import "server-only";

import { prisma } from "@/server/db";
import { pruneExpiredSessions } from "@/server/auth/session-store";
import { pruneOldLoginAttempts } from "@/server/lib/rate-limit";

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
  const [expiredSessionsRemoved, spentTokensRemoved, oldLoginAttemptsRemoved] = await Promise.all([
    pruneExpiredSessions(),
    pruneAuthTokens(),
    pruneOldLoginAttempts(),
  ]);

  return { expiredSessionsRemoved, spentTokensRemoved, oldLoginAttemptsRemoved };
}
