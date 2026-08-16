import { describe, expect, it } from "vitest";

import {
  ageInYears,
  calculateDueDate,
  calculateRenewedDueDate,
  daysUntilDue,
  describeDueDate,
  endOfDayInTimezone,
  isOverdue,
} from "@/lib/dates";

const IST = "Asia/Kolkata";

/** Helper: the instant corresponding to a wall-clock time in IST (UTC+05:30). */
function ist(iso: string): Date {
  return new Date(`${iso}+05:30`);
}

describe("due date calculation", () => {
  it("adds the configured number of days and lands at end of day", () => {
    const issuedAt = ist("2026-08-17T09:15:00");
    const dueAt = calculateDueDate(issuedAt, 14, IST);

    expect(dueAt.toISOString()).toBe(ist("2026-08-31T23:59:59.999").toISOString());
  });

  it("gives the same due date whether a book goes out in the morning or the evening", () => {
    // A physical library does not care what time of day the book left the shelf.
    const morning = calculateDueDate(ist("2026-08-17T09:00:00"), 14, IST);
    const evening = calculateDueDate(ist("2026-08-17T18:45:00"), 14, IST);

    expect(morning.toISOString()).toBe(evening.toISOString());
  });

  it("uses the library timezone, not the machine's", () => {
    // 20:00 UTC on the 17th is already 01:30 on the 18th in Kolkata, so the due
    // date must be counted from the 18th.
    const lateUtc = new Date("2026-08-17T20:00:00Z");
    const dueAt = calculateDueDate(lateUtc, 14, IST);

    expect(dueAt.toISOString()).toBe(ist("2026-09-01T23:59:59.999").toISOString());
  });

  it("respects a different configured period — nothing is hard-coded to 14", () => {
    const issuedAt = ist("2026-08-17T09:00:00");
    expect(calculateDueDate(issuedAt, 7, IST).toISOString()).toBe(
      ist("2026-08-24T23:59:59.999").toISOString(),
    );
    expect(calculateDueDate(issuedAt, 21, IST).toISOString()).toBe(
      ist("2026-09-07T23:59:59.999").toISOString(),
    );
  });

  it("refuses a nonsensical borrowing period", () => {
    const issuedAt = ist("2026-08-17T09:00:00");
    expect(() => calculateDueDate(issuedAt, 0, IST)).toThrow(RangeError);
    expect(() => calculateDueDate(issuedAt, -3, IST)).toThrow(RangeError);
    expect(() => calculateDueDate(issuedAt, 1.5, IST)).toThrow(RangeError);
  });

  it("extends a renewal from the current due date, not from today", () => {
    const currentDue = ist("2026-08-31T23:59:59.999");
    const renewed = calculateRenewedDueDate(currentDue, 7, IST);

    expect(renewed.toISOString()).toBe(ist("2026-09-07T23:59:59.999").toISOString());
  });
});

describe("overdue is derived, never stored", () => {
  const dueAt = ist("2026-08-31T23:59:59.999");

  it("is not overdue one second before the end of the due day", () => {
    expect(isOverdue(dueAt, ist("2026-08-31T23:59:58"))).toBe(false);
  });

  it("is not overdue at any point during the due day", () => {
    expect(isOverdue(dueAt, ist("2026-08-31T00:00:01"))).toBe(false);
    expect(isOverdue(dueAt, ist("2026-08-31T12:00:00"))).toBe(false);
  });

  it("becomes overdue once the due day has passed in the library's timezone", () => {
    expect(isOverdue(dueAt, ist("2026-09-01T00:00:01"))).toBe(true);
  });
});

describe("days until due", () => {
  const dueAt = ist("2026-08-31T23:59:59.999");

  it("counts calendar days in the library timezone", () => {
    expect(daysUntilDue(dueAt, IST, ist("2026-08-31T08:00:00"))).toBe(0);
    expect(daysUntilDue(dueAt, IST, ist("2026-08-30T08:00:00"))).toBe(1);
    expect(daysUntilDue(dueAt, IST, ist("2026-08-24T08:00:00"))).toBe(7);
  });

  it("goes negative once a book is late", () => {
    expect(daysUntilDue(dueAt, IST, ist("2026-09-03T08:00:00"))).toBe(-3);
  });
});

describe("friendly due date wording", () => {
  const dueAt = ist("2026-08-31T23:59:59.999");

  it("never uses punitive language for a late book", () => {
    const late = describeDueDate(dueAt, IST, ist("2026-09-05T10:00:00"));

    expect(late.tone).toBe("late");
    expect(late.text).toBe("Ready to come home 🏠");
    // There are no fines in this library; the copy must never imply otherwise.
    expect(late.text.toLowerCase()).not.toMatch(/overdue|fine|penalty|late fee/);
  });

  it("describes today and tomorrow in words a child reads quickly", () => {
    expect(describeDueDate(dueAt, IST, ist("2026-08-31T10:00:00")).text).toBe("Back today");
    expect(describeDueDate(dueAt, IST, ist("2026-08-30T10:00:00")).text).toBe("Back tomorrow");
  });

  it("gives a plain date when there is plenty of time", () => {
    const relaxed = describeDueDate(dueAt, IST, ist("2026-08-20T10:00:00"));
    expect(relaxed.tone).toBe("ok");
    expect(relaxed.text).toContain("Yours until");
  });
});

describe("age in years", () => {
  it("counts a birthday that has already happened this year", () => {
    expect(ageInYears(new Date("2016-04-12T00:00:00Z"), IST, ist("2026-08-17T10:00:00"))).toBe(10);
  });

  it("does not count a birthday still to come this year", () => {
    expect(ageInYears(new Date("2016-12-25T00:00:00Z"), IST, ist("2026-08-17T10:00:00"))).toBe(9);
  });

  it("counts the birthday itself", () => {
    expect(ageInYears(new Date("2016-08-17T00:00:00Z"), IST, ist("2026-08-17T10:00:00"))).toBe(10);
  });
});

describe("end of day", () => {
  it("returns 23:59:59.999 local time as a UTC instant", () => {
    const result = endOfDayInTimezone(ist("2026-08-17T09:00:00"), IST);
    expect(result.toISOString()).toBe("2026-08-17T18:29:59.999Z");
  });
});
