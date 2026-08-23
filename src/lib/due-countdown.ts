import { daysUntilDue, formatInTimezone } from "@/lib/dates";

/**
 * How long is left, said once, for every screen that asks.
 *
 * One function so the child's card, the desk's list and the exported report
 * cannot disagree about whether a book is due soon. The bands are the library's
 * own: a fortnight down to four days is plenty, three to one is soon, and the
 * due day itself is where the colour turns.
 *
 * **Colour never carries the meaning alone.** Every countdown returns a word as
 * well as a number, and the word is not decoration — roughly one boy in twelve
 * cannot tell this green from this red, and a card that says only "3" in a
 * colour he cannot read has told him nothing. Callers must render `unit`
 * whenever they render `value`.
 *
 * Nothing here is punitive. There are no fines in this library and there never
 * will be, so an overdue book counts days the way a calendar counts them —
 * plainly, as a fact, with no adjective attached.
 */

export type CountdownTone = "ok" | "soon" | "due" | "late";

/** Where amber begins. Four days and up is still green. */
export const SOON_FROM_DAYS = 3;

export interface DueCountdown {
  tone: CountdownTone;
  /** Signed whole days: positive is remaining, 0 is today, negative is over. */
  days: number;
  /** The large glyph. Always a bare numeral, or "0" on the day itself. */
  value: string;
  /** The word beside it. Never omitted — this is what survives colour blindness. */
  unit: string;
  /** Both together, for a screen reader, a table cell or a narrow card. */
  headline: string;
  /** The date itself, so a countdown can always be checked against a calendar. */
  on: string;
}

export function dueCountdown(
  dueAt: Date,
  timezone: string,
  now: Date = new Date(),
): DueCountdown {
  const days = daysUntilDue(dueAt, timezone, now);
  const on = formatInTimezone(dueAt, timezone, "d MMM yyyy");

  if (days < 0) {
    const over = Math.abs(days);
    const unit = over === 1 ? "day over" : "days over";
    return { tone: "late", days, value: String(over), unit, headline: `${over} ${unit}`, on };
  }

  if (days === 0) {
    return { tone: "due", days, value: "0", unit: "back today", headline: "Back today", on };
  }

  const unit = days === 1 ? "day left" : "days left";
  const tone: CountdownTone = days <= SOON_FROM_DAYS ? "soon" : "ok";
  return { tone, days, value: String(days), unit, headline: `${days} ${unit}`, on };
}

/**
 * The countdown for a loan that may already be finished.
 *
 * A returned book has no time left — it has a story instead. Callers that show
 * history need this rather than `dueCountdown`, which would go on counting
 * against a date nobody is waiting for any more.
 */
export function loanCountdown(
  loan: { status: string; dueAt: Date; returnedAt?: Date | null },
  timezone: string,
  now: Date = new Date(),
): DueCountdown | null {
  if (loan.status !== "ACTIVE") return null;
  return dueCountdown(loan.dueAt, timezone, now);
}
