import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AGE_GROUPS } from "@/lib/catalogue";
import { READER_DESTINATIONS } from "@/lib/desk-nav";
import { SETTING_BOUNDS } from "@/lib/settings-schema";

/**
 * The questions page.
 *
 * It is the page a parent reads before deciding whether to sign their child up,
 * which makes every claim on it a promise. These tests hold the claims that
 * would be embarrassing — or worse — to get wrong, and the rule that keeps the
 * page from drifting: no number is typed into it.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");
const FAQ = read("app", "faq", "page.tsx");
const flat = FAQ.replace(/\s+/g, " ");

/** The prose a reader sees, with the comments that explain it stripped out. */
function prose(source: string): string[] {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("/*") || trimmed.startsWith("{/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
    kept.push(line);
  }
  return kept;
}

describe("the questions page keeps its numbers where the software keeps them", () => {
  it("types no age, loan period or limit of its own", () => {
    /*
     * The failure this prevents: an administrator widens the age range at
     * /admin/settings, every other page follows, and this one keeps telling
     * families the old range because somebody typed it into a sentence.
     */
    /*
     * Every string the page renders, with `${...}` expressions taken out —
     * those are the settings being read, which is exactly what should be there.
     * What is left is prose a family sees, and it must contain no digit.
     */
    const source = prose(FAQ)
      .join("\n")
      .replace(/className=(?:"[^"]*"|\{[^}]*\})/g, "");

    /** Removes `${...}` from the inside out, so a nested one goes too. */
    const withoutExpressions = (text: string) => {
      let out = text;
      for (;;) {
        const next = out.replace(/\$\{[^{}]*\}/g, "");
        if (next === out) return next;
        out = next;
      }
    };

    const strings = [
      ...(source.match(/"(?:[^"\\]|\\.)*"/g) ?? []),
      ...(source.match(/`[\s\S]*?`/g) ?? []),
    ].map(withoutExpressions);

    expect(strings.length).toBeGreaterThan(30);
    expect(strings.filter((text) => /\d/.test(text))).toEqual([]);
  });

  it("reads the ages a family may join at from settings", () => {
    expect(FAQ).toContain("settings.ageMin");
    expect(FAQ).toContain("settings.ageMax");
  });

  it("lists the shelf bands from the catalogue's own list", () => {
    // Not a typed sentence: when a band moves, this moves with it.
    expect(FAQ).toContain("AGE_GROUPS");
    expect(flat).toContain("${bandList}");
  });

  it("is rendered per request, so a settings change shows at once", () => {
    expect(FAQ).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("what it promises about a child", () => {
  it("says recovery reaches the guardian and never the child", () => {
    expect(flat).toMatch(/reset link is emailed to the guardian/i);
    expect(flat).toMatch(/never to the child/i);
  });

  it("says nobody at the library can see a password", () => {
    expect(flat).toMatch(/nobody at the library can see or choose a child's password/i);
  });

  it("says the age band is a suggestion, using the catalogue's own words", () => {
    // AGE_BAND_NOTE, not a second copy of it written in prose here.
    expect(FAQ).toContain("AGE_BAND_NOTE");
  });

  it("names the helper as an AI rather than dressing it up", () => {
    expect(flat).toMatch(/it is an AI/i);
    expect(flat).toMatch(/nothing about the reader/i);
  });

  it("does not claim the photograph is public, or that reviews are anonymous", () => {
    expect(flat).toMatch(/not on the public catalogue/i);
    expect(flat).toMatch(/first name and nothing else/i);
  });

  it("says donating is never a condition of joining", () => {
    expect(flat).toMatch(/never a condition of membership/i);
  });
});

describe("finding the page at all", () => {
  it("is in the shared list, so both shells carry it for every role", () => {
    const faq = READER_DESTINATIONS.find((item) => item.href === "/faq");
    expect(faq).toBeDefined();
    // No `membersOnly` and no `cataloguePublicOnly`: a family deciding whether
    // to join has neither a card nor a session.
    expect(faq?.membersOnly).toBeUndefined();
    expect(faq?.cataloguePublicOnly).toBeUndefined();
  });

  it("is linked from the home page, where a parent lands first", () => {
    expect(read("app", "page.tsx")).toContain('href="/faq"');
  });
});

describe("the membership range the library ships with", () => {
  /*
   * The standard is what a new library gets and what the settings screen
   * suggests. The bands are the catalogue's, and between them they must cover
   * that range — a member with no band to belong to is how a librarian ends up
   * picking the nearest lie when cataloguing.
   */
  it("is covered by the shelf bands, with no gap at either end", () => {
    const banded = AGE_GROUPS.filter((group) => group.minYears !== null);
    const youngest = Math.min(...banded.map((group) => group.minYears!));
    const oldest = Math.max(...banded.map((group) => group.maxYears!));

    expect(youngest).toBe(SETTING_BOUNDS.ageMin.standard);
    expect(oldest).toBe(SETTING_BOUNDS.ageMax.standard);

    // And no hole between one band and the next.
    const inOrder = [...banded].sort((a, b) => a.minYears! - b.minYears!);
    inOrder.forEach((group, index) => {
      if (index === 0) return;
      expect(group.minYears).toBe(inOrder[index - 1].maxYears! + 1);
    });
  });
});
