/**
 * The three pages every portal is expected to have, and this one did not.
 *
 * Kept as data in one isomorphic module rather than as JSX in three route
 * files, for two reasons. The pages have to be testable — a privacy notice that
 * quietly stops matching the software is worse than none, and
 * `tests/unit/legal.test.ts` reads these strings. And the library's own name,
 * room and contact details are configuration, never literals: every sentence
 * below that needs one takes it as an argument, which is also what keeps this
 * file inside the lint rule that forbids any library's name in `src/`.
 *
 * ------------------------------------------------------------------------
 * NOT LEGAL ADVICE, AND NOT YET REVIEWED BY A LAWYER.
 *
 * Everything here is an accurate description of what this software actually
 * does with a child's information — written from the schema and the services,
 * not from a template. That makes it honest, and honest is the hard part. It
 * does not make it compliant with the DPDP Act 2023 or with anything else, and
 * a children's library holding data about minors is exactly the case where the
 * gap between "true" and "sufficient" matters. Have it read by somebody
 * qualified before treating it as the library's legal position.
 *
 * The same caveat is already on `src/lib/consent.ts`, which is the other half
 * of this and has been waiting longer.
 * ------------------------------------------------------------------------
 */

import { describeRetention, type RetentionPolicy } from "@/lib/retention";

export interface LegalSection {
  heading: string;
  /** Plain paragraphs. */
  paragraphs?: string[];
  /** A list, when the content is genuinely a list and not prose pretending. */
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  /** One sentence under the title, saying who the page is for. */
  standfirst: string;
  sections: LegalSection[];
}

/**
 * When these pages were last rewritten, as a plain date string.
 *
 * A date typed by whoever edits the page, not `new Date()`. A "last updated"
 * that follows the clock is a lie that renews itself daily, and it is the one
 * fact on a policy page a reader is entitled to rely on.
 */
export const LEGAL_LAST_UPDATED = "26 August 2026";

export interface LegalContext {
  libraryName: string;
  communityName: string;
  venueAddress: string;
  contactEmail: string | null;
}

