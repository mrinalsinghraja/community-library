import { describe, expect, it } from "vitest";

import { formatCode } from "@/lib/codes";

import { MANA_JARDIN } from "../../prisma/seed/library-config";

/**
 * The seed's configured prefixes, run through the one formatter.
 *
 * This exists because the seed used to re-implement the format rule inline and
 * produced `MJCL-R-0001` for a prefix the allocator writes as `MJCL-R0001` —
 * two different labels for the same book, and nothing failed. The assertion is
 * therefore not "the codes look nice" but "whatever the owner configures, the
 * seed and the allocator agree about it".
 */

describe("seeded code prefixes", () => {
  const { copyCodePrefix, copyCodePadding, memberCodePrefix, memberCodePadding } =
    MANA_JARDIN.settings;

  it("puts the number straight after the prefix, with no second separator", () => {
    for (const [prefix, padding] of [
      [copyCodePrefix, copyCodePadding],
      [memberCodePrefix, memberCodePadding],
    ] as const) {
      const code = formatCode(prefix, 1, padding);
      expect(code.startsWith(prefix)).toBe(true);
      // The bug this catches: "MJCL-R-0001", where the tail is not just digits.
      expect(code.slice(prefix.length)).toMatch(/^\d+$/);
    }
  });

  it("formats a book label and a card as prefix followed by a padded number", () => {
    expect(formatCode(copyCodePrefix, 1, copyCodePadding)).toBe(
      `${copyCodePrefix}${"1".padStart(copyCodePadding, "0")}`,
    );
    expect(formatCode(memberCodePrefix, 42, memberCodePadding)).toBe(
      `${memberCodePrefix}${"42".padStart(memberCodePadding, "0")}`,
    );
  });

  /*
   * The owner's decision, recorded as a test so that it is a decision and not a
   * drift: books and cards share one house style. The sequences are independent,
   * so the same string names both a book and a reader. See docs/IDENTITY.md §3
   * for why that is safe at sign-in and what it does cost.
   */
  it("gives book labels and library cards the same house style", () => {
    expect(copyCodePrefix).toBe(memberCodePrefix);
    expect(copyCodePadding).toBe(memberCodePadding);
  });
});
