import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CONSENT_LABELS,
  CONSENT_TEXTS,
  CURRENT_CONSENT_TYPES,
  REQUIRED_CONSENT_TYPES,
} from "@/lib/consent";
import { BOARD_SIZE, EMPTY_SOCKET_LABEL, monogram, previousMonthWindow } from "@/lib/readers-board";

/**
 * The readers' board.
 *
 * Two properties carry this feature and both are asserted at the source,
 * because both fail silently:
 *
 *   1. **Nothing ranks a child.** The five are chosen by reading and then
 *      ordered by name, and the count never leaves the query that used it.
 *   2. **Appearance is consented, separately from storage.** Agreeing that the
 *      library may hold a photograph is a different question from agreeing that
 *      other families may see it, and one must never be read as the other.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the shape of the board", () => {
  it("always has five sockets", () => {
    expect(BOARD_SIZE).toBe(5);
  });

  it("says what an empty socket is for", () => {
    expect(EMPTY_SOCKET_LABEL).toBe("It could be you");
  });

  it("reduces a name to one letter for a child with no photograph", () => {
    expect(monogram("Aarav")).toBe("A");
    expect(monogram("  meera ")).toBe("M");
  });

  it("does not fall over on an empty name", () => {
    expect(monogram("")).toBe("?");
    expect(monogram("   ")).toBe("?");
  });
});

describe("the month it is about", () => {
  it("is the month that has finished, never the running one", () => {
    const { from, to, label } = previousMonthWindow(new Date("2026-08-23T12:00:00.000Z"));

    expect(from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-31T23:59:59.999Z");
    expect(label).toBe("July 2026");
  });

  it("steps back across a year boundary", () => {
    const { from, label } = previousMonthWindow(new Date("2026-01-04T12:00:00.000Z"));

    expect(from.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(label).toBe("December 2025");
  });

  it("covers a whole short month", () => {
    const { from, to } = previousMonthWindow(new Date("2028-03-10T12:00:00.000Z"));

    expect(from.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    // 2028 is a leap year; the window must not stop on the 28th.
    expect(to.toISOString()).toBe("2028-02-29T23:59:59.999Z");
  });
});

describe("appearing is consented, and separately from storage", () => {
  it("offers the board as its own consent", () => {
    expect(CURRENT_CONSENT_TYPES).toContain("READERS_BOARD");
    expect(CONSENT_TEXTS.READERS_BOARD).toBeTruthy();
    expect(CONSENT_LABELS.READERS_BOARD).toContain("optional");
  });

  it("never makes it a condition of joining", () => {
    expect(REQUIRED_CONSENT_TYPES).not.toContain("READERS_BOARD");
  });

  /*
   * These assert the PROMISES, not the prose.
   *
   * Matching exact sentences makes every wording improvement look like a
   * regression, and the thing worth protecting is not the phrasing — it is that
   * a guardian is told who sees the picture, that it is never sold or used to
   * advertise anything, that it never leaves the library, and that saying no
   * costs their child nothing.
   */
  const promises = (text: string) => ({
    isOptional: /optional|free to (say no|decline)/i.test(text),
    saysWhoSeesIt: /signed in|library staff|other members|librarian/i.test(text),
    noCommercialUse: /commercial purpose/i.test(text) && /advertis/i.test(text),
    staysInsideTheLibrary:
      /never (sold|shared|given)|outside (this |the )?library/i.test(text),
    canBeWithdrawn: /withdraw|removed at any time|stop these at any time/i.test(text),
  });

  it("tells a guardian who sees the board and that it stays inside the library", () => {
    const board = promises(CONSENT_TEXTS.READERS_BOARD);

    expect(board.isOptional).toBe(true);
    expect(board.saysWhoSeesIt).toBe(true);
    expect(board.noCommercialUse).toBe(true);
    expect(board.staysInsideTheLibrary).toBe(true);
    expect(board.canBeWithdrawn).toBe(true);
  });

  it("says a child loses nothing by not being on it", () => {
    expect(CONSENT_TEXTS.READERS_BOARD).toMatch(/membership.*exactly the same|exactly the same.*either way/i);
  });

  it("promises no surname, flat or card number", () => {
    const text = CONSENT_TEXTS.READERS_BOARD;

    expect(text).toMatch(/never our surname/i);
    expect(text).toMatch(/flat number/i);
    expect(text).toMatch(/card number/i);
  });

  it("makes the same promises about a stored photograph", () => {
    const photo = promises(CONSENT_TEXTS.CHILD_PHOTO_STORAGE);

    expect(photo.isOptional).toBe(true);
    expect(photo.noCommercialUse).toBe(true);
    expect(photo.staysInsideTheLibrary).toBe(true);
    expect(photo.canBeWithdrawn).toBe(true);
  });

  it("never promises a stored photo is private full stop", () => {
    /*
     * The original wording said the photograph "is never published", which a
     * board of faces would have contradicted for every family that had agreed
     * to it. The storage consent must now point at the board question instead
     * of making a promise the board breaks.
     */
    const text = CONSENT_TEXTS.CHILD_PHOTO_STORAGE;

    expect(text).toMatch(/unless I separately agree to the readers' board/);
    expect(text).not.toMatch(/never published/);
  });

  it("does not promise to hold a date of birth the library no longer asks for", () => {
    // ADR-051 replaced the date with a year. A consent naming the wrong field
    // is a consent to something that is not happening.
    expect(CONSENT_TEXTS.CHILD_ACCOUNT_CREATION).toContain("year of birth");
    expect(CONSENT_TEXTS.CHILD_ACCOUNT_CREATION).not.toMatch(/date of birth/i);
  });
});

