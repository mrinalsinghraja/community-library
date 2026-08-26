/**
 * Opening times: when the library room is actually open.
 *
 * This file is isomorphic on purpose. The dropdowns a librarian fills in, the
 * server action that validates them, the service that writes the rows and the
 * card a child reads all take their vocabulary from here, so a time cannot be
 * offered in one place and refused in another.
 *
 * **A slot is a calendar date plus two clock times, and nothing else.** It is
 * not an instant: "Saturday, 4:00–5:00 pm" is a fact about a room in a building
 * and it does not move when a family opens the app from another country. So the
 * date is stored as a DATE and the times as whole minutes past midnight, both
 * read in the library's own calendar. Nothing here converts a timezone, because
 * there is nothing here to convert.
 */

/** Minutes past local midnight. 0 is 12:00 am, 1020 is 5:00 pm. */
export type Minute = number;

/** How far ahead a librarian may schedule. Three months, as the owner asked. */
export const VISIT_HORIZON_DAYS = 92;

/**
 * How many weeks forward the reader's card will page through.
 *
 * Matched to the horizon rather than chosen separately: a reader who can press
 * "Next" past the last week a librarian is allowed to fill would be walking
 * into empty weeks forever.
 */
export const VISIT_WEEKS_AHEAD = 13;

export const SLOT_NOTE_MAX_LENGTH = 80;
export const CANCEL_REASON_MAX_LENGTH = 120;

/** How many slots one submission of the form may create. */
export const MAX_SLOTS_PER_SUBMISSION = 100;

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/**
 * Weekday numbers as `Date.getUTCDay()` reports them: 0 is Sunday.
 *
 * Listed Monday-first because that is how a week is read on a calendar here,
 * and the numbering stays the platform's so no call site has to remember a
 * second convention.
 */
export const WEEKDAYS: readonly { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------------------------------------------------------------------------
// Calendar dates, handled as calendar dates
// ---------------------------------------------------------------------------

/**
 * A `YYYY-MM-DD` string, from a Date whose UTC fields are the calendar date.
 *
 * Every date in this feature travels as one of these. A string cannot pick up a
 * timezone on the way through a form, a URL or JSON, which a Date can and does.
 */
export function toIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The reverse, refusing 31 February rather than rolling it forward to March. */
export function fromIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, y, m, d] = match.map(Number) as [unknown, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));

  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Today, in the library's calendar, as a UTC-midnight Date.
 *
 * Uses the timezone's own rendering of the instant rather than the server's,
 * because a librarian in Bengaluru scheduling at 1am must be offered today and
 * not yesterday — which is exactly what a server in another region would give.
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return fromIsoDate(parts) ?? new Date(Date.UTC(1970, 0, 1));
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const day = date.getUTCDay();
  // getUTCDay() has Sunday as 0; Monday-first means Sunday is six days in.
  const backwards = day === 0 ? 6 : day - 1;
  return addDays(date, -backwards);
}

export function formatDayLabel(date: Date): string {
  const weekday = WEEKDAYS.find((item) => item.value === date.getUTCDay());
  return `${weekday?.label ?? ""} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`.trim();
}

