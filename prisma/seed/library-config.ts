/**
 * THE ONLY PLACE "Mana Jardin" APPEARS.
 *
 * Everything specific to the first community lives in this file, as seed input.
 * Application code reads all of it from the database via getLibrarySettings().
 * A second community deploys the same code with a different file — or, later,
 * a different row.
 *
 * A lint rule (see eslint.config.mjs) forbids these literals anywhere under
 * src/, so the platform cannot quietly become single-tenant.
 */

export interface LibraryConfigInput {
  community: {
    name: string;
    slug: string;
    city: string;
    addressLine: string | null;
  };
  library: {
    name: string;
    slug: string;
    description: string;
  };
  settings: {
    ageMin: number;
    ageMax: number;
    borrowingPeriodDays: number;
    maxActiveLoans: number;
    maxRenewals: number;
    renewalPeriodDays: number;
    blockOnOverdueDays: number;
    copyCodePrefix: string;
    copyCodePadding: number;
    memberCodePrefix: string;
    memberCodePadding: number;
    catalogueVisibility: "MEMBER_ONLY" | "PUBLIC";
    primaryColor: string;
    secondaryColor: string;
    welcomeMessage: string;
    timezone: string;
    consentVersion: string;
  };
  categories: ReadonlyArray<{ name: string; slug: string; icon: string }>;
}

export const MANA_JARDIN: LibraryConfigInput = {
  community: {
    name: "Mana Jardin",
    slug: "mana-jardin",
    city: "Bengaluru",
    addressLine: null,
  },
  library: {
    name: "Mana Jardin Children's Library",
    slug: "mana-jardin-childrens-library",
    description:
      "A free community library for young readers, kept in a corner of the Yoga Room and grown by the families who live here.",
  },
  settings: {
    ageMin: 5,
    ageMax: 14,
    borrowingPeriodDays: 14,
    maxActiveLoans: 2,
    maxRenewals: 1,
    renewalPeriodDays: 7,
    blockOnOverdueDays: 7,
    copyCodePrefix: "MJCL",
    copyCodePadding: 4,
    memberCodePrefix: "MJCL-R",
    memberCodePadding: 4,
    // The owner's decision for this deployment: the shelf stays behind the
    // front door. Changeable by a Super Admin at any time.
    catalogueVisibility: "MEMBER_ONLY",
    primaryColor: "#1F6F5C",
    secondaryColor: "#E4572E",
    welcomeMessage: "Welcome to Mana Jardin Children's Library 📚",
    timezone: "Asia/Kolkata",
    consentVersion: "2026-08-v1",
  },
  categories: [
    { name: "Story Books", slug: "story-books", icon: "📖" },
    { name: "Picture Books", slug: "picture-books", icon: "🎨" },
    { name: "Comics", slug: "comics", icon: "💥" },
    { name: "Adventure", slug: "adventure", icon: "🗺️" },
    { name: "Fantasy", slug: "fantasy", icon: "🐉" },
    { name: "Animals", slug: "animals", icon: "🦊" },
    { name: "Space", slug: "space", icon: "🚀" },
    { name: "Science", slug: "science", icon: "🔬" },
    { name: "General Knowledge", slug: "general-knowledge", icon: "🌍" },
    { name: "History", slug: "history", icon: "🏛️" },
    { name: "Biography", slug: "biography", icon: "⭐" },
    { name: "Educational", slug: "educational", icon: "✏️" },
    { name: "Activity Books", slug: "activity-books", icon: "🧩" },
    { name: "Young Readers", slug: "young-readers", icon: "🌱" },
  ],
};

/**
 * The consent wording shown to a guardian at registration.
 *
 * Stored verbatim on every consent record, so a later change to this text can
 * never rewrite what somebody actually agreed to.
 *
 * IMPORTANT: this wording has NOT been reviewed by a lawyer. See docs/SECURITY.md
 * — India's DPDP Act 2023 requires verifiable parental consent for a child's
 * personal data, and both the wording and the strength of verification must be
 * reviewed against the applicable rules before this is used in production.
 */
export const CONSENT_TEXT: Record<string, string> = {
  CHILD_ACCOUNT_CREATION: `I am the parent or guardian of this child, and I agree to the library creating a membership account for them.

I understand that the library will store my child's name, date of birth, our flat number, and my own name, phone number and email address, and that this information is used only to run the library.

I understand that I can ask the librarian to correct or delete this information at any time.`,

  CHILD_PHOTO_STORAGE: `I agree to the library storing the photograph I have uploaded of my child.

I understand the photograph is kept privately, is shown only to my child and to library staff, is never published, and can be removed at any time on request. I understand that choosing an avatar instead is equally acceptable and gives my child exactly the same membership.`,

  GUARDIAN_EMAIL_NOTIFICATIONS: `I agree to the library emailing me about my child's membership — activation and password links, reminders that a book is due back, and occasional library notices.

I understand these are not marketing emails and that the library will never pass my details to anyone else.`,
};
