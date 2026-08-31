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
    allowRenewalWhenOverdue: boolean;
    blockOnOverdueDays: number;
    copyCodePrefix: string;
    copyCodePadding: number;
    memberCodePrefix: string;
    memberCodePadding: number;
    catalogueVisibility: "MEMBER_ONLY" | "PUBLIC";
    primaryColor: string;
    secondaryColor: string;
    welcomeMessage: string;
    venueName: string;
    venueAddress: string;
    eligibilityNote: string;
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
    ageMax: 16,
    /*
     * The circulation rules, and the only place they are written down.
     *
     * Fourteen days, two books at a time, one renewal. Small numbers on
     * purpose: a shelf of a few hundred books in a corner of the Yoga Room
     * works when books come back, and a child who may hold six for a month is
     * a child holding books nobody else can read.
     *
     * `renewalPeriodDays: 14` matches the borrowing period, so one renewal
     * doubles the loan: issued 17 August, due 31 August, renewed to 14
     * September. The platform default is 7 — a shorter second stretch, which
     * suits a busier library — and this deployment deliberately differs from
     * it. **The owner locked this at 14 on 18 August 2026; see ADR-032.**
     *
     * Note what is absent from this file: `overdueRemindersEnabled`. Reminders
     * are off, and a value the seed does not write cannot be switched on by
     * re-running the seed. Turning them on is a deliberate act on a live
     * database, and only once the conditions in ADR-032 are met.
     */
    borrowingPeriodDays: 14,
    maxActiveLoans: 2,
    maxRenewals: 1,
    renewalPeriodDays: 14,
    /*
     * A book past its date is not renewed. Bring it to the desk, the librarian
     * takes it back, and it can go straight out again in the same minute — the
     * same outcome, reached with somebody holding the book. See
     * docs/CIRCULATION.md §"Overdue and renewal".
     */
    allowRenewalWhenOverdue: false,
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
    /*
     * Where the books physically are, and who the library is for.
     *
     * Three strings and not one, because they are read in three different
     * sentences and composing any of them from the others produced text that
     * read like a form letter: `venueName` drops into "come to the ___",
     * `venueAddress` is what somebody would write on a note to a neighbour, and
     * `eligibilityNote` answers "may my child join?" in the library's own voice.
     *
     * The eligibility line names owners and tenants explicitly. A library that
     * says only "residents" is a library a renting family has to ask about, and
     * the asking is the barrier — so the answer is on the page before the
     * question forms.
     */
    venueName: "Yoga Room",
    venueAddress: "Yoga Room, Mana Jardin Apartment",
    eligibilityNote:
      "The library is for children who live at Mana Jardin Apartment — whether your family owns your flat or rents it.",
    timezone: "Asia/Kolkata",
    consentVersion: CONSENT_VERSION_VALUE,
  },
  /*
   * The five starting shelves, from src/lib/catalogue.ts.
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
