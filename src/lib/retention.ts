/**
 * How long the library keeps what it knows about a child.
 *
 * `docs/ACCOUNT_LIFECYCLE.md` §5 has described this redaction pass since Phase 1
 * and refused to write it, for a good reason: the periods are a community
 * decision and a legal one, and inventing "two years" in a source file would
 * have turned somebody's guess into the library's policy by accident.
 *
 * So this module is the machinery and **not** the decision. Every period is
 * nullable, every one of them starts unset, and a policy that is unset does
 * nothing at all: the pass finds no work, the privacy notice says plainly that
 * no schedule is in force, and the library keeps records exactly as it does
 * today. Filling in three numbers on the settings screen is the whole of the
 * decision, and it is the only thing that can make this destructive.
 *
 * ------------------------------------------------------------------------
 * NOT LEGAL ADVICE. The periods a library chooses here, and whether erasing on
 * this schedule is enough, are questions for somebody qualified — see the same
 * banner on `src/lib/legal.ts` and `src/lib/consent.ts`.
 * ------------------------------------------------------------------------
 *
 * Isomorphic, like the other policy modules: the settings form renders these
 * bounds, the service enforces them, the nightly pass applies them and the
 * privacy notice describes them, all from this one file. A retention period
 * written twice is a retention period that will disagree with itself, and the
 * disagreement would be discovered by a family.
 */

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  /**
   * Months after an account closes before personal details are redacted and
   * the account becomes ARCHIVED. Null means "keep indefinitely", which is
   * what the library does today.
   */
  archiveClosedAfterMonths: number | null;
  /**
   * Days after an account closes before the child's photograph is deleted.
   *
   * Separate from, and shorter than, the archival period on purpose. A
   * photograph of a child is the most sensitive thing here and the least
   * useful to the library's own records: there is no reason to hold a face for
   * as long as a lending history, so the two are not one number.
   */
  removePhotoAfterClosedDays: number | null;
  /**
   * Months after the last child linked to a guardian has been archived before
   * that guardian's contact details are redacted.
   *
   * Counted from the child, never from the guardian: a parent with a younger
   * child still in the library is still the library's contact for them.
   */
  removeGuardianAfterMonths: number | null;
}

/**
 * The range a Super Admin may choose between.
 *
 * The floors are the load-bearing half. A one-month archival period would erase
 * a family's record before the term they left in had finished, and an account
 * closed by mistake — a mis-tapped status, a child suspended over a lost book —
 * has to be recoverable by a person who notices, which takes longer than a
 * fortnight. The ceilings only stop a typo becoming a century.
 */
export const RETENTION_BOUNDS = {
  archiveClosedAfterMonths: { min: 6, max: 120 },
  removePhotoAfterClosedDays: { min: 7, max: 3650 },
  removeGuardianAfterMonths: { min: 6, max: 120 },
} as const;

export const UNSET_RETENTION: RetentionPolicy = {
  archiveClosedAfterMonths: null,
  removePhotoAfterClosedDays: null,
  removeGuardianAfterMonths: null,
};

/** Whether any period at all has been decided. */
export function retentionIsSet(policy: RetentionPolicy): boolean {
  return (
    policy.archiveClosedAfterMonths !== null ||
    policy.removePhotoAfterClosedDays !== null ||
    policy.removeGuardianAfterMonths !== null
  );
}

// ---------------------------------------------------------------------------
// What redaction leaves behind
// ---------------------------------------------------------------------------

/**
 * The reserved TLD from RFC 2606, so a redacted address can never be
 * deliverable even if something later tries to send to it.
 *
 * Per-row rather than a constant because `app_user.email` and `guardian.email`
 * are both unique within a library: one shared placeholder would make the
 * second redaction of the day fail on a unique constraint, and the pass would
 * stop halfway through with half a family erased.
 */
export function redactedEmail(rowId: string): string {
  return `redacted-${rowId}@removed.invalid`;
}

/** Stands in for a flat number, which is the other half of identifying a child here. */
export const REDACTED_APARTMENT = "removed";

/** Stands in for a guardian's name once no child of theirs is still a reader. */
export const REDACTED_GUARDIAN_NAME = "Former guardian";

/** Stands in for a phone number. Not blank: blank reads as "never had one". */
export const REDACTED_PHONE = "removed";

/**
 * What an archived reader is called afterwards.
 *
 * Their own member code, not a name and not a blank — the code is the library's
 * ledger reference, it is already printed against every loan they ever took
 * out, and a history attributed to "Former reader" four times over is a history
 * nobody can read. A reader with no profile at all falls back to the label.
 */
export function archivedDisplayName(memberCode: string | null | undefined): string {
  return memberCode?.trim() || "Former reader";
}

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/**
 * The instant a row must have closed before, to be due.
 *
 * `setUTCMonth` handles the short-month case the way this needs it to: 31 March
 * minus one month is 3 March rather than an error, which errs towards keeping
 * the record a day or two longer. That is the harmless direction.
 */
export function monthsBefore(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Saying it in words
// ---------------------------------------------------------------------------

function months(count: number): string {
  if (count === 1) return "a month";
  if (count % 12 === 0) {
    const years = count / 12;
    return years === 1 ? "a year" : `${years} years`;
  }
  return `${count} months`;
}

/**
 * Days stay days, deliberately.
 *
 * Collapsing 30 into "a month" would read more naturally and would be a
 * different promise: the pass counts exact days, and a month is 28, 30 or 31 of
 * them depending on which one it is. On a page a family may one day hold the
 * library to, the number that is counted is the number that is printed.
 */
function days(count: number): string {
  return count === 1 ? "a day" : `${count} days`;
}

/**
 * The schedule as sentences for the privacy notice.
 *
 * Generated from the same numbers the pass runs on, so the notice cannot
 * describe a schedule the software is not keeping. When nothing is set it says
 * so — an honest gap on the page is better than a period nobody chose.
 */
export function describeRetention(policy: RetentionPolicy): string[] {
  if (!retentionIsSet(policy)) {
    return [
      "The library has not yet set how long a closed record is kept, so nothing is removed automatically. Until it does, a closed account and its borrowing history stay as they are, and anything you want removed sooner can be asked for.",
    ];
  }

  const sentences: string[] = [];

  if (policy.removePhotoAfterClosedDays !== null) {
    sentences.push(
      `A child's photograph is deleted ${days(policy.removePhotoAfterClosedDays)} after their account closes. The picture is removed from the library's storage, not only from the screen.`,
    );
  }

  if (policy.archiveClosedAfterMonths !== null) {
    sentences.push(
      `${months(policy.archiveClosedAfterMonths)} after an account closes, the child's name, address, sign-in details and any notes about them are erased. What stays is the borrowing record — which book, which dates — attached to their old library card number rather than to a name.`,
    );
  }

  if (policy.removeGuardianAfterMonths !== null) {
    sentences.push(
      `A guardian's name, email address, phone number and flat are erased ${months(policy.removeGuardianAfterMonths)} after the last child of theirs has been erased. The record that consent was given stays, because it is the evidence the library was allowed to hold anything at all.`,
    );
  }

  sentences.push(
    "Erasing is permanent and cannot be undone. Anything you would like removed sooner can be asked for.",
  );

  return sentences;
}
