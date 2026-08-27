import type { UserStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_CIRCULATION_SETTINGS,
  BORROWING_ALLOWED_STATUSES,
  CIRCULATION_MESSAGES,
  DORMANT_CIRCULATION_SETTINGS,
  daysOverdue,
  isLoanFilter,
  LOAN_STATUSES,
  loanCondition,
  loanStatusDefinition,
  memberMayBorrow,
  readerDueSentence,
  readerLoanBadge,
  RETURN_ANNOUNCEMENT_MESSAGES,
  staffOverdueSummary,
} from "@/lib/circulation";

/**
 * Circulation's vocabulary and its one derivation, with no database.
 *
 * Two things are under test here, and they are the two things a database test
 * cannot see: the arithmetic of "overdue" across a timezone boundary, and the
 * exact words a child reads when they are late.
 *
 * The wording tests are not decoration. This library charges no fines and
 * never will, and the copy is the only place that promise is visible to the
 * person it is a promise to. A future edit that makes any of this harsher
 * fails here.
 */

const TZ = "Asia/Kolkata";

/** Midday in Kolkata on 17 August 2026, as a UTC instant. */
const NOW = new Date("2026-08-17T06:30:00Z");

function activeDue(iso: string) {
  return { status: "ACTIVE" as const, dueAt: new Date(iso) };
}

describe("the derived condition", () => {
  it("is active while there is plenty of time", () => {
    expect(loanCondition(activeDue("2026-08-31T18:29:59Z"), TZ, NOW)).toBe("active");
  });

  it("becomes dueSoon two days out", () => {
    expect(loanCondition(activeDue("2026-08-19T18:29:59Z"), TZ, NOW)).toBe("dueSoon");
  });

  it("is still dueSoon, not overdue, on the day itself", () => {
    // The due date is the last day the child may keep it, not the first day
    // they are late.
    expect(loanCondition(activeDue("2026-08-17T18:29:59Z"), TZ, NOW)).toBe("dueSoon");
    expect(daysOverdue(activeDue("2026-08-17T18:29:59Z"), TZ, NOW)).toBe(0);
  });

  it("becomes overdue the day after", () => {
    expect(loanCondition(activeDue("2026-08-16T18:29:59Z"), TZ, NOW)).toBe("overdue");
    expect(daysOverdue(activeDue("2026-08-16T18:29:59Z"), TZ, NOW)).toBe(1);
  });

  it("counts days in the library's calendar, not the browser's", () => {
    /*
     * 17 August, 20:00 UTC is already 18 August in Kolkata. A due date of the
     * 17th is therefore one day past — and a library that computed this in the
     * server's timezone would say zero, disagreeing with the book on the shelf
     * and with the child holding it.
     */
    const lateEvening = new Date("2026-08-17T20:00:00Z");
    expect(daysOverdue(activeDue("2026-08-17T18:29:59Z"), TZ, lateEvening)).toBe(1);
  });

  it("never calls a returned book overdue, however late it came back", () => {
    const longGone = { status: "RETURNED" as const, dueAt: new Date("2026-01-01T00:00:00Z") };
    expect(loanCondition(longGone, TZ, NOW)).toBe("returned");
    expect(daysOverdue(longGone, TZ, NOW)).toBe(0);
    expect(staffOverdueSummary(longGone, TZ, NOW)).toBeNull();
  });

  it("never calls a cancelled loan overdue either", () => {
    const cancelled = { status: "CANCELLED" as const, dueAt: new Date("2026-01-01T00:00:00Z") };
    expect(loanCondition(cancelled, TZ, NOW)).toBe("cancelled");
    expect(daysOverdue(cancelled, TZ, NOW)).toBe(0);
  });
});

