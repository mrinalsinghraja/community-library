import "server-only";

import { toFriendlyMessage } from "@/server/lib/errors";
import type { BulkFailure, BulkResult } from "@/lib/bulk";

/**
 * Runs one existing single-row operation over several rows.
 *
 * **This is the only way a bulk action is ever implemented in this codebase.**
 * It takes the same function the row's own button calls and applies it once per
 * id. There is no bulk UPDATE anywhere, no `updateMany` behind a bulk button,
 * and no second version of a rule written for the many-row case — which is the
 * whole reason a librarian can be told that "do all six" means exactly what
 * "do this one" means, six times.
 *
 * Three deliberate properties:
 *
 *   * **Sequential, not parallel.** Every one of these operations takes row
 *     locks and several send email. Firing twenty at once would contend on the
 *     same locks, interleave the audit trail, and hand the mail provider a
 *     burst it may refuse. A desk queue is tens of rows, not thousands.
 *   * **One failure never stops the run.** A book that became unavailable while
 *     the librarian was reading the screen is refused on its own; the rest
 *     still happen. Stopping at the first problem would make a bulk action
 *     unpredictable in exactly the situation it exists for.
 *   * **Failures are reported per row, in the words the single-row button would
 *     have used.** `toFriendlyMessage` is the same translation the row-level
 *     forms use, so a librarian is never shown two different sentences for the
 *     same refusal.
 *
 * Permission checks are NOT done here. Each wrapped service function calls
 * `requirePermission` itself, so a bulk runner cannot become a way around a
 * gate — the first row would fail for the same reason a single press would.
 */
export async function runBulk<T>(
  ids: readonly string[],
  /** Names the row for a person, without an id, when it fails. */
  label: (id: string) => string,
  run: (id: string) => Promise<T>,
): Promise<BulkResult> {
  let done = 0;
  const failures: BulkFailure[] = [];

  for (const id of ids) {
    try {
      await run(id);
      done += 1;
    } catch (error) {
      failures.push({ label: label(id), reason: toFriendlyMessage(error) });
    }
  }

  return { done, failures };
}

/**
 * The upper bound on one press.
 *
 * Not a technical limit — it is a limit on how much can go wrong in one
 * unreviewed gesture. A desk queue that has grown past this is telling the
 * library something, and a librarian who really means to act on ninety rows can
 * do it in two presses and see the first result before the second.
 */
export const BULK_LIMIT = 50;

export function limitBulkSelection(ids: readonly string[]): string[] {
  return ids.slice(0, BULK_LIMIT);
}
