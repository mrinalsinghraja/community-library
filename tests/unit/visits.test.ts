import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ROLE_DEFINITIONS, DORMANT_PERMISSIONS } from "@/lib/permissions";
import {
  MAX_SLOTS_PER_SUBMISSION,
  TIME_OPTIONS,
  VISIT_HORIZON_DAYS,
  VISIT_WEEKS_AHEAD,
  WEEKDAYS,
  addDays,
  formatDayLabel,
  formatSlotRange,
  fromIsoDate,
  isOfferedMinute,
  minuteLabel,
  schedulableDates,
  startOfWeek,
  todayInTimezone,
  toIsoDate,
  visitVenueSentence,
  weekWindow,
} from "@/lib/visits";

/**
 * Visiting times.
 *
 * The properties asserted here are the ones that fail silently in production
 * and would be discovered by a family standing outside a locked door: a date
 * that shifts by one because something converted a timezone it should not have,
 * a week that pages into nothing, and a cancelled slot that stops being drawn.
 */

describe("calendar dates are calendar dates", () => {
  it("round-trips through the ISO form without moving", () => {
    for (const iso of ["2026-01-01", "2026-08-26", "2026-12-31", "2028-02-29"]) {
      expect(toIsoDate(fromIsoDate(iso) as Date)).toBe(iso);
    }
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    // The whole reason this parser exists. `new Date("2026-02-31")` is happy to
    // hand back 3 March, and a librarian would never see that they had.
    expect(fromIsoDate("2026-02-31")).toBeNull();
    expect(fromIsoDate("2026-13-01")).toBeNull();
    expect(fromIsoDate("26-08-01")).toBeNull();
    expect(fromIsoDate("")).toBeNull();
  });

  /**
   * The bug this whole design exists to make impossible.
   *
   * A slot stored as an instant and read back in another zone is a different
   * day. Asia/Kolkata is +05:30, so a server rendering a UTC instant at 22:00
   * local is already on tomorrow's date — which is exactly how "Saturday at
   * four" becomes Sunday for somebody.
   */
  it("reads today in the library's own calendar, not the server's", () => {
    // 25 August 2026, 20:30 UTC — which is already the 26th in Kolkata.
    const instant = new Date("2026-08-25T20:30:00Z");

    expect(toIsoDate(todayInTimezone("Asia/Kolkata", instant))).toBe("2026-08-26");
    expect(toIsoDate(todayInTimezone("UTC", instant))).toBe("2026-08-25");
  });

  it("starts a week on Monday, from any day inside it", () => {
    // 26 August 2026 is a Wednesday.
    const wednesday = fromIsoDate("2026-08-26") as Date;
    expect(toIsoDate(startOfWeek(wednesday))).toBe("2026-08-24");

    // Sunday belongs to the week that started six days earlier, not to the next
    // one. Getting this wrong shifts every card by a week for one day in seven.
    const sunday = fromIsoDate("2026-08-30") as Date;
    expect(toIsoDate(startOfWeek(sunday))).toBe("2026-08-24");

    const monday = fromIsoDate("2026-08-24") as Date;
    expect(toIsoDate(startOfWeek(monday))).toBe("2026-08-24");
  });
});

describe("the week a reader is looking at", () => {
  const today = fromIsoDate("2026-08-26") as Date;

  it("names the first two weeks in words", () => {
    expect(weekWindow(0, today).label).toBe("This week");
    expect(weekWindow(1, today).label).toBe("Next week");
    expect(weekWindow(4, today).label).toMatch(/^Week of /);
  });

  it("covers Monday to Sunday", () => {
    const week = weekWindow(0, today);
    expect(toIsoDate(week.from)).toBe("2026-08-24");
    expect(toIsoDate(week.to)).toBe("2026-08-30");
  });

  /**
   * The offset arrives in a query string, which is to say from anywhere. A card
   * that threw on `?week=-5` would have turned a stranger's typo into a child's
   * error page.
   */
  it("clamps anything a URL could contain instead of failing", () => {
    expect(weekWindow(-5, today).offset).toBe(0);
    expect(weekWindow(Number.NaN, today).offset).toBe(0);
    expect(weekWindow(9_999, today).offset).toBe(VISIT_WEEKS_AHEAD);
    expect(weekWindow(1.7, today).offset).toBe(1);
  });

  it("pages no further forward than a librarian may schedule", () => {
    const last = weekWindow(VISIT_WEEKS_AHEAD, today);
    const furthestSchedulable = addDays(today, VISIT_HORIZON_DAYS - 1);

    // The last reachable week must still contain schedulable days, or the
    // reader's "next" arrow walks into weeks nobody can ever fill.
    expect(last.from.getTime()).toBeLessThanOrEqual(furthestSchedulable.getTime());
  });
});

