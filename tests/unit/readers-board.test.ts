import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CONSENT_LABELS,
  CONSENT_TEXTS,
  CURRENT_CONSENT_TYPES,
  REQUIRED_CONSENT_TYPES,
} from "@/lib/consent";
import {
  BOARD_SIZE,
  EMPTY_SOCKET_LABEL,
  currentMonthWindow,
  monogram,
  previousMonthWindow,
} from "@/lib/readers-board";

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
  it("always has six sockets", () => {
    expect(BOARD_SIZE).toBe(6);
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

describe("the months it is about", () => {
  /*
   * Two boards, two windows. The running one is what makes a small library's
   * card worth opening -- a child who borrows on the 2nd is on it that
   * afternoon -- and the finished one is what stops the reset on the 1st from
   * erasing the month they just had.
   */
  it("covers the whole month now running, from its first instant", () => {
    const { from, to, label } = currentMonthWindow(new Date("2026-09-14T09:30:00.000Z"));

    expect(from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(label).toBe("September 2026");
  });

  it("starts the running month over on the first, not partway through", () => {
    // The reset the owner asked for: at the first instant of a new month the
    // window has already moved, so nothing from the old month is still counted.
    const { from, label } = currentMonthWindow(new Date("2026-10-01T00:00:00.000Z"));

    expect(from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(label).toBe("October 2026");
  });

  it("has the two windows meet exactly, with no gap and no overlap", () => {
    const now = new Date("2026-09-14T09:30:00.000Z");
    const current = currentMonthWindow(now);
    const previous = previousMonthWindow(now);

    expect(previous.to.getTime() + 1).toBe(current.from.getTime());
  });

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

describe("appearing is disclosed, and a family may opt out", () => {
  /*
   * These assert the PROMISES, not the prose. Matching exact sentences makes
   * every wording improvement look like a regression, and the thing worth
   * protecting is that a guardian is told what is shown and to whom, that it
   * never leaves the library or earns anybody money, and that saying no costs
   * their child nothing.
   */
  const promises = (text: string) => ({
    saysWhoSeesIt: /signed in|library staff|other members|librarian/i.test(text),
    noCommercialUse: /commercial purpose/i.test(text) && /advertis/i.test(text),
    staysInsideTheLibrary:
      /never (sold|shared|given)|outside (this |the )?library|never goes outside/i.test(text),
    canOptOut: /left out|leave my child off|withdraw|removed at any time/i.test(text),
  });

  it("is no longer a separate question on the form", () => {
    // Folded into the consent a guardian already gives. The ConsentType stays
    // in the database, repurposed as the record of a family opting out.
    expect(CURRENT_CONSENT_TYPES).not.toContain("READERS_BOARD");
    expect(Object.keys(CONSENT_TEXTS)).not.toContain("READERS_BOARD");
    expect(Object.keys(CONSENT_LABELS)).not.toContain("READERS_BOARD");
  });

  it("tells a guardian, in the account consent, what other members will see", () => {
    const account = CONSENT_TEXTS.CHILD_ACCOUNT_CREATION;

    expect(account).toMatch(/first name/i);
    expect(account).toMatch(/picture or avatar/i);
    expect(promises(account).saysWhoSeesIt).toBe(true);
    expect(promises(account).staysInsideTheLibrary).toBe(true);
    expect(promises(account).noCommercialUse).toBe(true);
  });

  it("says a family can ask for their child to be left off, at no cost", () => {
    const account = CONSENT_TEXTS.CHILD_ACCOUNT_CREATION;

    expect(promises(account).canOptOut).toBe(true);
    expect(account).toMatch(/without it affecting their membership/i);
  });

  it("says why the card exists, rather than leaving a parent to guess", () => {
    expect(CONSENT_TEXTS.CHILD_ACCOUNT_CREATION).toMatch(/encourage reading/i);
  });

  it("keeps the photograph itself optional, with an avatar as a full substitute", () => {
    /*
     * This is what makes a disclosure bundled into a required consent fair: a
     * parent uncomfortable with a picture of their child on a shared card is
     * never forced to provide one, and the membership is identical either way.
     */
    const photo = CONSENT_TEXTS.CHILD_PHOTO_STORAGE;

    expect(photo).toMatch(/optional/i);
    expect(photo).toMatch(/avatar gives my child exactly the same membership/i);
    expect(REQUIRED_CONSENT_TYPES).not.toContain("CHILD_PHOTO_STORAGE");
  });

  it("makes the same promises about a stored photograph", () => {
    const photo = promises(CONSENT_TEXTS.CHILD_PHOTO_STORAGE);

    expect(photo.noCommercialUse).toBe(true);
    expect(photo.staysInsideTheLibrary).toBe(true);
    expect(photo.canOptOut).toBe(true);
  });

  it("never promises a stored photo is private full stop", () => {
    // The original wording said the photograph "is never published", which a
    // card other members see would have contradicted.
    expect(CONSENT_TEXTS.CHILD_PHOTO_STORAGE).not.toMatch(/never published/);
  });

  it("makes no promise anywhere in the interface that the card contradicts", () => {
    /*
     * The consent wording was corrected and the photo picker was not, so for one
     * deploy the joining form told a parent their child's picture was "never
     * published" and seen only by the child and the librarian — on the very
     * control where they choose whether to upload one.
     *
     * A promise made in UI copy binds the library exactly as much as one made in
     * a consent record, and this file is the only place that checks either.
     * Swept across every child-facing surface rather than the one that broke.
     */
    const surfaces = [
      "src/components/library/photo-picker.tsx",
      "src/app/join/join-form.tsx",
      "src/app/how-to-join/page.tsx",
      "src/components/library/readers-board.tsx",
    ];

    for (const path of surfaces) {
      const source = read(path);

      expect(source).not.toMatch(/never published/i);
      expect(source).not.toMatch(/only your child and the librarian/i);
      expect(source).not.toMatch(/no one else (can|will) (ever )?see/i);
    }
  });

  it("tells a parent about the card where they choose whether to upload a photo", () => {
    // JSX wraps prose across lines, so the copy is flattened before matching.
    const picker = read("src/components/library/photo-picker.tsx").replace(/\s+/g, " ");

    expect(picker).toMatch(/readers&rsquo; card|readers' card/);
    expect(picker).toMatch(/other members/i);
    expect(picker).toMatch(/never leaves the library/i);
    expect(picker).toMatch(/leave your child off that card/i);
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

  it("invites into the month still running, and not into the one that ended", () => {
    /*
     * "It could be you" over a finished month is an invitation to a door that
     * has closed. The running card keeps its empty sockets; the finished one
     * shows the children who were on it and stops.
     */
    expect(component).toContain("running");
    expect(component).toMatch(/running[\s\S]{0,200}Array\.from\(\{ length: BOARD_SIZE \}/);
  });

  it("draws every socket at the same size, filled or not", () => {
    // A smaller empty socket would read as a lesser thing; identical geometry
    // is what makes a gap read as an invitation.
    expect(component).toContain("size-14");
    expect(component).toContain("size={56}");
  });

  it("excludes on an opt-out record, never includes on an opt-in one", () => {
    /*
     * The polarity is the whole safety property. Reading it backwards would
     * show every child whose family had asked to be left off, which is the
     * exact opposite of what they asked for.
     */
    expect(service).toContain("'READERS_BOARD'");
    expect(service).toContain("NOT EXISTS");
    expect(service).toContain("status = 'WITHDRAWN'");
    expect(service).not.toContain("status = 'GRANTED'");
  });

  it("names no month as better than another", () => {
    // Two cards, and neither may be introduced as the good one. "Readers of
    // the month" and "Readers of last month" are both statements of fact.
    const page = read("src/app/my-books/page.tsx");

    expect(page).toContain('title="Readers of the month"');
    expect(page).toContain('title="Readers of last month"');
    expect(page).not.toMatch(/\b(winner|champion|best reader|top reader)\b/i);
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

  it("requires both consent and current membership of a board", () => {
    /*
     * The membership test runs the board query itself rather than a copy of it,
     * so consent, the six places and the month window cannot drift apart
     * between what is drawn and what may be read.
     */
    const service = read("src/server/services/readers-board-service.ts");
    const query = service.slice(
      service.indexOf("async function boardFor"),
      service.indexOf("function toReaders"),
    );

    expect(query).toContain("READERS_BOARD");
    expect(query).toContain(`LIMIT ${"${BOARD_SIZE}"}`);

    const fn = service.slice(service.indexOf("export async function memberIsOnReadersBoard"));
    expect(fn).toContain("boardFor");
  });

  it("covers both boards, because both are on the page", () => {
    /*
     * A photograph authorised for only one window would draw the other card
     * with a broken picture in it -- which a child reads as being singled out.
     * Checking both is not a widening: the same six places, the same opt-out,
     * the same signed-in-only route.
     */
    const service = read("src/server/services/readers-board-service.ts");
    const fn = service.slice(service.indexOf("export async function memberIsOnReadersBoard"));

    expect(fn).toContain("currentMonthWindow(now)");
    expect(fn).toContain("previousMonthWindow(now)");
  });

  it("leaves the private-media caching rule untouched", () => {
    // A child's photograph still never earns an ETag and still carries
    // no-store, board or no board.
    expect(uploads).toContain("A child's photograph is not on this list");
    expect(uploads).not.toContain("CHILD_PHOTO,");
  });
});