describe("nothing ranks a child", () => {
  const service = read("src/server/services/readers-board-service.ts");
  const component = read("src/components/library/readers-board.tsx");
  const board = read("src/lib/readers-board.ts");

  it("chooses by reading but returns in alphabetical order", () => {
    expect(service).toContain("ORDER BY lower(chosen.first_name) ASC");
  });

  it("never lets the count leave the query", () => {
    /*
     * The tally decides who is on the board and is then discarded. Asserted
     * against code rather than prose: these files talk about ranking precisely
     * because they refuse to do it, so matching the bare word would fail on the
     * comment that documents the rule.
     */
    const code = (source: string) =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    // No field, no property, no variable carrying a position or a total.
    for (const source of [board, component]) {
      expect(code(source)).not.toMatch(/\b(rank|position|place|score|count|total)\b\s*[:=?]/);
    }
    // The service may count in SQL, but nothing counted is returned.
    expect(code(service)).not.toMatch(/borrowed\s*[:,]/);
    expect(code(service)).not.toMatch(/borrowed:\s*row\./);
  });

  it("puts no numeral on the card", () => {
    expect(component).not.toMatch(/\{index \+ 1\}/);
    expect(component).not.toContain("#{");
    expect(component).not.toMatch(/1st|2nd|3rd/);
  });

  it("draws every socket at the same size, filled or not", () => {
    // A smaller empty socket would read as a lesser thing; identical geometry
    // is what makes a gap read as an invitation.
    expect(component).toContain("size-14");
    expect(component).toContain("size={56}");
  });

  it("gates appearance on consent inside the query itself", () => {
    expect(service).toContain("'READERS_BOARD'");
    expect(service).toContain("status = 'GRANTED'");
  });

  it("shows a first name only, never the whole one", () => {
    expect(service).toContain("split_part");
    expect(service).not.toContain("u.display_name AS");
  });
});

/**
 * The photograph route.
 *
 * This is the only path by which one child's face reaches another child, and it
 * must stay a query rather than becoming a flag somebody can leave switched on.
 */
describe("how a board photograph is authorised", () => {
  const media = read("src/server/services/media-service.ts");
  const uploads = read("src/server/lib/uploads.ts");

  it("asks the board itself, on the request", () => {
    expect(media).toContain("memberIsOnReadersBoard");
  });

  it("requires both consent and current membership of the board", () => {
    const service = read("src/server/services/readers-board-service.ts");
    const fn = service.slice(service.indexOf("export async function memberIsOnReadersBoard"));

    expect(fn).toContain("READERS_BOARD");
    expect(fn).toContain(`LIMIT ${"${BOARD_SIZE}"}`);
  });

  it("leaves the private-media caching rule untouched", () => {
    // A child's photograph still never earns an ETag and still carries
    // no-store, board or no board.
    expect(uploads).toContain("A child's photograph is not on this list");
    expect(uploads).not.toContain("CHILD_PHOTO,");
  });
});
