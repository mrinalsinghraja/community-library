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

import { CONSENT_VERSION as CONSENT_VERSION_VALUE } from "../../src/lib/consent";

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
    consentVersion: CONSENT_VERSION_VALUE,
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
 * Consent wording is NOT defined here.
 *
 * It lives in `src/lib/consent.ts` so that the registration form, the stored
 * snapshot, the emails and the seed all render the identical text. A second
 * copy of consent wording would be a second version of what a family agreed to.
 */
export { CONSENT_TEXTS as CONSENT_TEXT, CONSENT_VERSION } from "../../src/lib/consent";
