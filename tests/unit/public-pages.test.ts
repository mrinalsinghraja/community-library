import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BORROW_REQUEST_MESSAGES } from "@/lib/circulation";

/**
 * The two pages the library hands to families, checked at the source.
 *
 * These are server components that read the database, so there is no cheap way
 * to render them in a unit test — and rendering them would prove the least
 * interesting half anyway. What matters about both pages is a property of how
 * they are written:
 *
 *   * the rules page must take every number from `library_settings`, so that
 *     changing the borrowing limit in the admin screen changes the rules a
 *     child reads. A literal "2 books" here would be a second copy of the rules
 *     that quietly disagrees with the first.
 *
 *   * the donor page now prints a count, because the owner asked for the
 *     register the community can read (ADR-046). What it must never grow is the
 *     rest of a leaderboard: no total, no ordering by generosity, no "top" -- and
 *     a family who asked not to be named must not find themselves on it at all.
 *
 * The browser walkthrough covers what they look like. This covers what they can
 * never become.
 */

const read = (path: string) => readFileSync(join(process.cwd(), "src", "app", path), "utf8");

/** Prose wraps across lines in JSX; a sentence is easier to look for unwrapped. */
const flattened = (source: string) => source.replace(/\s+/g, " ");

/**
 * The file with its comments taken out.
 *
 * Both pages explain in prose what they deliberately do NOT do — "no total, no
 * top donor, no leaderboard" — so a naive search for those words finds the
 * promise rather than a breach of it. What these tests are about is the code
 * and the rendered copy.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const RULES = read(join("rules", "page.tsx"));
const DONORS = read(join("donors", "page.tsx"));
const DONOR_GIFTS = read(join("donors", "[donor]", "page.tsx"));

describe("the rules page", () => {
  it("reads every borrowing number from settings", () => {
    for (const field of [
      "settings.maxActiveLoans",
      "settings.borrowingPeriodDays",
      "settings.maxRenewals",
      "settings.renewalPeriodDays",
    ]) {
      expect(RULES, `the rules must come from ${field}`).toContain(field);
    }
  });

  it("hard-codes no borrowing number of its own", () => {
    /*
     * The failure this prevents: somebody writes "You can have 2 books for 14
     * days" into the copy, an administrator later changes the loan period to
     * ten, and the page keeps telling children fourteen.
     *
     * Only digits that appear as words in a sentence are interesting, so this
     * looks inside the rule text rather than at the whole file — class names
     * are full of numbers and none of them are policy.
     */
    const sentences = [...RULES.matchAll(/body:\s*(`[^`]*`|"[^"]*")/g)].map((match) => match[1]);
    expect(sentences.length).toBeGreaterThan(5);

    for (const sentence of sentences) {
      expect(sentence, `a rule states a number directly: ${sentence}`).not.toMatch(/\b\d+\b/);
    }
  });

  it("tells a child a book does not leave the room until it is issued", () => {
    // The one rule the software cannot enforce, and therefore the one that has
    // to be said. Shared wording, so the rules page, the book page and the
    // child's own shelf cannot drift apart.
    expect(RULES).toContain("BORROW_REQUEST_MESSAGES.collectionNote");
    expect(BORROW_REQUEST_MESSAGES.collectionNote).toMatch(/librarian hands one over/i);
  });

  it("is rendered per request, so a settings change shows up at once", () => {
    expect(RULES).toContain('export const dynamic = "force-dynamic"');
  });

  it("is not a terms-and-conditions page", () => {
    // Checked against the rendered prose rather than the whole file: the source
    // comment above the component says what this page is *not*, and may.
    const prose = flattened(code(RULES)).toLowerCase();

    for (const legalese of ["hereby", "liability", "i agree", "shall be deemed", "you consent"]) {
      expect(prose, `the rules must not read like a contract: ${legalese}`).not.toContain(legalese);
    }
  });
});

describe("the donor page", () => {
  it("is open to a visitor who has not signed in", () => {
    /*
     * The whole point of the page. Somebody deciding whether to carry a box of
     * outgrown books downstairs does not have an account, and the version of
     * this page that sent them to /login first was the version nobody outside
     * the library ever read.
     */
    expect(DONORS).not.toContain("redirect(");
    expect(DONORS).not.toContain("requireActor");
    expect(DONORS).not.toContain("/login");
  });

  it("prints a count with its unit, never a bare number", () => {
    /*
     * "3 books" is a fact about a family. A bare "3" in a column is a score,
     * and the next person to read the page compares it with the row above.
     */
    const source = code(DONORS);
    expect(source).toMatch(/bookCount === 1 \? "1 book"/);
    expect(source, "a bare count was rendered").not.toMatch(/[^$]\{\s*entry\.bookCount\s*\}/);
  });

  it("adds nothing up and ranks nobody", () => {
    for (const forbidden of [
      /\.sort\(/, // ordering belongs to the service, and it is alphabetical
      /\.reduce\(/, // the shape a total arrives in
      /\btotalBooks\b|\btotalGiven\b|\bmostBooks\b/,
      /\btop donor/i,
      /\bleaderboard\b/i,
      /\branking\b/i,
      /\bmost generous\b/i,
    ]) {
      expect(code(DONORS), `the donor page must not ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("says that giving is voluntary", () => {
    const prose = flattened(code(DONORS));
    expect(prose).toMatch(/free and always will be/i);
    expect(prose).toMatch(/never a condition/i);
  });

  it("has a friendly empty state rather than an empty page", () => {
    expect(DONORS).toContain("entries.length === 0");
    expect(DONORS).toContain("EmptyState");
  });

  it("takes the donation address from settings rather than typing one in", () => {
    /*
     * The same rule as every borrowing number on the rules page. An address in
     * the source is an address that keeps being printed for a year after the
     * mailbox stops being read, and it is one library's address hard-coded into
     * a platform that is built for more than one.
     */
    expect(DONORS).toContain("branding.contactEmail");
    expect(code(DONORS), "an email address was written into the page").not.toMatch(
      /[\w.+-]+@[\w-]+\.[\w.]+/,
    );
  });
});

