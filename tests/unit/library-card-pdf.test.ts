import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { LibraryCardFacts } from "@/lib/library-card";
import { renderLibraryCardPdf } from "@/server/reports/library-card-pdf";

/**
 * The card renders to a real PDF, and does it for the awkward inputs too.
 *
 * `pdf-lib` throws rather than guessing when a string contains a character the
 * standard fonts cannot draw, so a reader whose name is written in Kannada or
 * Assamese would take the whole download down. That is the case this file
 * exists for.
 *
 * Set `WRITE_CARD_PREVIEW=1` to drop the output somewhere you can look at it.
 */

const FACTS: LibraryCardFacts = {
  readerName: "Demo Reader",
  memberCode: "MJCL-R0001",
  apartment: "A101",
  birthYear: 2016,
  joinedAt: new Date("2026-08-01T00:00:00Z"),
  avatarKey: "fox",
  photoMediaId: "should-be-ignored",
  libraryName: "Mana Jardin Children's Library",
  communityName: "Mana Jardin",
  logoUrl: null,
  rules: { ageMin: 5, ageMax: 14, borrowingPeriodDays: 14, maxActiveLoans: 2 },
};

const isPdf = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

describe("the card as a file", () => {
  it("writes a real PDF", async () => {
    const bytes = await renderLibraryCardPdf(FACTS, "Asia/Kolkata");

    expect(isPdf(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(1000);

    if (process.env.WRITE_CARD_PREVIEW) writeFileSync("/tmp/card-preview.pdf", bytes);
  });

  it("survives a name the standard fonts cannot draw", async () => {
    // Kannada and Devanagari are not in WinAnsi. Without the sanitiser this
    // throws and the family gets a broken download instead of a card.
    for (const readerName of ["ಅನನ್ಯಾ", "आरव शर्मा", "Zoë Ferreira"]) {
      const bytes = await renderLibraryCardPdf({ ...FACTS, readerName }, "Asia/Kolkata");
      expect(isPdf(bytes)).toBe(true);
    }
  });

  it("renders for a library with no settings at all", async () => {
    const bytes = await renderLibraryCardPdf(
      { ...FACTS, rules: null, apartment: null, joinedAt: null },
      "Asia/Kolkata",
    );
    expect(isPdf(bytes)).toBe(true);
  });

  it("names no author, because the author would be a child", async () => {
    const text = Buffer.from(await renderLibraryCardPdf(FACTS, "Asia/Kolkata")).toString("latin1");
    expect(text).not.toContain("/Author");
  });
});
