import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AGE_GROUPS,
  CONDITIONS,
  DEFAULT_CATEGORIES,
  SELECTABLE_STATUSES,
  STATUSES,
  ageGroupLabel,
  conditionLabel,
  isAgeGroup,
  isCondition,
  isSelectableStatus,
  statusDefinition,
} from "@/lib/catalogue";
import { dateOnlyInTimezone } from "@/lib/dates";

/**
 * The catalogue's vocabulary.
 *
 * Most of what follows asserts that a list is *exactly* what it should be
 * rather than merely containing what it should. That is deliberate: the point
 * of Version 1 of this catalogue is what it leaves out, and a test that only
 * checks for presence would let the list grow back one well-meaning field at a
 * time.
 */

describe("recommended age", () => {
  it("offers exactly the four bands, in order", () => {
    expect(AGE_GROUPS.map((group) => group.label)).toEqual([
      "5–7 years",
      "8–10 years",
      "11–14 years",
      "All Ages",
    ]);
  });

  it("keeps the bounds structured, so nothing has to parse the label", () => {
    // "8–10 years" is a label. 8 and 10 are the data. Anything that needed the
    // numbers back out of the string would be a bug waiting for a re-wording.
    expect(AGE_GROUPS[1]).toMatchObject({ minYears: 8, maxYears: 10 });
    // All Ages genuinely has no bounds rather than a sentinel pair.
    expect(AGE_GROUPS[3]).toMatchObject({ minYears: null, maxYears: null });
  });

  it("throws on an unknown band instead of rendering a shrug", () => {
    // A silent "Unknown" on a child's screen would hide the drift between this
    // module and the database enum.
    expect(() => ageGroupLabel("AGE_99" as never)).toThrow(/unknown age group/i);
  });

  it("recognises only real bands", () => {
    expect(isAgeGroup("AGE_5_7")).toBe(true);
    expect(isAgeGroup("AGE_3_5")).toBe(false);
    expect(isAgeGroup("")).toBe(false);
  });
});

describe("condition", () => {
  it("offers exactly Good, Fair and Damaged", () => {
    expect(CONDITIONS.map((condition) => condition.label)).toEqual(["Good", "Fair", "Damaged"]);
  });

  it("no longer knows the words Phase 0 used", () => {
    // NEW and WORN were dropped in Phase 2: "new" is unverifiable a year later,
    // and "worn" and "damaged" were two words for one shelf decision.
    expect(isCondition("NEW")).toBe(false);
    expect(isCondition("WORN")).toBe(false);
    expect(conditionLabel("DAMAGED")).toBe("Damaged");
  });
});

describe("status", () => {
  it("lets a librarian choose exactly three", () => {
    expect(SELECTABLE_STATUSES).toEqual(["AVAILABLE", "LOST", "DAMAGED"]);
  });

  it("does not let anybody lend a book by picking BORROWED from a dropdown", () => {
    /*
     * BORROWED was pickable in Phase 2, when the catalogue had to describe a
     * shelf that existed before the software did. Circulation owns it now: a
     * copy reads BORROWED because a loan says so, and a database trigger
     * refuses to commit any other arrangement. A dropdown that could set it
     * would be a borrowed book with no borrower.
     */
    expect(isSelectableStatus("BORROWED")).toBe(false);
  });

  it("does not let anybody archive a book by picking it from a list", () => {
    // Archiving is its own audited action with its own reason.
    expect(isSelectableStatus("ARCHIVED")).toBe(false);
  });

  it("does not offer RESERVED, which nothing in Version 1 sets", () => {
    expect(isSelectableStatus("RESERVED")).toBe(false);
  });

  it("gives every status a word for a child as well as one for the desk", () => {
    for (const status of STATUSES) {
      expect(status.readerLabel.length).toBeGreaterThan(0);
      expect(status.staffLabel.length).toBeGreaterThan(0);
      // Colour is never the only carrier: there is always a mark and a word.
      expect(status.mark.length).toBeGreaterThan(0);
    }
  });

  it("says only AVAILABLE means a book can be taken home today", () => {
    expect(statusDefinition("AVAILABLE").onShelf).toBe(true);
    for (const status of STATUSES.filter((entry) => entry.value !== "AVAILABLE")) {
      expect(status.onShelf).toBe(false);
    }
  });

  it("uses no punitive language about a book that is out", () => {
    // Same rule as the loan wording: there are no fines in this library and no
    // copy may imply otherwise.
    const words = STATUSES.map((status) => status.readerLabel.toLowerCase()).join(" ");
    expect(words).not.toMatch(/overdue|fine|penalty|late fee|owe/);
  });
});