describe("one family's page", () => {
  it("never touches the raw donor columns", () => {
    // Whether a name may be printed was decided in the service, from the
    // consent the family gave. A page that reads `donorName` has decided for
    // itself instead.
    // Read past the comments: both files explain the consent rule in prose, and
    // naming the column while explaining it is the opposite of breaking it.
    for (const source of [DONORS, DONOR_GIFTS]) {
      expect(code(source)).not.toContain("donorName");
      expect(code(source)).not.toContain("donorApartment");
      expect(code(source)).not.toContain("displayConsent");
    }
  });

  it("does not turn a thank-you into a way around the catalogue", () => {
    /*
     * A shelf of jackets is what makes the next neighbour want to add to it, so
     * the covers are here -- served through the narrow exception in
     * getAuthorizedMedia that allows a cover carrying a credited donation and
     * refuses every other one. What stays off is the catalogue's own furniture:
     * status, shelf, reading age and condition describe where a book is now,
     * and this page is about where it came from.
     */
    expect(DONOR_GIFTS).toContain("BookCover");
    expect(DONOR_GIFTS).toContain("canOpenBooks");
    expect(DONOR_GIFTS).toContain("catalogueIsPubliclyVisible");

    for (const catalogueOnly of [
      "StatusBadge",
      "statusDefinition",
      "ageGroupLabel",
      "categoryName",
      "condition",
    ]) {
      expect(code(DONOR_GIFTS), `${catalogueOnly} belongs to the catalogue`).not.toContain(
        catalogueOnly,
      );
    }
  });

  it("prints the year on the register, because flats get rented", () => {
    // The same flat number five years apart is often a different household. A
    // register without a year reads those two families as one that grew.
    expect(DONORS).toContain("Year given");
    expect(DONORS).toContain("yearsGiven");
    expect(code(DONORS)).toContain("entry.firstYear");
    expect(code(DONORS)).toContain("entry.lastYear");
  });

  it("opens as a page rather than as a certificate", () => {
    // A framed plate at the top reads as an award the library gave itself.
    for (const source of [DONORS, DONOR_GIFTS]) {
      expect(code(source)).not.toContain("Bookplate");
    }
  });

  it("is rendered per request, like the register it is reached from", () => {
    expect(DONORS).toContain('export const dynamic = "force-dynamic"');
    expect(DONOR_GIFTS).toContain('export const dynamic = "force-dynamic"');
  });
});
