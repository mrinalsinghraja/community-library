/**
 * Doing the same thing to several rows at once.
 *
 * The load-bearing rule lives here as a type rather than as a convention: a
 * bulk action is **the single-row action, run once per row**. It is not a
 * cleverer query, it takes no shortcut through the rules, and it never becomes
 * a second code path that can drift away from the button beside each row.
 *
 * That is what makes the whole idea safe. Approving six requests together
 * re-runs six identical transactions, each with its own locks, its own rule
 * checks and its own audit row — so a book that stopped being available while
 * the librarian was reading the screen is refused on its own, and the other
 * five still happen.
 *
 * Isomorphic: the toolbar renders these words, the server action produces the
 * counts, and the tests read both.
 */

export interface BulkFailure {
  /** How the row is named on screen — a book and a child, never an id. */
  label: string;
  /** Why this one did not happen, in the same words the single-row button uses. */
  reason: string;
}

export interface BulkResult {
  /** How many rows the action actually completed. */
  done: number;
  /** The ones that did not, each with its reason. Empty on a clean run. */
  failures: BulkFailure[];
}

export const EMPTY_BULK: BulkResult = { done: 0, failures: [] };

/**
 * What to tell the librarian afterwards.
 *
 * Partial success is the normal case, not an error state: rows go stale
 * between a page loading and a button being pressed, and a run where five of
 * six worked is a good outcome that has to be reported honestly. So the
 * sentence always leads with what happened, and the failures are listed
 * individually rather than summarised into a number nobody can act on.
 */
export function summariseBulk(result: BulkResult, noun: string, nounPlural: string): string {
  const { done, failures } = result;
  const word = (count: number) => (count === 1 ? noun : nounPlural);

  if (done === 0 && failures.length === 0) return "Nothing was selected.";
  if (failures.length === 0) return `Done — ${done} ${word(done)}.`;
  if (done === 0) return `Nothing was done. ${failures.length} ${word(failures.length)} could not be.`;

  return `${done} ${word(done)} done. ${failures.length} could not be — see below.`;
}

/**
 * The confirmation a librarian reads before a bulk action runs.
 *
 * Every one of these says the number and the consequence in the same sentence.
 * A confirmation that only says "Are you sure?" teaches people to press yes
 * without reading, which is worse than no confirmation at all.
 */
export interface BulkAction {
  /** Sent to the server as the decision. */
  value: string;
  /** On the button. */
  label: string;
  /** Primary for the ordinary yes, quiet for the ordinary no, danger for the rest. */
  tone: "primary" | "secondary" | "danger";
  /** Asked for once and applied to every selected row. Null when none is needed. */
  notePrompt: string | null;
  /**
   * Says the number and what will happen. Null when nothing needs confirming.
   *
   * A template with `{count}` in it, not a function — this whole object is
   * built on the server and handed to a client component, and a function
   * cannot cross that boundary. Only server actions can, which is why `run`
   * may be one and this may not.
   */
  confirm: string | null;
}

/**
 * Fills in a confirmation template.
 *
 * `{count}` becomes the number. `{book|books}` picks the singular or the
 * plural. Two tiny substitutions rather than a function, because the template
 * is written on the server and read on the client, and only a server action can
 * make that journey — see `BulkAction.confirm`.
 */
export function fillConfirm(template: string, count: number): string {
  return template
    .replace(/\{count\}/g, String(count))
    .replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_match, one: string, many: string) =>
      count === 1 ? one : many,
    );
}
