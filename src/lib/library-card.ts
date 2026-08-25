/**
 * The reader's card, as words and numbers.
 *
 * Isomorphic: the card in the browser, the PDF written on the server and the
 * PNG drawn onto a canvas all read this file, so the three can differ in
 * pixels and never in content. That mattered more than it sounds — three
 * renderers of the same object is three places for a rule to go stale.
 *
 * Nothing here is a secret and nothing here reaches the database.
 */

export interface CardRules {
  ageMin: number;
  ageMax: number;
  borrowingPeriodDays: number;
  maxActiveLoans: number;
}

/** Everything printed on one card. Assembled by `getOwnLibraryCard`. */
export interface LibraryCardFacts {
  /** The child's name as they gave it. Null on the blank specimen. */
  readerName: string | null;
  /** The code on their card. Null on the specimen. */
  memberCode: string | null;
  /** Flat, so a card found in a stairwell can be walked home. Null on the specimen. */
  apartment: string | null;
  /** Year only — the library never holds a full date of birth. See ADR-051. */
  birthYear: number | null;
  joinedAt: Date | null;
  avatarKey: string | null;
  photoMediaId: string | null;

  libraryName: string;
  communityName: string;
  logoUrl: string | null;
  rules: CardRules | null;
}

/**
 * What is **deliberately not** on the card.
 *
 * A guardian's name, email or phone. Those sit behind `member.view_contact` and
 * the schema says in as many words that they never render on a child's screen;
 * a card is a child's screen that can also be printed and handed to somebody.
 * `staffNotes` likewise. The library's own phone number is the contact that
 * belongs here, because the question a found card has to answer is "whose is
 * this?" and the answer is "the library's".
 */
export const OMITTED_FROM_CARD = ["guardianName", "guardianEmail", "guardianPhone", "staffNotes"] as const;

/** The three facts that fit across the middle of the card. */
export function cardAllowances(rules: CardRules): { label: string; value: string }[] {
  return [
    { label: "Ages", value: `${rules.ageMin}–${rules.ageMax}` },
    {
      label: "At a time",
      value: `${rules.maxActiveLoans} ${rules.maxActiveLoans === 1 ? "book" : "books"}`,
    },
    { label: "To keep", value: `${rules.borrowingPeriodDays} days` },
  ];
}

/**
 * The house rules, short enough to sit along the bottom of a card.
 *
 * Four, because five stops being read. Each one is the shortest true form of a
 * rule from `/rules`, and each one says what to **do**.
 *
 * **None of them mentions what happens if you do not.** Not a threat, and — the
 * part that is easy to get wrong — not a reassurance either. An earlier version
 * ended "there is never a fine", which was kindly meant and was still a policy
 * printed on an object families keep: it promised the library would never
 * respond to a book that was lost or wrecked, which is not a promise anyone
 * asked to make. The card asks for the book back and asks to be told early.
 * What the library does after that is a conversation with a librarian, not a
 * line of small print.
 */
export function shortRules(rules: CardRules | null): string[] {
  const keep = rules
    ? `Bring a book back within ${rules.borrowingPeriodDays} days`
    : "Bring a book back on time";

  return [
    keep,
    "Ask the librarian before a book goes home",
    "Keep it clean, dry and safe",
    "If anything happens to a book, tell the librarian",
  ];
}

/** The filename a download lands under. Codes are safe; names are not. */
export function cardFileName(memberCode: string | null, extension: "pdf" | "png"): string {
  const stem = memberCode ? `library-card-${memberCode}` : "library-card";
  return `${stem}.${extension}`;
}

export const CARD_MESSAGES = {
  title: "My library card",
  /** On the page above the card, for a reader who has just found this screen. */
  intro:
    "This is your card. Show it at the library room, or keep a copy on the phone you borrow books with.",
  downloadPng: "Download as a picture",
  downloadPdf: "Download as a PDF",
  preparing: "Getting it ready…",
  /** When the browser cannot draw the picture. The PDF is the fallback. */
  pngFailed: "The picture would not save. The PDF below works the same way.",
  specimenName: "Your child’s name goes here",
  notAMember:
    "Library cards belong to readers. Staff accounts do not have one — open a reader’s page at the desk instead.",
} as const;
