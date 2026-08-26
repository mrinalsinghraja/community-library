import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LEGAL_LINKS } from "@/components/layout/site-shell";
import {
  LEGAL_LAST_UPDATED,
  accessibilityDocument,
  privacyDocument,
  termsDocument,
  type LegalContext,
  type LegalDocument,
} from "@/lib/legal";

/**
 * The policy pages, held to the software they describe.
 *
 * A privacy notice is the one page on a site that is worse than useless when it
 * drifts: a family reads it, believes it, and acts on it. These tests do not
 * check that the prose is good — they check the two things that can silently
 * stop being true. That every link in the footer goes somewhere that exists,
 * and that the claims which are really claims about the code still match the
 * code.
 */

const CONTEXT: LegalContext = {
  libraryName: "A Test Library",
  communityName: "A Test Community",
  venueAddress: "The Test Room, Test Building",
  contactEmail: "hello@example.test",
};

const DOCUMENTS: [string, LegalDocument][] = [
  ["privacy", privacyDocument(CONTEXT)],
  ["terms", termsDocument(CONTEXT)],
  ["accessibility", accessibilityDocument(CONTEXT)],
];

function allText(document: LegalDocument): string {
  return [
    document.title,
    document.standfirst,
    ...document.sections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
    ]),
  ].join("\n");
}

describe("the footer's policy links", () => {
  it("all point at a route that exists", () => {
    for (const link of LEGAL_LINKS) {
      const page = join(process.cwd(), "src/app", link.href, "page.tsx");
      expect(existsSync(page), `${link.href} is in the footer but ${page} does not exist`).toBe(true);
    }
  });

  it("covers what a portal is expected to carry", () => {
    const hrefs = LEGAL_LINKS.map((link) => link.href);
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/contact");
  });
});

describe("every policy page", () => {
  it.each(DOCUMENTS)("%s has a title, a standfirst and real sections", (_name, document) => {
    expect(document.title.length).toBeGreaterThan(0);
    expect(document.standfirst.length).toBeGreaterThan(0);
    expect(document.sections.length).toBeGreaterThan(2);
    for (const section of document.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it.each(DOCUMENTS)("%s hardcodes no library's name", (_name, document) => {
    /*
     * The same rule the lint config enforces across src/, checked here on the
     * rendered strings rather than on the source: every name in these pages
     * arrives from library settings, so a second library running this software
     * does not publish somebody else's privacy notice.
     */
    const text = allText(document);
    expect(text).not.toMatch(/Mana\s*Jardin/i);
    expect(text).not.toMatch(/MJCL/);
  });

  it.each(DOCUMENTS)("%s is built from its context, not from literals", (_name, document) => {
    /*
     * At least one value from the caller has to reach the page. Not
     * specifically the library's name: the accessibility statement has no
     * natural place for it and says so through the contact address instead.
     * What this catches is a document that stopped taking its details from
     * settings at all.
     */
    const text = allText(document);
    const usesContext = [
      CONTEXT.libraryName,
      CONTEXT.communityName,
      CONTEXT.venueAddress,
      CONTEXT.contactEmail ?? "",
    ].some((value) => value.length > 0 && text.includes(value));
    expect(usesContext).toBe(true);
  });

  it("states a fixed last-updated date rather than today's", () => {
    // A "last updated" that follows the clock renews itself daily and is the
    // one fact on a policy page a reader is entitled to rely on.
    expect(LEGAL_LAST_UPDATED).toMatch(/^\d{1,2} \w+ \d{4}$/);
    const source = readFileSync(join(process.cwd(), "src/lib/legal.ts"), "utf8");
    const declaration = source.slice(
      source.indexOf("export const LEGAL_LAST_UPDATED"),
      source.indexOf("export interface LegalContext"),
    );
    expect(declaration).not.toContain("new Date");
  });
});

describe("the privacy notice matches what the code does", () => {
  const text = allText(privacyDocument(CONTEXT));

  it("says the year of birth is held and a full date is not", () => {
    // ADR-051. The schema holds `birthYear Int` and no date of birth.
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("birthYear");
    expect(schema).not.toMatch(/dateOfBirth|birthDate/);
    expect(text).toContain("year of birth");
  });

  it("names the AI service and says what is withheld from it", () => {
    expect(text).toContain("Groq");
    for (const withheld of ["name", "flat number", "photograph"]) {
      expect(text.toLowerCase()).toContain(withheld);
    }
  });

  it("does not promise the AI Librarian is told nothing at all", () => {
    /*
     * The dangerous overclaim. Reading history IS sent — titles and the child's
     * own ratings — and a notice that said "nothing about your child is sent"
     * would be false. It has to say what goes as well as what does not.
     */
    expect(text).toMatch(/titles of books the child has borrowed/i);
  });

  it("says closed accounts are kept rather than deleted", () => {
    // Matches `applyClosure` and CLOSED_STATUSES: no rows are removed.
    const lifecycle = readFileSync(join(process.cwd(), "src/lib/account-lifecycle.ts"), "utf8");
    expect(lifecycle).toContain("CLOSED_STATUSES");
    expect(text).toMatch(/closed rather than deleted/i);
  });

  it("says a correction needs approval, because it does", () => {
    expect(text).toMatch(/Nothing changes until the administrator approves it/i);
  });

  it("claims no analytics, and none are present", () => {
    expect(text).toMatch(/no analytics/i);
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    for (const tracker of ["@vercel/analytics", "posthog", "gtag", "google-analytics", "mixpanel"]) {
      expect(packageJson).not.toContain(tracker);
    }
  });
});

describe("the terms match the library's own rules", () => {
  const text = allText(termsDocument(CONTEXT));

  it("repeats that any reader may borrow any book", () => {
    expect(text).toMatch(/Any reader may borrow any book/i);
  });

  it("repeats that donating is never a condition of membership", () => {
    expect(text).toMatch(/never a condition/i);
  });

  it("promises no leaderboard of donors", () => {
    expect(text).toMatch(/no leaderboard/i);
  });

  it("does not threaten a consequence for a late book", () => {
    // The library's standing rule: no punitive copy, and no promise of immunity
    // either. See `consequences-policy.test.ts` for the same guard on the rest
    // of the site.
    for (const threat of ["fine", "penalty", "banned", "suspended from borrowing", "charge you"]) {
      expect(text.toLowerCase()).not.toContain(threat);
    }
  });
});