describe("the dropdowns", () => {
  it("offers about three months of dates, starting today", () => {
    const today = fromIsoDate("2026-08-26") as Date;
    const dates = schedulableDates(today);

    expect(dates).toHaveLength(VISIT_HORIZON_DAYS);
    expect(toIsoDate(dates[0] as Date)).toBe("2026-08-26");
    expect(VISIT_HORIZON_DAYS).toBeGreaterThanOrEqual(90);
  });

  it("names every weekday exactly once, Monday first", () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS[0]?.label).toBe("Monday");
    expect(WEEKDAYS[6]?.label).toBe("Sunday");
    // getUTCDay() numbering, so Sunday is 0 wherever it appears in the list.
    expect(WEEKDAYS[6]?.value).toBe(0);
    expect(new Set(WEEKDAYS.map((day) => day.value)).size).toBe(7);
  });

  it("writes times the way a child reads them", () => {
    expect(minuteLabel(0)).toBe("12:00 am");
    expect(minuteLabel(9 * 60)).toBe("9:00 am");
    expect(minuteLabel(12 * 60)).toBe("12:00 pm");
    expect(minuteLabel(16 * 60 + 30)).toBe("4:30 pm");
    expect(formatSlotRange(16 * 60, 17 * 60)).toBe("4:00 pm – 5:00 pm");
  });

  /**
   * The closed list is the point. Two volunteers typing opening hours freehand
   * produce `16:00`, `4pm` and `4:00 PM` for one hour, and a child reading
   * three spellings learns the library is not sure when it is open.
   */
  it("accepts only times that are on the list", () => {
    expect(isOfferedMinute(16 * 60)).toBe(true);
    expect(isOfferedMinute(16 * 60 + 7)).toBe(false);
    expect(isOfferedMinute(3 * 60)).toBe(false);
    expect(isOfferedMinute(-60)).toBe(false);
    expect(TIME_OPTIONS.every((option) => isOfferedMinute(option.value))).toBe(true);
  });

  it("puts a ceiling on one submission", () => {
    // "Every Saturday for three months" is thirteen rows, and a library that
    // opens every single day for the whole horizon is a real thing rather than
    // a slip — so the cap has to clear the horizon, not sit under it. It exists
    // to stop one submission writing an unbounded number of rows, not to
    // second-guess a librarian who genuinely opens daily.
    expect(MAX_SLOTS_PER_SUBMISSION).toBeGreaterThanOrEqual(VISIT_HORIZON_DAYS);
  });

  it("writes a day the way a person would say it", () => {
    expect(formatDayLabel(fromIsoDate("2026-08-29") as Date)).toBe("Saturday 29 August");
  });
});

describe("the sentence that names the room", () => {
  it("is built from configuration and never carries a name of its own", () => {
    const sentence = visitVenueSentence("the Reading Room");

    expect(sentence).toContain("the Reading Room");
    expect(sentence).toMatch(/collect a book or bring one back/);
    // No community's room name may be baked into the platform's copy.
    expect(sentence).not.toMatch(/yoga/i);
  });
});

describe("who may do what", () => {
  const roleOf = (key: string) => ROLE_DEFINITIONS.find((role) => role.key === key);

  it("lets a librarian say when the desk is open", () => {
    expect(roleOf("LIBRARIAN")?.permissions).toContain("visit.manage");
  });

  /**
   * Adding a time is an offer. Cancelling one breaks an offer a family has
   * already read and may have arranged a Saturday around — the same shape as
   * every other undo-a-published-thing key here, and the Super Admin's alone.
   */
  it("keeps cancelling and the notice board with the Super Admin alone", () => {
    for (const key of ["visit.cancel", "announcement.manage"] as const) {
      expect(roleOf("SUPER_ADMIN")?.permissions).toContain(key);
      expect(roleOf("LIBRARIAN")?.permissions).not.toContain(key);
      expect(roleOf("JUNIOR_LIBRARIAN")?.permissions).not.toContain(key);
      expect(roleOf("MEMBER")?.permissions).not.toContain(key);
    }
  });

  it("no longer calls the notice board unimplemented", () => {
    expect(DORMANT_PERMISSIONS as readonly string[]).not.toContain("announcement.manage");
    expect(DORMANT_PERMISSIONS as readonly string[]).not.toContain("visit.manage");
    expect(DORMANT_PERMISSIONS as readonly string[]).not.toContain("visit.cancel");
  });

  /**
   * Hiding a button is not authorization, and the way that rule dies is a page
   * that checks a permission the service behind it does not. Both services ask
   * for their own key.
   */
  it("checks its permissions in the service, not only on the page", () => {
    const service = readFileSync("src/server/services/visit-service.ts", "utf8");

    expect(service).toContain('requirePermission("visit.manage")');
    expect(service).toContain('requirePermission("visit.cancel")');
    // The reader's view takes a week and nothing else — no member id, no
    // library id, nothing a curious nine-year-old could change.
    expect(service).toMatch(/export async function listVisitWeek\(offset = 0\)/);
  });

  /**
   * A slot is never deleted. A child who read "Saturday at four" must find that
   * Saturday crossed out, not find nothing — the row survives so the card can
   * say so.
   */
  it("cancels by status and never by deletion", () => {
    const service = readFileSync("src/server/services/visit-service.ts", "utf8");

    expect(service).not.toMatch(/visitSlot\.delete/);
    expect(service).toContain('status: "CANCELLED"');
  });
});