describe("what a child reads", () => {
  it("never shames a child who is late", () => {
    const late = activeDue("2026-08-10T18:29:59Z");
    const badge = readerLoanBadge(late, TZ, NOW);
    const sentence = readerDueSentence(late, TZ, NOW);

    expect(badge.label).toBe("Ready to come home");
    expect(sentence).toBe("This book was due back on 10 Aug. Please return it when you can.");

    // The words this library will not use to a nine-year-old.
    const copy = `${badge.label} ${sentence}`.toLowerCase();
    for (const word of ["overdue", "late", "fine", "penalty", "owe", "must", "warning", "!"]) {
      expect(copy).not.toContain(word);
    }
  });

  it("does not count days at a child", () => {
    // Seven days over. The desk sees "7 days over"; the child sees a date.
    const late = activeDue("2026-08-10T18:29:59Z");
    expect(staffOverdueSummary(late, TZ, NOW)).toBe("7 days over");
    expect(readerDueSentence(late, TZ, NOW)).not.toContain("7");
  });

  it("asks plainly when the day is close", () => {
    expect(readerDueSentence(activeDue("2026-08-17T18:29:59Z"), TZ, NOW)).toBe(
      "Please bring this one back today.",
    );
    expect(readerDueSentence(activeDue("2026-08-18T18:29:59Z"), TZ, NOW)).toBe(
      "Please bring this one back tomorrow.",
    );
  });

  it("is warm when there is time left", () => {
    const relaxed = activeDue("2026-08-31T18:29:59Z");
    expect(readerLoanBadge(relaxed, TZ, NOW).label).toBe("You have this one");
    expect(readerDueSentence(relaxed, TZ, NOW)).toBe("Yours until 31 Aug.");
  });

  it("pairs every badge with a word, never a colour alone", () => {
    for (const due of ["2026-08-10", "2026-08-17", "2026-08-19", "2026-08-31"]) {
      const badge = readerLoanBadge(activeDue(`${due}T18:29:59Z`), TZ, NOW);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.tone.length).toBeGreaterThan(0);
    }
  });
});

describe("returning a book, in words a child can read", () => {
  const messages = Object.values(RETURN_ANNOUNCEMENT_MESSAGES);

  it("says what the child is doing, not what the library calls it", () => {
    // "I'm bringing this back" describes an errand. A child looking for how to
    // give a book back is looking for the word "return".
    expect(RETURN_ANNOUNCEMENT_MESSAGES.invitation).toBe("Finished this book?");
  });

  it("never claims the book is back", () => {
    // The book is in a bag by the front door. Every sentence here has to stay
    // true after the child closes the laptop.
    for (const message of messages) {
      expect(message.toLowerCase()).not.toMatch(/\breturned\b|\bback on the shelf\b/);
    }
  });

  it("keeps its sentences short enough to read", () => {
    for (const message of messages) {
      for (const sentence of message.split(/[.?!]\s+/)) {
        const words = sentence.trim().split(/\s+/).filter(Boolean).length;
        expect(words, `too long: "${sentence}"`).toBeLessThanOrEqual(18);
      }
    }
  });

  it("uses no word the library would not say out loud to a child", () => {
    const copy = messages.join(" ").toLowerCase();
    for (const word of ["announce", "request", "submit", "pending", "status", "confirm"]) {
      expect(copy, `found "${word}"`).not.toContain(word);
    }
  });
});