export function formatShortDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]?.slice(0, 3)}`;
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

export interface WeekWindow {
  /** 0 is the week we are in. Never negative — there is no going backwards. */
  offset: number;
  /** Monday. */
  from: Date;
  /** Sunday. */
  to: Date;
  /** "This week", "Next week", or "Week of 12 October". */
  label: string;
}

/**
 * The week a reader is looking at.
 *
 * `offset` is clamped rather than rejected: this value arrives in a query
 * string, which is to say from anywhere, and a card that renders an error
 * because somebody typed `?week=999` is a card that has made a stranger's typo
 * into a child's problem.
 */
export function weekWindow(offset: number, today: Date): WeekWindow {
  const safe = Number.isFinite(offset) ? Math.min(Math.max(Math.trunc(offset), 0), VISIT_WEEKS_AHEAD) : 0;
  const from = addDays(startOfWeek(today), safe * 7);
  const to = addDays(from, 6);

  const label =
    safe === 0 ? "This week" : safe === 1 ? "Next week" : `Week of ${formatDayLabel(from).split(" ").slice(1).join(" ")}`;

  return { offset: safe, from, to, label };
}

/** Every date this library may be given a slot on, for the dropdowns. */
export function schedulableDates(today: Date): Date[] {
  return Array.from({ length: VISIT_HORIZON_DAYS }, (_, index) => addDays(today, index));
}

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

/** "4:30 pm". Lower case meridiem, because this is read by children. */
export function minuteLabel(minute: Minute): string {
  const hours24 = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const meridiem = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

export function formatSlotRange(start: Minute, end: Minute): string {
  return `${minuteLabel(start)} – ${minuteLabel(end)}`;
}

const FIRST_OFFERED_MINUTE = 6 * 60;
const LAST_OFFERED_MINUTE = 21 * 60;
const STEP_MINUTES = 15;

/**
 * The times the dropdowns offer: quarter past quarter, 6:00 am to 9:00 pm.
 *
 * A closed list rather than a free `<input type="time">` on purpose. Two people
 * typing opening hours freehand produce 16:00, 4pm and 4:00 PM for the same
 * hour, and a child reading three spellings of one time on one card learns that
 * the library is not sure when it is open.
 */
export const TIME_OPTIONS: readonly { value: Minute; label: string }[] = Array.from(
  { length: (LAST_OFFERED_MINUTE - FIRST_OFFERED_MINUTE) / STEP_MINUTES + 1 },
  (_, index) => {
    const value = FIRST_OFFERED_MINUTE + index * STEP_MINUTES;
    return { value, label: minuteLabel(value) };
  },
);

export function isOfferedMinute(value: number): boolean {
  return TIME_OPTIONS.some((option) => option.value === value);
}

// ---------------------------------------------------------------------------
// What everybody is told
// ---------------------------------------------------------------------------

export const VISIT_MESSAGES = {
  heading: "When to come to the library room",
  /**
   * The sentence the owner asked for, in a child's voice and without naming the
   * room — the room's name is configuration and is passed in beside this.
   */
  intro:
    "Come at one of these times to collect a book or bring one back. A librarian will be there to help you.",
  none: "No times are up for this week yet. Try looking at the next one.",
  noneEver:
    "The librarian has not put up any visiting times yet. They will appear here as soon as they do.",
  cancelledBadge: "Cancelled",
  cancelledNote: "This time is not happening. Please come at another one.",
  next: "Next week",
  previous: "Previous week",
  today: "Today",
  tomorrow: "Tomorrow",
} as const;

/**
 * The one sentence that names the room, built from configuration.
 *
 * A function rather than a constant because the room's name is a fact about
 * this deployment and must never be a literal under `src/` — and because the
 * same sentence has to appear on the rules, the joining page and the front
 * page in exactly one wording. Three hand-written variants of "come to the
 * such-and-such room" is how a family ends up at the wrong door.
 */
export function visitVenueSentence(venue: string): string {
  return `Please come to the ${venue} at one of the times shown on your own page to collect a book or bring one back.`;
}

/** Copy the desk sees. Separate from the reader's, because the audience is. */
export const VISIT_DESK_MESSAGES = {
  created: (count: number) =>
    count === 0
      ? "Those times were already up — nothing new to add."
      : count === 1
        ? "One visiting time is now up for readers."
        : `${count} visiting times are now up for readers.`,
  cancelled: "Cancelled. Every reader sees it as cancelled straight away.",
  needDay: "Choose a day.",
  needDate: "Choose a date.",
  needRange: "Choose an end date that is not before the start date.",
  badTime: "Choose a start and end time from the list.",
  endBeforeStart: "The end time has to be after the start time.",
  tooMany: `That would create more than ${MAX_SLOTS_PER_SUBMISSION} times at once. Choose a shorter stretch of dates.`,
  pastDate: "That date has already gone.",
  beyondHorizon: "Times can only be set up to three months ahead.",
} as const;
