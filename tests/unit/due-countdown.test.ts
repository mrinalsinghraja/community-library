import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SOON_FROM_DAYS, dueCountdown, loanCountdown } from "@/lib/due-countdown";

/**
 * The countdown, and the promise it makes about colour.
 *
 * Two properties are under test throughout:
 *
 *   1. The bands are the library's own — a fortnight down to four days is
 *      green, three to one is amber, the due day and everything past it is red.
 *   2. **Every state carries a word.** Green and red are exactly the pair a
 *      red-green colour-blind reader cannot separate, so a countdown that said
 *      only "3" would have told roughly one boy in twelve nothing at all. The
 *      word is the part that survives, and the last block asserts the
 *      components actually render it.
 */

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-08-23T06:00:00.000Z"); // midday in Asia/Kolkata

/** A due date `days` whole days from NOW, in the library's timezone. */
function due(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("the bands", () => {
  it("is green from a fortnight down to four days", () => {
    for (const days of [14, 13, 10, 7, 5, 4]) {
      expect(dueCountdown(due(days), TZ, NOW).tone).toBe("ok");
    }
  });

  it("turns amber at three days and stays there to one", () => {
    for (const days of [3, 2, 1]) {
      expect(dueCountdown(due(days), TZ, NOW).tone).toBe("soon");
    }
  });

  it("turns red on the day itself", () => {
    expect(dueCountdown(due(0), TZ, NOW).tone).toBe("due");
  });

  it("stays red for every day past it", () => {
    for (const days of [-1, -2, -9, -40]) {
      expect(dueCountdown(due(days), TZ, NOW).tone).toBe("late");
    }
  });

  it("changes band exactly where it says it does", () => {
    expect(dueCountdown(due(SOON_FROM_DAYS), TZ, NOW).tone).toBe("soon");
    expect(dueCountdown(due(SOON_FROM_DAYS + 1), TZ, NOW).tone).toBe("ok");
  });
});

describe("the numbers", () => {
  it("counts days remaining", () => {
    const countdown = dueCountdown(due(9), TZ, NOW);
    expect(countdown.days).toBe(9);
    expect(countdown.value).toBe("9");
    expect(countdown.unit).toBe("days left");
  });

  it("counts overdue days as a positive figure, with the direction in the word", () => {
    // The numeral is what a person reads across a room; "-3 days left" is a
    // riddle where "3 days over" is a fact.
    const countdown = dueCountdown(due(-3), TZ, NOW);
    expect(countdown.days).toBe(-3);
    expect(countdown.value).toBe("3");
    expect(countdown.unit).toBe("days over");
  });

  it("says today rather than zero days left", () => {
    const countdown = dueCountdown(due(0), TZ, NOW);
    expect(countdown.value).toBe("0");
    expect(countdown.unit).toBe("back today");
    expect(countdown.headline).toBe("Back today");
  });

  it("puts a single day in the singular", () => {
    expect(dueCountdown(due(1), TZ, NOW).unit).toBe("day left");
    expect(dueCountdown(due(-1), TZ, NOW).unit).toBe("day over");
  });

  it("carries the date, so a countdown can be checked against a calendar", () => {
    expect(dueCountdown(due(2), TZ, NOW).on).toBe("25 Aug 2026");
  });
});

describe("a loan that is over", () => {
  it("has no countdown once the book is back", () => {
    expect(
      loanCountdown({ status: "RETURNED", dueAt: due(-5), returnedAt: due(-6) }, TZ, NOW),
    ).toBeNull();
  });

  it("has no countdown once it is cancelled", () => {
    expect(loanCountdown({ status: "CANCELLED", dueAt: due(3) }, TZ, NOW)).toBeNull();
  });

  it("counts while the book is still out", () => {
    expect(loanCountdown({ status: "ACTIVE", dueAt: due(6) }, TZ, NOW)?.days).toBe(6);
  });
});

describe("the day boundary is the library's, not UTC's", () => {
  it("counts a date late at night in Asia/Kolkata as the same day", () => {
    // 20:30 IST on the 25th is still the 25th to a child in Bengaluru, and
    // 15:00 UTC — a naive UTC comparison would agree here, but the timezone is
    // what makes it true rather than a coincidence.
    const dueLate = new Date("2026-08-25T15:00:00.000Z");
    expect(dueCountdown(dueLate, TZ, NOW).days).toBe(2);
  });

  it("counts a date just after IST midnight as the next day, not the previous one", () => {
    // 00:30 IST on the 24th is 19:00 UTC on the 23rd. Read in UTC this is
    // "today"; read in the library's own timezone it is tomorrow, which is the
    // answer the child in the building needs.
    const justAfterMidnight = new Date("2026-08-23T19:00:00.000Z");
    expect(dueCountdown(justAfterMidnight, TZ, NOW).days).toBe(1);
  });
});

/**
 * The accessibility promise, asserted at the source.
 *
 * A rendering test would prove a component renders. It would not notice
 * somebody later deleting the unit from the markup and leaving a bare coloured
 * numeral, which is the exact regression this feature must never have.
 */
describe("colour never carries the meaning alone", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const component = read("src/components/library/due-countdown.tsx");

  it("renders the word beside the number in both sizes", () => {
    // Once in the panel, once inline.
    expect(component.match(/countdown\.unit/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("gives a screen reader the whole fact rather than three fragments", () => {
    expect(component.match(/countdown\.headline/g)?.length).toBeGreaterThanOrEqual(2);
    expect(component).toContain("sr-only");
    expect(component).toContain('aria-hidden="true"');
  });

  it("takes its colours from the library's tokens rather than raw hex", () => {
    expect(component).not.toMatch(/#[0-9a-fA-F]{6}/);
    for (const token of ["text-success", "text-warn", "text-danger"]) {
      expect(component).toContain(token);
    }
  });

  it("is used by the child's shelf and by the desk alike", () => {
    expect(read("src/app/my-books/page.tsx")).toContain("DueCountdownPanel");
    expect(read("src/app/desk/loans/page.tsx")).toContain("DueCountdownInline");
    expect(read("src/app/desk/renewals/page.tsx")).toContain("DueCountdownInline");
  });

  it("reaches the exports as words, because a spreadsheet has no colour", () => {
    const registry = read("src/server/reports/registry.ts");
    expect(registry).toContain("dueCountdown");
    expect(registry).toContain('header: "Time left"');
    expect(registry).toContain(".headline");
  });
});
