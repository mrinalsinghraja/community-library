import type { ReviewAttribution } from "@prisma/client";

/**
 * What a reader thought of a book, in one place.
 *
 * Isomorphic on purpose (no `server-only`): the service validates against these
 * limits, the composer counts against them, the star row renders from them and
 * the tests read the same numbers. A rule that lives in two files is a rule that
 * disagrees with itself eventually.
 *
 * Two things here are product decisions rather than implementation details, and
 * both are written down because a future edit that quietly reverses one would
 * change what this feature is:
 *
 *   * **The scale has no zero.** One star is the lowest opinion a child can
 *     hold, and it still means they read it. A zero would be an absence dressed
 *     as a judgement.
 *   * **A rating alone is a complete review.** Words are optional and always
 *     will be. Most children will tap five stars and go, and that has to be a
 *     finished action rather than a form they abandoned.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Every value the picker offers, low to high. */
export const RATING_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * The word cap the owner asked for.
 *
 * Counted in words rather than characters because that is the instruction a
 * child can act on — "about a hundred words" is a paragraph, "900 characters"
 * is nothing anybody can picture. The character limit below is only the
 * backstop that keeps a single pasted 4,000-letter word out of the column, and
 * it matches the database CHECK exactly.
 */
export const REVIEW_MAX_WORDS = 100;
export const REVIEW_MAX_CHARS = 900;

/**
 * How long the library keeps asking.
 *
 * Sixty days from the day the book went back, then the prompt stops for good.
 * A nudge that never expires stops being a nudge and becomes a chore list a
 * child can never finish, and by two months they have forgotten the book well
 * enough that whatever they typed would not be worth reading anyway.
 *
 * The reminder starts the day the book is returned, not two months after it —
 * that reading was considered and makes no sense for a fourteen-day loan.
 */
export const REVIEW_REMINDER_DAYS = 60;

/**
 * How many books the reminder will name at once.
 *
 * A child who spent the summer reading could come back to eleven unrated books,
 * and a card listing eleven chores is a card nobody starts. It names a few and
 * says how many more are waiting.
 */
export const REMINDER_MAX_SHOWN = 3;

/** Words, counted the way a person counts them. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** True when this is a rating somebody may actually give. */
export function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}

/**
 * The text of a review as it should be stored.
 *
 * Whitespace collapsed, and an empty result becomes null rather than "". A
 * review of nothing is not a review, and storing the empty string would put
 * a blank quotation mark on a book's page.
 */
export function normaliseReviewText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

// ---------------------------------------------------------------------------
// The aggregate
// ---------------------------------------------------------------------------

/**
 * What a book's rating is, as every surface receives it.
 *
 * `count` is always shown beside `average`, never on its own and never hidden.
 * An average with no count is the oldest trick in the ratings business — 5.0
 * from one reader looks exactly like 5.0 from four hundred, and the number in
 * brackets is what tells a child which one they are looking at.
 */
export interface RatingSummary {
  /** Mean of every visible rating, to one decimal place. */
  average: number;
  count: number;
}

/** No ratings at all, which is what most books look like on day one. */
export const NO_RATINGS: RatingSummary = { average: 0, count: 0 };

/** "4.3" — one decimal, always, so a column of them lines up. */
export function formatAverage(average: number): string {
  return average.toFixed(1);
}

/**
 * The rating, in a sentence.
 *
 * Every star row carries this for a screen reader, because a row of five
 * glyphs conveys nothing at all when read aloud one by one. It is also the
 * fallback wherever there is no room to draw stars.
 */
export function ratingSentence(summary: RatingSummary): string {
  if (summary.count === 0) return "No ratings yet";
  const readers = summary.count === 1 ? "1 reader" : `${summary.count} readers`;
  return `${formatAverage(summary.average)} out of ${RATING_MAX} stars, from ${readers}`;
}

export type StarFill = "full" | "half" | "empty";

/**
 * Five stars, each full, half or empty.
 *
 * Rounded to the nearest half so that 4.3 draws four and a half rather than
 * four and a third of one — a third of a star is a rendering nobody reads as a
 * number. Computed here rather than in the component so the rounding rule is
 * testable and identical everywhere.
 */