describe("refusal messages", () => {
  it("names the configured limit rather than a literal", () => {
    expect(CIRCULATION_MESSAGES.loanLimitReached("Aarav", 2)).toBe(
      "Aarav already has 2 books borrowed. Please return one before borrowing another.",
    );
    // A library that lends four books gets a message that says four.
    expect(CIRCULATION_MESSAGES.loanLimitReached("Aarav", 4)).toContain("4 books");
    // And one that lends one gets a sentence that reads correctly in English.
    expect(CIRCULATION_MESSAGES.loanLimitReached("Aarav", 1)).toBe(
      "Aarav already has a book borrowed. Please return it before borrowing another.",
    );
  });

  it("says nothing about why an account is unavailable", () => {
    const message = CIRCULATION_MESSAGES.readerUnavailable;
    expect(message).toBe("This library account is currently unavailable for borrowing.");
    for (const leak of ["suspend", "deactivat", "archiv", "banned", "reason"]) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  it("mentions no fine, anywhere", () => {
    const everything = [
      ...Object.values(CIRCULATION_MESSAGES).filter((value) => typeof value === "string"),
      CIRCULATION_MESSAGES.loanLimitReached("Aarav", 2),
      CIRCULATION_MESSAGES.loanLimitReached("Aarav", 1),
      CIRCULATION_MESSAGES.renewalLimitReached(0),
      CIRCULATION_MESSAGES.renewalLimitReached(1),
      CIRCULATION_MESSAGES.renewalLimitReached(3),
    ].join(" ");

    // Whole words. A substring check would flag "owe" inside "borrowed" and
    // "fine" inside "define", and a test that cries wolf gets deleted.
    for (const word of ["fine", "fines", "fee", "fees", "charge", "penalty", "pay", "owe", "owes"]) {
      expect(everything).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });

  it("explains the overdue renewal rule in terms of what to do next", () => {
    expect(CIRCULATION_MESSAGES.renewalBlockedByOverdue).toContain("Bring it to the desk");
  });
});

describe("loan status vocabulary", () => {
  it("has exactly three states, and overdue is not one of them", () => {
    expect(LOAN_STATUSES.map((status) => status.value)).toEqual([
      "ACTIVE",
      "RETURNED",
      "CANCELLED",
    ]);
  });

  it("gives every status a word for the desk and a word for a child", () => {
    for (const status of LOAN_STATUSES) {
      expect(status.staffLabel.length).toBeGreaterThan(0);
      expect(status.readerLabel.length).toBeGreaterThan(0);
    }
  });

  it("throws rather than inventing a label for an unknown status", () => {
    // A silent "Unknown" on a child's screen would hide a drifted enum.
    expect(() => loanStatusDefinition("OVERDUE" as never)).toThrow(/Unknown loan status/);
  });
});

describe("desk filters", () => {
  it("accepts only the three it defines", () => {
    expect(isLoanFilter("active")).toBe(true);
    expect(isLoanFilter("overdue")).toBe(true);
    expect(isLoanFilter("returned")).toBe(true);
    // Anything else in a query string is dropped rather than passed to SQL.
    expect(isLoanFilter("' OR 1=1 --")).toBe(false);
    expect(isLoanFilter("cancelled")).toBe(false);
  });
});

describe("who may borrow", () => {
  /**
   * The list is an allowlist, and this is the test that keeps it one.
   *
   * A denylist drifts silently: add a state to `UserStatus`, forget the
   * circulation rule, and the new state can take books home. Written this way,
   * a new state has to be argued for here before it can borrow anywhere.
   */
  const EVERY_STATUS: readonly UserStatus[] = [
    "INVITED",
    "ACTIVE",
    "SUSPENDED",
    "DEACTIVATED",
    "ARCHIVED",
  ];

  it("lets an active member borrow", () => {
    expect(memberMayBorrow("ACTIVE")).toBe(true);
  });

  it.each(["INVITED", "SUSPENDED", "DEACTIVATED", "ARCHIVED"] as const)(
    "does not let a %s member borrow",
    (status) => {
      expect(memberMayBorrow(status)).toBe(false);
    },
  );

  it("allows exactly one state, so a new one cannot inherit borrowing", () => {
    expect(BORROWING_ALLOWED_STATUSES).toEqual(["ACTIVE"]);
    expect(EVERY_STATUS.filter(memberMayBorrow)).toEqual(["ACTIVE"]);
  });

  it("says the same thing to everyone it refuses", () => {
    // One sentence for every refused state. Which state a family is in is
    // their business and a conversation, never a label on a desk screen.
    expect(CIRCULATION_MESSAGES.readerUnavailable).toBe(
      "This library account is currently unavailable for borrowing.",
    );
    expect(CIRCULATION_MESSAGES.readerUnavailable).not.toMatch(
      /\b(invited|suspended|deactivated|archived|status)\b/i,
    );
  });
});

describe("configuration that is not implemented", () => {
  it("does not claim a dormant setting is active", () => {
    for (const setting of DORMANT_CIRCULATION_SETTINGS) {
      expect(ACTIVE_CIRCULATION_SETTINGS).not.toContain(setting);
    }
  });

  it("names every setting circulation actually reads", () => {
    // If a rule stops being configurable, or a new one starts, this list has to
    // be updated in the same change — which is the point of having it.
    expect([...ACTIVE_CIRCULATION_SETTINGS].sort()).toEqual([
      "allowRenewalWhenOverdue",
      "borrowingPeriodDays",
      "maxActiveLoans",
      "maxRenewals",
      // Both arrived in Phase 4, when reminders were implemented, and left the
      // dormant list in the same change.
      "overdueReminderOffsets",
      "overdueRemindersEnabled",
      "renewalPeriodDays",
      "timezone",
    ]);
  });
});
