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

import { DEFAULT_CATEGORIES } from "../../src/lib/catalogue";
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
    /*
     * One house style, two namespaces: the community's initials, then a letter
     * saying what kind of thing this is — "B" for a book on the shelf, "R" for
     * a reader's card — then a four-digit number.
     *
     * The two sequences are independent and always were, so the seventh book
     * and the seventh card carry the same number. They no longer carry the same
     * string: MJCL-B0007 is a book, MJCL-R0007 is a child. Nothing in the
     * application infers a kind from the letter — see docs/IDENTITY.md §"Two
     * kinds of code, two namespaces" for why that separation is for humans.
     */
    copyCodePrefix: "MJCL-B",
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
  /*
   * The seven starting shelves, from src/lib/catalogue.ts.
   *
   * Not listed here because they are not specific to this community — every new
   * library starts with the same seven, and an administrator adds more from the
   * admin screens afterwards. Phase 0 seeded fourteen; Version 1 of the
   * catalogue deliberately narrows that to a list a volunteer can hold in their
   * head. `npm run db:seed` retires the unused ones (see seedCategories).
   */
  categories: DEFAULT_CATEGORIES,
};

/**
 * Consent wording is NOT defined here.
 *
 * It lives in `src/lib/consent.ts` so that the registration form, the stored
 * snapshot, the emails and the seed all render the identical text. A second
 * copy of consent wording would be a second version of what a family agreed to.
 */
export { CONSENT_TEXTS as CONSENT_TEXT, CONSENT_VERSION } from "../../src/lib/consent";