export function starFills(average: number): StarFill[] {
  const halves = Math.round(Math.max(0, Math.min(RATING_MAX, average)) * 2);

  return RATING_VALUES.map((position) => {
    const filledHalves = Math.max(0, Math.min(2, halves - (position - 1) * 2));
    return filledHalves === 2 ? "full" : filledHalves === 1 ? "half" : "empty";
  });
}

// ---------------------------------------------------------------------------
// Words on the screen
// ---------------------------------------------------------------------------

/** What each rating means, so a child is not guessing at what four stars is. */
export const RATING_LABELS: Record<number, string> = {
  1: "Not for me",
  2: "It was okay",
  3: "Good",
  4: "Really good",
  5: "Loved it",
};

export function ratingLabel(rating: number): string {
  return RATING_LABELS[rating] ?? `${rating} stars`;
}

/**
 * How a review is signed.
 *
 * The only two answers, and neither of them is a full name. A library that
 * publishes children's writing publishes a first name or nothing.
 */
export function reviewByline(
  attribution: ReviewAttribution,
  firstName: string | null,
): string {
  if (attribution === "ANONYMOUS" || !firstName) return "A reader at the library";
  return firstName;
}

/**
 * The copy around the composer.
 *
 * Kept here rather than in the component for the same reason the loan wording
 * lives in `circulation.ts`: so that no template can invent a harsher version,
 * and so the guidance a child reads before writing is one string a guardian can
 * change without going near a React file.
 */
export const REVIEW_MESSAGES = {
  invitation: "What did you think?",
  ratingLegend: "How many stars?",
  reviewLabel: "Tell us about it (if you want to)",
  reviewHint: `Up to ${REVIEW_MAX_WORDS} words. What happened, who you liked, whether a friend should read it.`,
  /*
   * The one rule, said once, in words a nine-year-old can follow. Not a wall of
   * terms: a child who is about to write something unkind is not stopped by a
   * policy, they are stopped by a sentence that tells them what this page is
   * for.
   */
  safetyNote:
    "Please write about the book, not about people. Leave out anybody's name, flat number or phone number — including your own.",
  attributionLabel: "Sign it",
  attributionNamed: "Show my first name",
  attributionAnonymous: "Don't show my name",
  attributionHint: "Other readers only ever see your first name — never your full name or your flat.",
  submit: "Share what I thought",
  update: "Change what I said",
  resend: "Send it again",
  saved: "Thank you — other readers can see this now.",
  tooLong: `That is a little long. Please keep it to about ${REVIEW_MAX_WORDS} words.`,
  needRating: "Please choose how many stars first.",
  notBorrowed: "You can rate a book once you have borrowed it.",
  /*
   * The three things a reader is told about their own review, and the tone is
   * the whole job. Waiting is not a delay to apologise for, it is a person
   * reading; declined is not a telling-off; published is not a receipt, it is
   * the good news.
   */
  waiting:
    "Thank you! Our librarian reads every review before it goes on the book's page. Yours will appear once they have.",
  waitingBadge: "Waiting for the librarian",
  publishedBadge: "On the book's page",
  declinedBadge: "Not going up",
  declined:
    "Our librarian would like you to have another go at this one. Change it below and send it again.",
  /**
   * Said when a reader tries to edit or take back something already published.
   *
   * Framed as a fact about the library rather than as a refusal of them: their
   * words are on the shelf now, the same as a book is.
   */
  alreadyPublished:
    "This one is already on the book's page, so it stays as you wrote it. Ask the librarian if something needs changing.",
  publishedNote:
    "Other readers can see this. Reviews stay on the book's page once they go up.",
  /** The byline for a review whose author asked not to be named. */
  anonymousByline: "A reader at the library",
} as const;

/** The nudge, sized to what is actually waiting. */
export function reminderHeadline(count: number): string {
  return count === 1 ? "One book is waiting for your stars" : `${count} books are waiting for your stars`;
}
