/**
 * Parental consent wording.
 *
 * ⚠️  LEGAL REVIEW REQUIRED BEFORE PRODUCTION USE.
 *
 * India's Digital Personal Data Protection Act, 2023 requires verifiable
 * parental consent for processing a child's personal data. This file provides
 * the *technical* foundation for that: versioned wording, a verbatim snapshot
 * stored on every record, a declared verification method, and withdrawal.
 *
 * It does NOT establish legal compliance. Neither this wording nor the strength
 * of verification implemented here (a guardian ticking a box on a web form) has
 * been reviewed by a lawyer, and either may need to change. See docs/CONSENT.md.
 *
 * The wording lives in `src/lib/` rather than in the seed so that the form, the
 * emails, the stored snapshot and the seed all render the identical text — a
 * second copy of consent wording is a second version of what a family agreed to.
 *
 * Deliberately community-agnostic: it says "the library", never a name, so the
 * platform stays reusable and the branding rule holds.
 */

export const CURRENT_CONSENT_TYPES = [
  "CHILD_ACCOUNT_CREATION",
  "CHILD_PHOTO_STORAGE",
  "GUARDIAN_EMAIL_NOTIFICATIONS",
  "READERS_BOARD",
] as const;

export type ConsentTypeKey = (typeof CURRENT_CONSENT_TYPES)[number];

/**
 * The version identifier stored with every consent record.
 *
 * CHANGING ANY WORDING BELOW REQUIRES BUMPING THIS. Records keep the version
 * and the snapshot they were granted under, so history stays intact — but a new
 * version signals that existing consents were granted against different text.
 */
export const CONSENT_VERSION = "2026-08-v2";

export const CONSENT_TEXTS: Record<ConsentTypeKey, string> = {
  CHILD_ACCOUNT_CREATION: `I am the parent or guardian of this child, and I agree to the library creating a membership account for them.

I understand the library will hold my child's name, their year of birth, our flat number, and my own name, phone number and email address. This information is used only to run the library — to issue and return books, to reach me if something needs saying, and to keep the library's own records.

I understand this information is never sold, never used for advertising or any other commercial purpose, and is never shared with anyone outside the library except where the law requires it.

I understand I can ask the librarian to correct or delete any of it at any time, and that it is removed when my child's membership ends.`,

  CHILD_PHOTO_STORAGE: `Adding a photograph is optional. Choosing one of the library's avatars instead is equally welcome and gives my child exactly the same membership.

I agree to the library holding the photograph I have uploaded of my child, and I understand it is used only inside the library's own software — so that the librarian can recognise my child at the desk, and so my child sees their own picture on their account.

I understand the photograph is never sold, never used for advertising or any other commercial purpose, never given to any other organisation, and never posted on social media, a public website or anywhere else outside this library.

I understand the photograph is not shown to other families unless I separately agree to the readers' board, which is asked as its own question and which I am free to decline.

I understand I can ask for the photograph to be removed at any time, and that it is deleted when my child's membership ends.`,

  GUARDIAN_EMAIL_NOTIFICATIONS: `I agree to the library emailing me about my child's membership — links to set up or recover their account, reminders that a book is due back, and occasional notices about the library itself.

I understand these are not marketing emails, that my address is never sold or passed to anyone else, and that it is used for nothing but running my child's membership.

I understand I can ask the librarian to stop these at any time, though some messages — such as an account set-up link — may then have to reach me another way.`,

  READERS_BOARD: `This is optional, and I am free to say no. My child's membership, and every book they can borrow, is exactly the same either way.

I agree to my child's first name, together with the photograph or avatar on their account, appearing on the library's readers' board: a card celebrating five children who read a lot during the month just gone.

I understand the board is not a competition. The five appear together in alphabetical order, with no places, no scores, and no number of books shown for anybody.

I understand only my child's first name appears — never our surname, never our flat number, and never their library card number.

I understand the board is shown only inside the library's own software, to other members and to library staff who are signed in. It is not visible to the public, not open to search engines, never used for advertising or any other commercial purpose, and never shared with anyone outside the library.

I understand I can withdraw this at any time by telling the librarian, and that my child stops appearing straight away.`,
};

/** Short labels for the registration form's checkboxes. */
export const CONSENT_LABELS: Record<ConsentTypeKey, string> = {
  CHILD_ACCOUNT_CREATION: "I am this child's parent or guardian, and I agree to their library account",
  CHILD_PHOTO_STORAGE: "The library may keep the photo I uploaded (optional)",
  GUARDIAN_EMAIL_NOTIFICATIONS: "The library may email me about my child's membership",
  READERS_BOARD: "My child may appear on the readers' board (optional)",
};

/**
 * Consents a registration cannot proceed without. Photo consent is required
 * only when a photo is actually uploaded, and email consent is required because
 * the guardian's inbox is the only account-recovery channel a child has.
 */
export const REQUIRED_CONSENT_TYPES: readonly ConsentTypeKey[] = [
  "CHILD_ACCOUNT_CREATION",
  "GUARDIAN_EMAIL_NOTIFICATIONS",
];
