import { TZDate } from "@date-fns/tz";
import { addDays, differenceInCalendarDays, format } from "date-fns";

/**
 * Every date decision in this application is made in the *library's* timezone,
 * never the browser's. A family opening the app while travelling must still see
 * the same due date as the book on the shelf.
 *
 * Timestamps are stored as UTC instants. These helpers convert at the edges.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** The current instant, in the library's local calendar. */
export function nowInTimezone(timezone: string, now: Date = new Date()): TZDate {
  return new TZDate(now, timezone);
}

/**
 * Last moment of the given day, in the library's timezone, as a UTC instant.
 *
 * Due dates are normalised to end of day so that a book issued at 9am and one
 * issued at 6pm on the same day come back on the same day — which is how a
 * physical library actually works.
 */
export function endOfDayInTimezone(instant: Date, timezone: string): Date {
  const local = new TZDate(instant, timezone);
  local.setHours(23, 59, 59, 999);
  return new Date(local.getTime());
}

/** Start of the given day in the library's timezone, as a UTC instant. */
export function startOfDayInTimezone(instant: Date, timezone: string): Date {
  const local = new TZDate(instant, timezone);
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime());
}

/**
 * Due date for a loan: N whole days from issue, ending at close of day.
 * `borrowingPeriodDays` always comes from library settings — never a literal.
 */
export function calculateDueDate(
  issuedAt: Date,
  borrowingPeriodDays: number,
  timezone: string,
): Date {
  if (!Number.isInteger(borrowingPeriodDays) || borrowingPeriodDays < 1) {
    throw new RangeError(`borrowingPeriodDays must be a positive integer, got ${borrowingPeriodDays}`);
  }
  const local = new TZDate(issuedAt, timezone);
  const shifted = addDays(local, borrowingPeriodDays);
  return endOfDayInTimezone(new Date(shifted.getTime()), timezone);
}

/** Extending an existing loan starts from the current due date, not from today. */
export function calculateRenewedDueDate(
  currentDueAt: Date,
  renewalPeriodDays: number,
  timezone: string,
): Date {
  return calculateDueDate(currentDueAt, renewalPeriodDays, timezone);
}

/**
 * Overdue is *derived*, always. There is no overdue column, so no failed
 * scheduled job can leave the library believing something it is not.
 */
export function isOverdue(dueAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > dueAt.getTime();
}

/** Whole days until due. Negative means that many days overdue. */
export function daysUntilDue(dueAt: Date, timezone: string, now: Date = new Date()): number {
  return differenceInCalendarDays(new TZDate(dueAt, timezone), new TZDate(now, timezone));
}

/** Age in whole years on a given day, evaluated in the library's timezone. */
export function ageInYears(dateOfBirth: Date, timezone: string, now: Date = new Date()): number {
  const today = new TZDate(now, timezone);
  const dob = new TZDate(dateOfBirth, timezone);

  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Turns a date picker's `YYYY-MM-DD` into the instant that day *began* in the
 * library's timezone.
 *
 * `new Date("2026-08-17")` parses as midnight **UTC**, which in Asia/Kolkata is
 * already 05:30 on the 17th — and for a timezone behind UTC it would be the
 * previous day entirely. A librarian picking "today" must get today, so the
 * conversion happens here rather than being re-derived at each call site.
 *
 * Returns null for anything that is not a real calendar date, so a caller can
 * report a field error instead of storing an Invalid Date.
 */
export function dateOnlyInTimezone(value: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match.map(Number) as [unknown, number, number, number];
  const local = new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone);

  // Rejects 31 February and friends, which the constructor would roll forward.
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
    return null;
  }
  return new Date(local.getTime());
}

/** Formats an instant for display in the library's timezone. */
export function formatInTimezone(
  instant: Date,
  timezone: string,
  pattern = "d MMM yyyy",
): string {
  return format(new TZDate(instant, timezone), pattern);
}

/**
 * Friendly, non-punitive phrasing for a due date. The library charges no fines
 * and the wording must never imply otherwise.
 */
export function describeDueDate(
  dueAt: Date,
  timezone: string,
  now: Date = new Date(),
): { tone: "ok" | "soon" | "due" | "late"; text: string } {
  const days = daysUntilDue(dueAt, timezone, now);
  const on = formatInTimezone(dueAt, timezone, "EEEE d MMMM");

  if (days < 0) {
    return { tone: "late", text: "Ready to come home 🏠" };
  }
  if (days === 0) {
    return { tone: "due", text: "Back today" };
  }
  if (days === 1) {
    return { tone: "soon", text: "Back tomorrow" };
  }
  if (days <= 3) {
    return { tone: "soon", text: `Back on ${on}` };
  }
  return { tone: "ok", text: `Yours until ${on}` };
}
