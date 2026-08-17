import { describe, expect, it } from "vitest";

import {
  MAX_REMINDER_OFFSET_DAYS,
  memberMayBeReminded,
  normaliseReminderOffsets,
  notificationKindForOffset,
  NOTIFIABLE_MEMBER_STATUSES,
  offsetFromDueDate,
  reminderSentence,
  reminderSubject,
} from "@/lib/notifications";

/**
 * The arithmetic and the wording behind every reminder.
 *
 * Both halves matter for different reasons. The arithmetic decides whether a
 * family hears from the library on the right morning, in the library's own
 * timezone, and it is the thing a daylight-saving bug or a UTC assumption would
 * quietly get wrong. The wording decides whether being late at this library
 * feels like a reminder or a reprimand, and there is no automated way to test
 * kindness — so these tests pin the specific things the library promised not to
 * say.
 */

const TZ = "Asia/Kolkata";

/** End of a given day in library time, which is how due dates are stored. */
function dueOn(iso: string): Date {
  // 23:59:59.999 IST is 18:29:59.999 UTC.
  return new Date(`${iso}T18:29:59.999Z`);
}

const NOW = new Date("2026-08-17T06:00:00.000Z"); // 11:30 on 17 August, IST

describe("offsets from the due date", () => {
  it("is negative before the date, zero on it, positive after", () => {
    expect(offsetFromDueDate(dueOn("2026-08-19"), TZ, NOW)).toBe(-2);
    expect(offsetFromDueDate(dueOn("2026-08-17"), TZ, NOW)).toBe(0);
    expect(offsetFromDueDate(dueOn("2026-08-14"), TZ, NOW)).toBe(3);
    expect(offsetFromDueDate(dueOn("2026-08-10"), TZ, NOW)).toBe(7);
  });

  it("counts calendar days in the library's timezone, not elapsed hours", () => {
    /*
     * 23:00 UTC on 17 August is already 04:30 on 18 August in Kolkata. A book
     * due on the 19th is therefore one day away, not two — and a job that
     * measured in UTC would write to that family a day early.
     */
    const lateEvening = new Date("2026-08-17T23:00:00.000Z");
    expect(offsetFromDueDate(dueOn("2026-08-19"), TZ, lateEvening)).toBe(-1);
  });

  it("puts the boundary at the due date itself", () => {
    // On the day a book is due it is not late: due dates are stored as the end
    // of their day, so 0 is a gentle note and 1 is the first nudge.
    expect(notificationKindForOffset(-2)).toBe("DUE_SOON");
    expect(notificationKindForOffset(0)).toBe("DUE_SOON");
    expect(notificationKindForOffset(1)).toBe("OVERDUE");
    expect(notificationKindForOffset(7)).toBe("OVERDUE");
  });
});

describe("configured offsets", () => {
  it("sorts, de-duplicates and keeps the library's own values", () => {
    expect(normaliseReminderOffsets([7, -2, 0, 3, 7])).toEqual([-2, 0, 3, 7]);
  });

  it("drops values that are not a policy", () => {
    // A reminder 400 days after a due date is a typo, and sending it would be
    // worse than ignoring it.
    expect(normaliseReminderOffsets([0, 1.5, 400, -400, Number.NaN])).toEqual([0]);
    expect(normaliseReminderOffsets([MAX_REMINDER_OFFSET_DAYS + 1])).toEqual([]);
  });

  it("treats an empty list as 'this library sends nothing'", () => {
    expect(normaliseReminderOffsets([])).toEqual([]);
  });
});

describe("who is written to", () => {
  it("is an allowlist of account states", () => {
    expect([...NOTIFIABLE_MEMBER_STATUSES]).toEqual(["ACTIVE", "SUSPENDED"]);
  });

  it("keeps asking a paused account, and stops writing to one that has left", () => {
    // A paused account is often paused *because* a book has not come back, and
    // a polite note is this library's only remedy — it charges no fines.
    expect(memberMayBeReminded("ACTIVE")).toBe(true);
    expect(memberMayBeReminded("SUSPENDED")).toBe(true);

    expect(memberMayBeReminded("DEACTIVATED")).toBe(false);
    expect(memberMayBeReminded("ARCHIVED")).toBe(false);
    expect(memberMayBeReminded("INVITED")).toBe(false);
  });
});

describe("what a reminder says", () => {
  const base = { childName: "Aarav", title: "The Jungle Book", timezone: TZ, now: NOW };

  it("names the date rather than counting days late", () => {
    const late = reminderSentence({ ...base, dueAt: dueOn("2026-08-10") });

    expect(late).toContain("due back on 10 August");
    expect(late).toMatch(/please send it in/i);
    // The things this library decided never to say to a family.
    expect(late).not.toMatch(/\bdays? (late|overdue)\b/i);
    // Word boundaries: "borrowed" contains "owe", and a regex without them
    // fails on a sentence that is perfectly kind.
    expect(late).not.toMatch(/\b(overdue|fines?|fees?|penalty|charges?|owe)\b/i);
    expect(late).not.toMatch(/\b(immediately|urgent|must|failure)\b/i);
  });

  it("says today and tomorrow in words", () => {
    expect(reminderSentence({ ...base, dueAt: dueOn("2026-08-17") })).toContain(
      "due back today, 17 August",
    );
    expect(reminderSentence({ ...base, dueAt: dueOn("2026-08-18") })).toContain(
      "due back tomorrow, 18 August",
    );
  });

  it("mentions one child and one book, and nobody else", () => {
    const sentence = reminderSentence({ ...base, dueAt: dueOn("2026-08-19") });

    expect(sentence).toContain("Aarav");
    expect(sentence).toContain("The Jungle Book");
    expect(sentence.match(/Aarav/g)).toHaveLength(1);
  });

  it("writes a subject that says which book without alarming a inbox", () => {
    expect(reminderSubject({ childName: "Aarav", title: "Matilda", kind: "DUE_SOON" })).toBe(
      "Aarav's library book is due soon: Matilda",
    );
    expect(reminderSubject({ childName: "Aarav", title: "Matilda", kind: "OVERDUE" })).toBe(
      "A library book to come back: Matilda",
    );
  });
});
