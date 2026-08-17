import { describe, expect, it } from "vitest";

import { formatCode } from "@/lib/codes";

import { MANA_JARDIN } from "../../prisma/seed/library-config";

/**
 * The seed's configured prefixes, run through the one formatter.
 *
 * Two things are being held still here. The first is agreement: the seed used
 * to re-implement the format rule inline and produced `MJCL-R-0001` for a
 * prefix the allocator writes as `MJCL-R0001` — two different labels for the
 * same book, and nothing failed. The second is separation: a book's label and a
 * child's library card are different kinds of thing and must not be able to
 * spell each other.
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
      // The bug this catches: "MJCL-B-0001", where the tail is not just digits.
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
   * The decision this file exists to defend: a book and a reader can share a
   * number but never a string. The sequences are independent, so the seventh of
   * each is inevitable; the prefixes are what keep the two namespaces apart.
   */
  it("gives books and readers different prefixes", () => {
    expect(copyCodePrefix).not.toBe(memberCodePrefix);
  });

  it("never lets a book label and a card code spell the same string", () => {
    // Same number, deliberately — this is the case that used to collide.
    const book = formatCode(copyCodePrefix, 7, copyCodePadding);
    const card = formatCode(memberCodePrefix, 7, memberCodePadding);

    expect(book).not.toBe(card);
    expect(book.endsWith("0007")).toBe(true);
    expect(card.endsWith("0007")).toBe(true);
  });

  it("keeps the reader card format the children were already issued", () => {
    // Cards are printed and in pockets. Changing this reissues the library.
    expect(formatCode(memberCodePrefix, 1, memberCodePadding)).toMatch(/^\w+-R0001$/);
  });

  it("marks a book label with its own kind letter", () => {
    expect(formatCode(copyCodePrefix, 1, copyCodePadding)).toMatch(/^\w+-B0001$/);
  });
});