describe("categories", () => {
  it("starts a library with exactly the seven agreed shelves", () => {
    expect(DEFAULT_CATEGORIES.map((category) => category.name)).toEqual([
      "Stories",
      "Comics",
      "Science & Knowledge",
      "Adventure & Fantasy",
      "Activity & Learning",
      "Young Readers",
      "Other",
    ]);
  });

  it("gives every shelf a distinct slug", () => {
    const slugs = DEFAULT_CATEGORIES.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("donation dates", () => {
  const kolkata = "Asia/Kolkata";

  it("reads a date picker's value as that day in the library's timezone", () => {
    const instant = dateOnlyInTimezone("2026-08-17", kolkata);

    // Midnight in Kolkata is 18:30 UTC the previous day. `new Date("2026-08-17")`
    // would have given midnight UTC, which is already 05:30 on the 17th here —
    // and for a timezone behind UTC would have been the wrong day entirely.
    expect(instant?.toISOString()).toBe("2026-08-16T18:30:00.000Z");
  });

  it("refuses a date that does not exist", () => {
    // The Date constructor would roll this forward to 3 March without a word.
    expect(dateOnlyInTimezone("2026-02-31", kolkata)).toBeNull();
  });

  it("refuses anything that is not a plain calendar date", () => {
    expect(dateOnlyInTimezone("17/08/2026", kolkata)).toBeNull();
    expect(dateOnlyInTimezone("", kolkata)).toBeNull();
    expect(dateOnlyInTimezone("2026-08-17T10:00:00Z", kolkata)).toBeNull();
  });
});

describe("what Version 1 deliberately does not store", () => {
  /*
   * A structural test, not a stylistic one.
   *
   * Every field below is a field somebody will eventually want to add "just
   * quickly" — they are all standard in library software, which is exactly why
   * the decision to leave them out needs something that notices. Adding any of
   * them should require deleting a line here, which is a conversation rather
   * than a commit.
   *
   * The schema is the right place to check, because a column is what a form
   * grows back from.
   */
  const schema = readFileSync(
    fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
    "utf8",
  );

  const bookTitleModel = /model BookTitle \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

  it("finds the BookTitle model", () => {
    expect(bookTitleModel).toContain("title");
  });

  it.each([
    ["language", /^\s*language\s/m],
    ["ISBN", /^\s*isbn/im],
    ["publisher", /^\s*publisher\s/m],
    ["publication year", /^\s*publicationYear\s/m],
    ["series", /^\s*series\s/m],
    ["description", /^\s*description\s/m],
    ["tags", /^\s*tags\s/m],
    ["keywords", /^\s*keywords\s/m],
    ["price", /^\s*price/im],
  ])("has no %s field on a book", (_name, pattern) => {
    expect(bookTitleModel).not.toMatch(pattern);
  });

  /*
   * Ratings arrived in ADR-057, and this is the shape of them: a relation to
   * `book_review`, and no scalar anywhere on the book itself.
   *
   * The distinction is the whole point rather than a technicality. A cached
   * average or count on this row would have to be recomputed on every write,
   * would drift the first time a librarian hid a review, and would be one more
   * column able to disagree with the truth. Every average in the application is
   * derived at read time from the reviews that are actually visible.
   */
  it("holds reviews as a relation and never as a column", () => {
    expect(bookTitleModel).toMatch(/^\s*reviews\s+BookReview\[\]/m);
  });

  it.each([
    ["rating", /^\s*rating\s+(Int|Float|Decimal)/im],
    ["average rating", /^\s*(ratingAverage|averageRating)\s/im],
    ["rating count", /^\s*(ratingCount|reviewCount)\s/im],
  ])("keeps no cached %s on a book", (_name, pattern) => {
    expect(bookTitleModel).not.toMatch(pattern);
  });

  it("has no donor contact details anywhere in the donation model", () => {
    const donationModel = /model Donation \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

    expect(donationModel).toContain("donorName");
    expect(donationModel).toContain("donorApartment");
    // A name and a flat number are enough to say thank you.
    expect(donationModel).not.toMatch(/^\s*donorPhone\s/m);
    expect(donationModel).not.toMatch(/^\s*donorEmail\s/m);
    expect(donationModel).not.toMatch(/^\s*donorAddress\s/m);
  });

  it("has no counter, total or rank on a donation", () => {
    const donationModel = /model Donation \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";

    // A schema with no counter cannot grow a leaderboard by accident, and this
    // is the test that keeps it that way.
    expect(donationModel).not.toMatch(/count|total|rank|score|leaderboard/i);
  });
});
