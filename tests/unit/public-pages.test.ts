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
 *   * the donor page must not count anything. No totals, no ordering by
 *     generosity, no "top". A family who gave thirty books and a family who
 *     gave one gave the same thing, and a family who cannot give at all must be
 *     able to open the page without being shown where they rank.
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
  it("counts nothing and ranks nobody", () => {
    // Whole words: "top" as a word is a leaderboard, "top-6" is a margin.
    for (const forbidden of [
      /credits\.length\s*>/,
      /\.sort\(/,
      /\btop donor/i,
      /\bleaderboard\b/i,
      /\branking\b/i,
      /\bmost generous\b/i,
      /totalBooks|donationCount|bookCount/,
    ]) {
      expect(code(DONORS), `the donor page must not ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("says that giving is voluntary", () => {
    const prose = flattened(code(DONORS));
    expect(prose).toMatch(/completely voluntary/i);
    expect(prose).toMatch(/never depends on giving/i);
  });

  it("has a friendly empty state rather than an empty page", () => {
    expect(DONORS).toContain("credits.length === 0");
    expect(DONORS).toContain("EmptyState");
  });

  it("renders only the acknowledgement the donor chose", () => {
    // Not the donor name, not the flat, not the date — one string, built by the
    // service from the consent the family gave.
    expect(DONORS).toContain("credit.acknowledgement");
    expect(DONORS).not.toContain("donorName");
    expect(DONORS).not.toContain("donorApartment");
  });
});
