import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CARD_MESSAGES,
  cardAllowances,
  cardFileName,
  shortRules,
  type CardRules,
} from "@/lib/library-card";

/**
 * The reader's card.
 *
 * A card is the one object in this library that is designed to leave it: it
 * goes in a pocket, gets photographed, gets forwarded. So most of what is
 * tested here is what the card does **not** carry.
 */

const RULES: CardRules = { ageMin: 5, ageMax: 14, borrowingPeriodDays: 14, maxActiveLoans: 2 };

const SERVICE = readFileSync(
  join(process.cwd(), "src", "server", "services", "card-service.ts"),
  "utf8",
);
const PDF = readFileSync(
  join(process.cwd(), "src", "server", "reports", "library-card-pdf.ts"),
  "utf8",
);
const CANVAS = readFileSync(
  join(process.cwd(), "src", "app", "my-card", "card-downloads.tsx"),
  "utf8",
);

describe("what the card never carries", () => {
  it("selects no guardian contact from the database", () => {
    /*
     * The schema says a guardian's details "never render on a child screen".
     * A card is a child screen that can also be printed and handed over, so the
     * service must not even fetch them.
     */
    for (const field of ["guardian", "email", "phone:", "staffNotes"]) {
      expect(SERVICE.toLowerCase()).not.toContain(`${field.toLowerCase()}: true`);
    }
  });

  it("reads only the member columns a card needs", () => {
    for (const field of ["memberCode", "apartment", "birthYear", "joinedAt", "avatarKey"]) {
      expect(SERVICE).toContain(`${field}: true`);
    }
    expect(SERVICE).not.toContain("staffNotes: true");
  });

  it("takes no member id, so it cannot be pointed at another child", () => {
    expect(SERVICE).toContain("export async function getOwnLibraryCard(): Promise<");
    // No parameter at all is the strongest form of this guarantee.
    expect(SERVICE).toMatch(/getOwnLibraryCard\(\)/);
  });

  it("puts no photograph in either download", () => {
    // A file gets forwarded. The disc and monogram carry the recognition; a
    // child's face plus their name plus their flat is a different object.
    expect(PDF).not.toMatch(/photoMediaId|embedPng|embedJpg/);
    expect(CANVAS).not.toMatch(/photoMediaId|drawImage/);
  });

  it("names the file after the code, never after the child", () => {
    expect(cardFileName("MJCL-R0001", "pdf")).toBe("library-card-MJCL-R0001.pdf");
    expect(cardFileName(null, "png")).toBe("library-card.png");
  });
});

describe("what the card does carry", () => {
  it("shows the three allowances a reader needs to know", () => {
    const values = cardAllowances(RULES).map((item) => item.value);
    expect(values).toEqual(["5–14", "2 books", "14 days"]);
  });

  it("says 'book' when only one may be borrowed", () => {
    expect(cardAllowances({ ...RULES, maxActiveLoans: 1 })[1].value).toBe("1 book");
  });

  it("fits four house rules along the bottom, and no more", () => {
    // Five stops being read.
    expect(shortRules(RULES)).toHaveLength(4);
    expect(shortRules(null)).toHaveLength(4);
  });

  it("takes the loan length from settings rather than hardcoding it", () => {
    expect(shortRules(RULES)[0]).toContain("14 days");
    expect(shortRules({ ...RULES, borrowingPeriodDays: 21 })[0]).toContain("21 days");
    // With no settings it still says something true.
    expect(shortRules(null)[0]).not.toMatch(/\d/);
  });

  it("ends by sending a child to a person", () => {
    // The rule that stops a late or damaged book being hidden. It asks them to
    // speak to somebody; it does not say what will happen when they do.
    const last = shortRules(RULES).at(-1) ?? "";
    expect(last).toMatch(/tell the librarian/i);
  });

  it("says nothing at all about what happens if a rule is broken", () => {
    /*
     * Neutral in **both** directions, which is the part that is easy to get
     * wrong. An earlier version ended "there is never a fine" — kindly meant,
     * and still a policy printed on an object families keep, covering a wrecked
     * or lost book as much as a late one. The card asks for the book back and
     * asks to be told early; the rest is a conversation with a librarian.
     */
    for (const rule of [...shortRules(RULES), ...shortRules(null)]) {
      expect(rule).not.toMatch(/fine|penalty|charge|fee|owe|punish|forbidden|banned|must not/i);
    }
  });
});

describe("what a reader is told about the downloads", () => {
  it("offers both formats by what they are for, not by file type", () => {
    expect(CARD_MESSAGES.downloadPng).toMatch(/picture/i);
    expect(CARD_MESSAGES.downloadPdf).toMatch(/PDF/);
  });

  it("treats a failed picture as a detour rather than a dead end", () => {
    expect(CARD_MESSAGES.pngFailed).toMatch(/PDF/);
  });

  it("tells staff plainly that they have no card", () => {
    expect(CARD_MESSAGES.notAMember).not.toMatch(/error|denied|forbidden|not allowed/i);
  });
});
