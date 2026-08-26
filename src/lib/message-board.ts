/**
 * The little board on a reader's own page.
 *
 * Two states, and the ordinary one is the one that matters. Almost every day
 * there is nothing special to say, so the board greets the reader and offers a
 * line about reading — and it has to look deliberate on those days, not like a
 * component waiting for content. A card that is empty when nobody has posted
 * teaches a child to stop looking at it, and then the one week it matters they
 * do not see it either.
 *
 * When the Super Admin posts something it takes the card over completely.
 *
 * Isomorphic: the service picks the line and the card renders it, and both read
 * the same list, so what is on screen is never a second copy of what was chosen.
 */

/**
 * The lines the board falls back to, written for this library.
 *
 * **Written here, not quoted from anywhere.** Reading has no shortage of famous
 * sentences about it, and every one of them belongs to somebody — a card that
 * republishes an author's words to a few hundred families is a small
 * publication, not a decoration. These are plain, short, and ours.
 *
 * Kept deliberately gentle. There is no line here that tells a child to read
 * more, read faster, or finish anything.
 */
export const READING_LINES: readonly string[] = [
  "A book is a place you can go without leaving the room.",
  "Every reader starts on page one. There is no other way in.",
  "Some books are for finishing. Some are just for looking at. Both count.",
  "The best book in the library is the one you feel like reading today.",
  "Nobody has read them all. That is what makes a shelf interesting.",
  "A story you tell somebody afterwards is a story twice.",
  "Reading a little is still reading.",
  "Come and browse. Reading here in the room counts too.",
  "A quiet half hour with a book is a good half hour.",
  "If a book is not for you, put it back. There are plenty more.",
];

/**
 * Which line today gets.
 *
 * Chosen from the calendar date rather than at random, so the board is the same
 * all day for everybody. A line that changed on every page load would make the
 * card feel like a slot machine, and two children standing together would see
 * two different libraries.
 */
export function lineForDate(isoDate: string, lines: readonly string[] = READING_LINES): string {
  if (lines.length === 0) return "";

  let hash = 0;
  for (const character of isoDate) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return lines[hash % lines.length] as string;
}

export const NOTICE_TITLE_MAX_LENGTH = 60;
export const NOTICE_BODY_MAX_LENGTH = 400;

/** What the board shows. One shape for both states, so the card has no branch. */
export interface BoardNotice {
  /** True when a person wrote this, false when it is the standing greeting. */
  special: boolean;
  title: string;
  body: string;
}

export const BOARD_MESSAGES = {
  heading: "Notice board",
  /** Under the standing greeting, never under a posted notice. */
  standingHint: "Anything important from the library will appear here.",
  deskEmpty: "Nothing is posted. Readers see the usual welcome and a line about reading.",
  posted: "Posted. Every reader sees it the next time their page loads.",
  takenDown: "Taken down. Readers see the usual welcome again.",
  needTitle: "Give the notice a short heading.",
  needBody: "Write the notice.",
} as const;