/** Falls back to the room rather than printing an empty sentence. */
function contactSentence(context: LegalContext): string {
  return context.contactEmail
    ? `Write to ${context.contactEmail}, or speak to a librarian in the ${context.venueAddress}.`
    : `Speak to a librarian in the ${context.venueAddress}.`;
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * The retention periods are a second argument rather than part of `LegalContext`
 * because this is the only one of the four documents that needs them — and
 * because they must come from the same settings row the nightly erasing pass
 * reads. A notice promising a schedule the software is not keeping would be the
 * one failure mode of this page that actually matters.
 */
export function privacyDocument(
  context: LegalContext,
  retention: RetentionPolicy,
): LegalDocument {
  return {
    title: "Privacy notice",
    standfirst: `What ${context.libraryName} keeps about your child, why, and how to change or close it.`,
    sections: [
      {
        heading: "Who runs this library",
        paragraphs: [
          `${context.libraryName} is a free, volunteer-run library for children in ${context.communityName}. It is not a business, it sells nothing, and it has no advertisers.`,
          `The people who can see a child's record are the librarians and the administrator, all of whom are neighbours who live here. ${contactSentence(context)}`,
        ],
      },
      {
        heading: "What we hold about a child",
        paragraphs: [
          "Only what is needed to lend a book to the right child and let a grown-up reach them. Specifically:",
        ],
        bullets: [
          "Their first name or the name they chose to be known by.",
          "Their year of birth — the year only, never a full date of birth. We record this so we know a reader is roughly the right age for the library, and a year is enough for that.",
          "Their flat number, so a librarian knows where a book has gone.",
          "A picture, if a grown-up chose to add one: either a cartoon avatar or a photograph.",
          "Which books they have borrowed, when, and when each came back.",
          "Any rating or short review they have written about a book.",
          "The name, email address and phone number of the grown-up who signed them up.",
        ],
      },
      {
        heading: "What we deliberately do not hold",
        bullets: [
          "A full date of birth. Only the year.",
          "A home address beyond the flat number, a school, or any government identifier.",
          "Any payment detail. Nothing here costs anything.",
          "Any tracking of what a child reads on the site. There are no analytics, no advertising pixels and no third-party trackers on the pages children use.",
          "A child's password. It is stored as a one-way hash, so nobody at the library — including the administrator — can read it or tell it to anyone.",
        ],
      },
      {
        heading: "Photographs of children",
        paragraphs: [
          "A child's photograph is private. It is shown to that child, on their own page, and to a librarian at the desk — and to nobody else, ever.",
          "Photographs are never public, never included in anything the library publishes, and never sent to any other service. Each request for the image file is authorised on its own, so a link to it cannot be shared and made to work for somebody who is not allowed to see it.",
          "A grown-up can remove a child's photograph at any time by asking a librarian.",
        ],
      },
      {
        heading: "The AI Librarian",
        paragraphs: [
          "This site has an AI helper that answers questions about books and suggests what a child might read next. It is a service called Groq, run by a company outside India, and it is worth being precise about what reaches it.",
          "What is sent: the title, author and shelf of the book being asked about, or — when suggesting what to read next — the titles of books the child has borrowed and any star ratings they gave them.",
          "What is never sent: a child's name, library card number, age, year of birth, flat number, photograph, or any contact detail. There is nothing in what leaves this library that could identify which child is asking.",
          "Conversations with the AI Librarian are not stored by this library. Suggestions are stored as a short list of book numbers so the page loads quickly, and each new suggestion replaces the last one — we do not keep a history of what a child has been recommended.",
        ],
      },
      {
        heading: "Email",
        paragraphs: [
          "Email to a grown-up — an invitation, a reminder that a book is due, a password reset — is sent through a delivery service called Brevo, which needs the recipient's address in order to deliver it.",
          "We never email a child directly. Password reset links always go to the grown-up on the account.",
        ],
      },
      {
        heading: "Where the information lives",
        paragraphs: [
          "The library's database is hosted by Neon and the site itself by Vercel, both running in Singapore, which is the nearest region either offers to here. Book cover pictures and children's photographs are held in Vercel's file storage.",
          "The site sets one cookie, which is what keeps a reader signed in. It cannot be read by scripts in the page, it is not used to follow anybody around the internet, and signing out deletes the session on the server rather than only in the browser.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "When a reader grows out of the library, or a family leaves the building, the account is closed rather than deleted straight away: they can no longer sign in and can no longer borrow, but the record of which books they borrowed stays, so the library's own history stays honest.",
          "Accounts are deleted outright only when they were created by mistake — a test account, or one entered with the wrong details.",
          // Generated from the settings the erasing pass actually runs on, so
          // this paragraph cannot drift away from what the software does.
          ...describeRetention(retention),
          "A grown-up may ask for their child's record to be removed sooner. Tell a librarian and they will explain exactly what can go and what has to stay in the lending history.",
        ],
      },
      {
        heading: "Correcting something",
        paragraphs: [
          "A reader can propose a correction to their own name, flat or grown-up's contact details from their own page. Nothing changes until the administrator approves it — which is deliberate, because one of those fields is where a password reset link would be sent.",
          `A grown-up can ask a librarian to correct anything at all. ${contactSentence(context)}`,
        ],
      },
      {
        heading: "If something goes wrong",
        paragraphs: [
          `Tell us. ${contactSentence(context)} If information about a child has been seen by somebody who should not have seen it, we will tell the family concerned.`,
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export function termsDocument(context: LegalContext): LegalDocument {
  return {
    title: "Terms of use",
    standfirst: `The plain arrangement between ${context.libraryName} and the families who use it.`,
    sections: [
      {
        heading: "What this is",
        paragraphs: [
          `${context.libraryName} is a free lending library for children who live in ${context.communityName}, run by volunteers from the same corridors. Membership is free, borrowing is free, and there is nothing to buy anywhere on this site.`,
          "The books belong to the library and are lent, never sold.",
        ],
      },
      {
        heading: "Who can join",
        paragraphs: [
          "Children who live in this building, whether their family owns their flat or rents it. A grown-up fills in the form; the library does not sign a child up on the word of another child.",
          "Any reader may borrow any book, whatever their age. The age shown on a book is a suggestion about who it was written for, not a rule about who may take it home.",
        ],
      },
      {
        heading: "Borrowing",
        paragraphs: [
          "A librarian decides what goes home and when. Asking for a book on this site is a request, not a booking — the shelf may say a book is available and a librarian may still have promised it to somebody standing in front of them.",
          "Please bring books back by the date on your own page so the next reader can have them, and look after them while you have them. If a book is damaged or lost, tell a librarian. Accidents happen and nobody will be cross.",
        ],
      },
      {
        heading: "Giving a book",
        paragraphs: [
          "Donating a book is entirely optional and is never a condition of joining or of borrowing. Donors are thanked by name, by flat, or not at all — whichever they chose when they gave the book.",
          "The library keeps no leaderboard of who has given the most, and never will.",
        ],
      },
      {
        heading: "Writing about a book",
        paragraphs: [
          "Readers can rate a book they have borrowed and add a few words about it. A librarian reads every review before it appears, and a published review shows the reader's first name only.",
          "Please write about the book rather than about another person. A review that names another child, gives away where somebody lives, or is unkind will not be published.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "Your secret word is yours. Do not share it, and do not sign in as somebody else. If you think another person knows it, change it and tell a librarian.",
          "Always sign out on a shared device in the library room.",
          "The library can suspend or close an account — for example when a reader grows out of the library or a family leaves. Nothing is deleted when that happens; see the privacy notice.",
        ],
      },
      {
        heading: "The AI Librarian",
        paragraphs: [
          "The AI Librarian is a computer, and computers get things wrong. It is there to help a child pick a book and answer a passing curiosity — not to do homework, and not to replace the librarian in the room.",
          "It talks about books and nothing else. It never decides what a child may borrow.",
        ],
      },
      {
        heading: "This site",
        paragraphs: [
          "The library runs this site as best it can, in evenings and at weekends. It may be unavailable sometimes, and a book shown as available may already be in somebody's bag.",
          "If something on this site is wrong, tell us and we will fix it.",
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export function accessibilityDocument(context: LegalContext): LegalDocument {
  return {
    title: "Accessibility",
    standfirst: "What we have done so this site works for everybody, and what we know is not done.",
    sections: [
      {
        heading: "What we aim for",
        paragraphs: [
          "This site is built for children, including children who read slowly, use a screen reader, or navigate with a keyboard rather than a mouse. We aim to meet WCAG 2.2 at level AA.",
        ],
      },
      {
        heading: "What is in place",
        bullets: [
          "Every page works with the keyboard alone, and the focused element is always visible.",
          "Text colours are checked against the background they actually sit on, not against white.",
          "Nothing important is said by colour alone — a status always carries its word as well as its colour.",
          "Text can be enlarged in the browser without the page breaking, and no page scrolls sideways on a phone.",
          "Animation is switched off for anyone whose device asks for reduced motion.",
          "Every picture that carries meaning has a text description; decorative ones are hidden from screen readers.",
          "The catalogue works with JavaScript switched off — searching and filtering happen on the server.",
        ],
      },
      {
        heading: "What we know is not perfect",
        bullets: [
          "Book cover pictures are described by the book's title, which is useful but is not a description of the picture itself.",
          "The AI Librarian's answers are written by a language model and are not checked for reading level beyond the instruction it is given.",
          "This site has not been tested by a professional accessibility auditor, or with a wide range of assistive technology.",
        ],
      },
      {
        heading: "Tell us",
        paragraphs: [
          `If any part of this site is hard to use, we want to know — it is the only way we find out. ${contactSentence(context)}`,
        ],
      },
    ],
  };
}
