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

// ---------------------------------------------------------------------------

describe("the joining guide", () => {
  const GUIDE = read("how-to-join/page.tsx");

  it("answers the flat question this building actually asks", () => {
    /*
     * 140 flats, siblings in most of them, and tenants who change. The
     * behaviour is proved against a real database in
     * `tests/database/registration.test.ts`; what this holds is that the page a
     * parent reads says so, because a parent who believes one card per flat is
     * a parent who never registers their second child.
     */
    const prose = flattened(GUIDE);

    expect(prose).toMatch(/once for each child/i);
    expect(prose).toMatch(/same flat number and the same email/i);
    expect(prose).toMatch(/A flat number is an address, not an account/i);
  });

  it("says which steps are the library's turn, not the parent's", () => {
    // A page that hides the waiting makes a normal delay look like a fault.
    expect(flattened(GUIDE)).toMatch(/This one is our turn/i);
  });

  it("reads the ages from settings rather than printing them", () => {
    // Same rule as the rules page: no second copy of a number that an
    // administrator can change.
    const source = code(GUIDE);

    expect(source).toContain("settings.ageMin");
    expect(source).toContain("settings.ageMax");
    expect(source).not.toMatch(/aged \d+ to \d+/);
  });

  it("never promises an email step the library has not switched on", () => {
    // Guardian verification is a setting. Telling every parent to wait for a
    // confirmation email when the library does not send one is an instruction
    // to wait forever.
    expect(code(GUIDE)).toContain("requiredGuardianVerification");
  });
});

// ---------------------------------------------------------------------------

describe("asking a person for help", () => {
  const readSrc = (...parts: string[]) =>
    readFileSync(join(process.cwd(), "src", ...parts), "utf8");

  const HELP = readSrc("components", "library", "whatsapp-help.tsx");
  const SHELL = readSrc("components", "layout", "site-shell.tsx");
  const HOME = read("page.tsx");

  it("takes the number from settings, never from a literal", () => {
    /*
     * It is a volunteer's personal phone. It belongs in the library's own
     * configuration, where it can be changed without a release and where it is
     * not sitting in a public repository.
     */
    expect(code(HELP)).not.toMatch(/\d{10}/);
    expect(code(SHELL)).not.toMatch(/\d{10}/);
    expect(code(HOME)).toContain("branding.contactPhone");
  });

  it("renders nothing at all when no number is set", () => {
    // A button that opens WhatsApp addressed to nobody is worse than no button.
    expect(code(HELP)).toContain("if (!link) return null");
  });

  it("warns that a person answers, and may take a while", () => {
    // The honest thing to put beside a neighbour's phone number. A chat window
    // sets an expectation of an instant reply and this is a volunteer.
    expect(flattened(HELP)).toMatch(/not a robot/i);
    expect(flattened(HELP)).toMatch(/give us a little time/i);
  });

  it("opens the chat with the message already written", () => {
    // A parent embarrassed to be stuck has nothing to compose.
    expect(code(HELP)).toContain("JOIN_HELP_MESSAGE");
    expect(code(HELP)).toContain("whatsAppLink");
  });

  it("opens in a new tab without handing the opener away", () => {
    expect(code(HELP)).toContain('rel="noopener noreferrer"');
    expect(code(SHELL)).toContain('rel="noopener noreferrer"');
  });
});

// ---------------------------------------------------------------------------

describe("the doors, top and bottom", () => {
  const SHELL = readFileSync(
    join(process.cwd(), "src", "components", "layout", "site-shell.tsx"),
    "utf8",
  );

  it("keeps one list, so the masthead and the footer cannot disagree", () => {
    /*
     * They were two hand-written lists, which is how the donors page came to be
     * reachable from the foot of the page and the home page but never from the
     * masthead.
     */
    const source = code(SHELL);

    expect(source).toContain("const DESTINATIONS");
    // Both navigations read the same filtered list.
    expect(source.match(/destinationsFor\(signedIn\)/g)?.length).toBe(2);
  });

  it("offers the joining guide and the donors page from both", () => {
    const source = code(SHELL);

    expect(source).toContain('href: "/how-to-join"');
    expect(source).toContain('href: "/donors"');
  });

  it("hides the catalogue doors from somebody who is not signed in", () => {
    // The catalogue defaults to members-only, and a door that answers "sign in
    // first" is worse than no door.
    const source = code(SHELL);

    expect(source).toMatch(/href: "\/books", label: "Books", readersOnly: true/);
    expect(source).toMatch(/href: "\/my-books", label: "My books", readersOnly: true/);
  });

  it("scrolls the band rather than wrapping it on a small screen", () => {
    // Wrapping pushes the page down by a whole row on exactly the phones with
    // the least room. This is what replaced the old four-door ceiling.
    expect(code(SHELL)).toContain("overflow-x-auto");
  });
});
