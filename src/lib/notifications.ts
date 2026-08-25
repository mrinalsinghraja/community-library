import type { LoanNotificationKind, UserStatus } from "@prisma/client";

import { daysUntilDue, formatInTimezone } from "@/lib/dates";

/**
 * When the library writes to a family about a book, and what it says.
 *
 * Isomorphic and pure, like `circulation.ts` next door: the daily job, the
 * templates and the tests all derive the same answers from the same functions,
 * so "this book is due in two days" cannot mean one thing to the scheduler and
 * another to the message it sends.
 *
 * Three rules shape this file.
 *
 * **1. A reminder is derived, never stored on the loan.** Which occurrence is
 * due today is computed from the loan's own due date at the moment the job
 * runs. There is no `next_reminder_at` column to go stale, and a day when the
 * job does not run means one message was not sent — not that the library now
 * believes something untrue about a book.
 *
 * **2. Renewing retires the old date's reminders, automatically.** Offsets are
 * measured from the loan's *current* due date, so the moment a due date moves,
 * every occurrence belonging to the old one stops being reachable. Nothing has
 * to remember to cancel anything.
 *
 * **3. Never imply a consequence, and never promise there is none.** This
 * is a message to a parent about a library book, not a demand. It says which
 * book, which date, and where to bring it. It does not count days, does not
 * threaten, and never suggests a child has done something wrong. The strongest
 * word here is "please".
 */

// ---------------------------------------------------------------------------
// Who may be written to
// ---------------------------------------------------------------------------

/**
 * The account states whose loans generate reminders.
 *
 * An allowlist, for the same reason borrowing is one (ADR-028): a state added
 * to `UserStatus` later must not silently start generating mail to a family.
 *
 * SUSPENDED is on the list and that is deliberate. A paused account is usually
 * paused *because* a book has not come back, and a library that stops asking at
 * exactly that point has removed its own only remedy — it cannot compel, so
 * a polite note is the whole mechanism. ARCHIVED and DEACTIVATED are not:
 * that family has left, and writing to them about a book is either useless or
 * an intrusion. If such an account still holds a book, that is a conversation
 * for a person, and the desk's list still shows it.
 */
export const NOTIFIABLE_MEMBER_STATUSES: readonly UserStatus[] = ["ACTIVE", "SUSPENDED"];

export function memberMayBeReminded(status: UserStatus): boolean {
  return NOTIFIABLE_MEMBER_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

/**
 * How far a loan is from its due date, in whole days, in the library's
 * timezone. Negative before the date, 0 on it, positive after.
 *
 * This is the number that identifies an occurrence, and it is the inverse of
 * `daysUntilDue` — expressed this way round so that the configured offsets read
 * the way a librarian would say them: "two days before" is -2.
 */
export function offsetFromDueDate(dueAt: Date, timezone: string, now: Date = new Date()): number {
  const days = daysUntilDue(dueAt, timezone, now);
  // `-0` is a real JavaScript value and it is not what "due today" should look
  // like in a column, a log line, or a test failure.
  return days === 0 ? 0 : -days;
}

/**
 * Which kind of message an occurrence is.
 *
 * The boundary is the due date itself. Due dates are stored as the last moment
 * of their day, so on the day a book is due it is not yet late — offset 0 is a
 * gentle "today", not a nudge about something overdue.
 */
export function notificationKindForOffset(offsetDays: number): LoanNotificationKind {
  return offsetDays > 0 ? "OVERDUE" : "DUE_SOON";
}

/**
 * Cleans the configured offsets.
 *
 * Configuration comes from a database column that a settings screen will one
 * day write to, so this is the one place that decides what a nonsensical value
 * means. Duplicates collapse, order is fixed, and anything absurd is dropped —
 * a reminder 400 days after a due date is not a policy, it is a typo, and
 * sending it would be worse than ignoring it.
 */
export const MAX_REMINDER_OFFSET_DAYS = 90;

export function normaliseReminderOffsets(offsets: readonly number[]): number[] {
  const cleaned = offsets
    .filter((value) => Number.isInteger(value) && Math.abs(value) <= MAX_REMINDER_OFFSET_DAYS)
    .sort((a, b) => a - b);
  return [...new Set(cleaned)];
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/**
 * The one sentence that carries the message, written for the guardian.
 *
 * Children in this library have no email address; everything goes to the adult
 * who registered them, which is why these are addressed to a parent about their
 * child rather than to the child about themselves.
 */
export function reminderSentence(params: {
  childName: string;
  title: string;
  dueAt: Date;
  timezone: string;
  now?: Date;
}): string {
  const { childName, title, dueAt, timezone } = params;
  const on = formatInTimezone(dueAt, timezone, "d MMMM");
  const offset = offsetFromDueDate(dueAt, timezone, params.now ?? new Date());

  if (offset > 0) {
    // Names the date, not the number of days. "Six days late" is a count
    // somebody is keeping; "due back on 13 August" is a fact.
    return `${childName} borrowed ${title} from the library, and it was due back on ${on}. Please send it in with them whenever you can.`;
  }
  if (offset === 0) {
    return `${childName} borrowed ${title} from the library, and it is due back today, ${on}.`;
  }
  if (offset === -1) {
    return `${childName} borrowed ${title} from the library, and it is due back tomorrow, ${on}.`;
  }
  return `${childName} borrowed ${title} from the library, and it is due back on ${on}.`;
}

/** Subject line. Short, specific, and never alarming in a notification list. */
export function reminderSubject(params: {
  childName: string;
  title: string;
  kind: LoanNotificationKind;
}): string {
  return params.kind === "OVERDUE"
    ? `A library book to come back: ${params.title}`
    : `${params.childName}'s library book is due soon: ${params.title}`;
}
