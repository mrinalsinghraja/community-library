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

I understand that the library will store my child's name, date of birth, our flat number, and my own name, phone number and email address, and that this information is used only to run the library.

I understand that I can ask the librarian to correct or delete this information at any time.`,

  CHILD_PHOTO_STORAGE: `I agree to the library storing the photograph I have uploaded of my child.

I understand the photograph is kept privately and is shown only to my child and to library staff. It is never posted anywhere outside the library's own website, and it is never shown to other families unless I separately agree to the readers' board — which is a different question, asked on its own, and which I do not have to say yes to.

I understand the photograph can be removed at any time on request, and that choosing an avatar instead is equally acceptable and gives my child exactly the same membership.`,

  GUARDIAN_EMAIL_NOTIFICATIONS: `I agree to the library emailing me about my child's membership — activation and password links, reminders that a book is due back, and occasional library notices.

I understand these are not marketing emails and that the library will never pass my details to anyone else.`,

  READERS_BOARD: `I agree to my child's first name, and the photograph or avatar on their account, appearing on the library's readers' board.

I understand this board is seen by every other child and family who signs in to the library, that it shows five children who read a lot in the month just gone, and that it is not a competition — the five are shown together, in alphabetical order, with no places and no scores.

I understand only my child's first name is ever shown — never our surname, our flat number or their library card number — and that I can withdraw this at any time, after which my child stops appearing immediately.

I understand my child's membership is exactly the same whether I agree to this or not.`,
};

/** Short labels for the registration form's checkboxes. */
export const CONSENT_LABELS: Record<ConsentTypeKey, string> = {
  CHILD_ACCOUNT_CREATION: "I am this child's parent or guardian, and I agree to their library account",
  CHILD_PHOTO_STORAGE: "I agree to the library storing the photo I uploaded",
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
