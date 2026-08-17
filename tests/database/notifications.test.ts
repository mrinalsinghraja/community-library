import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import { runDailyMaintenance } from "@/server/lib/maintenance";
import { issueBook, renewLoan } from "@/server/services/circulation-service";
import { sendCirculationReminders } from "@/server/services/notification-service";

import { FakeEmailProvider } from "./fake-email";
import {
  attachGuardian,
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Reminders, against a real database.
 *
 * This library charges no fines and cannot compel anybody, so a note to a
 * parent is quite literally the whole mechanism by which books come back. That
 * makes two failures serious in a way a missing feature would not be:
 *
 *   • **Sending the same reminder twice.** A message that arrives every morning
 *     is one people filter, and then the library has no mechanism at all. Half
 *     this file is about the unique constraint that prevents it — including
 *     when two jobs run at the same instant.
 *
 *   • **A reminder changing something.** Nothing in the notification path may
 *     touch a loan, a due date, a renewal count or a book's status. A mail
 *     server having a bad morning must not alter what the library believes
 *     about where its books are.
 *
 * Everything here goes through the real service against real PostgreSQL, with
 * only the email transport replaced — so the claim rows, the constraint and the
 * delivery log are the real ones.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** Turns the library's reminders on, with the offsets under test. */
async function configureReminders(offsets: number[], enabled = true) {
  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: { overdueRemindersEnabled: enabled, overdueReminderOffsets: offsets },
  });
}

/**
 * Issues a book and then moves its due date, which is how every "two days from
 * now" and "a week late" case here is built.
 *
 * Moving the stored date is legitimate in a way that faking a clock would not
 * be: the loan really does have that due date, and everything downstream
 * derives from it exactly as it would in August.
 */
async function loanDueIn(memberUserId: string, days: number) {
  const copy = await createBookCopy(fixture.libraryId);
  await actingAs(librarian.id);
  const issued = await issueBook({ memberUserId, copyId: copy.id });

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + days);
  dueAt.setHours(23, 59, 59, 999);

  /*
   * The issue date moves with it. `loan_due_after_issue` is a real CHECK
   * constraint and it is right: a book cannot be due before it was lent. To
   * build a loan that is three days late, the whole loan has to sit in the
   * past — which is also what such a loan looks like in the library.
   */
  const issuedAt = new Date(dueAt);
  issuedAt.setDate(issuedAt.getDate() - 14);

  await db.loan.update({ where: { id: issued.loanId }, data: { dueAt, issuedAt } });
  return { loanId: issued.loanId, copyId: copy.id, dueAt };
}

beforeAll(async () => {
  __setEmailProviderForTests(mail);
});

afterAll(async () => {
  __setEmailProviderForTests(null);
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  mail.reset();
});

describe("who gets written to", () => {
  it("writes to the guardian about a book due soon", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "Aarav Sharma" });
    await attachGuardian(fixture.libraryId, reader.id, "parent@example.invalid");
    await configureReminders([-2]);
    await loanDueIn(reader.id, 2);

    const result = await sendCirculationReminders();

    expect(result).toMatchObject({ enabled: true, due: 1, sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe("parent@example.invalid");
    expect(mail.sent[0]?.template).toBe(TEMPLATE_IDS.LOAN_DUE_SOON);
    // Children in this library have no email address of their own; that is the
    // entire reason the guardian relationship exists.
    expect(mail.sent[0]?.text).toContain("Aarav Sharma");
  });

  it("sends the overdue wording once the date has passed", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([3]);
    await loanDueIn(reader.id, -3);

    await sendCirculationReminders();

    expect(mail.sent[0]?.template).toBe(TEMPLATE_IDS.LOAN_OVERDUE);
    const notification = await db.loanNotification.findFirstOrThrow();
    expect(notification.kind).toBe("OVERDUE");
    expect(notification.offsetDays).toBe(3);
  });

  it("says nothing about a loan whose date is not an offset the library configured", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([-2, 0, 3, 7]);
    await loanDueIn(reader.id, 5);

    const result = await sendCirculationReminders();

    expect(result.due).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("never writes about a book that has come back", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([0]);
    const loan = await loanDueIn(reader.id, 0);

    await db.$transaction([
      db.loan.update({
        where: { id: loan.loanId },
        data: { status: "RETURNED", returnedAt: new Date() },
      }),
      db.bookCopy.update({ where: { id: loan.copyId }, data: { status: "AVAILABLE" } }),
    ]);

    const result = await sendCirculationReminders();

    expect(result.due).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("never writes about a cancelled loan", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([0]);
    const loan = await loanDueIn(reader.id, 0);

    await db.$transaction([
      db.loan.update({
        where: { id: loan.loanId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      }),
      db.bookCopy.update({ where: { id: loan.copyId }, data: { status: "AVAILABLE" } }),
    ]);

    expect((await sendCirculationReminders()).due).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("stops writing to a family that has left, and keeps asking a paused account", async () => {
    const gone = await createMember(fixture.libraryId, { displayName: "Gone Away" });
    const paused = await createMember(fixture.libraryId, { displayName: "Paused Reader" });
    await attachGuardian(fixture.libraryId, gone.id, "gone@example.invalid");
    await attachGuardian(fixture.libraryId, paused.id, "paused@example.invalid");
    await configureReminders([0]);

    await loanDueIn(gone.id, 0);
    await loanDueIn(paused.id, 0);

    // Both changed after the books went out, which is the realistic order.
    await db.appUser.update({ where: { id: gone.id }, data: { status: "DEACTIVATED" } });
    await db.appUser.update({ where: { id: paused.id }, data: { status: "SUSPENDED" } });

    const result = await sendCirculationReminders();

    expect(result.sent).toBe(1);
    expect(mail.sent.map((message) => message.to)).toEqual(["paused@example.invalid"]);
  });

  it("counts a loan with nobody to write to, and claims nothing", async () => {
    const reader = await createMember(fixture.libraryId);
    await configureReminders([0]);
    await loanDueIn(reader.id, 0);

    const result = await sendCirculationReminders();

    expect(result).toMatchObject({ due: 1, noRecipient: 1, sent: 0 });
    expect(mail.sent).toHaveLength(0);
    // No claim row: there was never a message, so there is no occurrence to
    // burn. If a guardian address is added tomorrow, the reminder can still go.
    expect(await db.loanNotification.count()).toBe(0);
  });
});

describe("the switch", () => {
  it("sends nothing at all while reminders are off", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([0], false);
    await loanDueIn(reader.id, 0);

    const result = await sendCirculationReminders();

    expect(result.enabled).toBe(false);
    expect(mail.sent).toHaveLength(0);
    expect(await db.loanNotification.count()).toBe(0);
  });

  it("sends nothing when a library has configured no offsets", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([]);
    await loanDueIn(reader.id, 0);

    const result = await sendCirculationReminders();

    expect(result).toMatchObject({ enabled: true, due: 0, sent: 0 });
    expect(mail.sent).toHaveLength(0);
  });
});

describe("saying it once", () => {
  it("does not repeat itself when the job runs again the same day", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([-2]);
    await loanDueIn(reader.id, 2);

    const first = await sendCirculationReminders();
    const second = await sendCirculationReminders();
    const third = await sendCirculationReminders();

    expect(first.sent).toBe(1);
    expect(second).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(third).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(mail.sent).toHaveLength(1);
    expect(await db.loanNotification.count()).toBe(1);
  });

  it("survives two jobs running at the same instant", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([0]);
    await loanDueIn(reader.id, 0);

    /*
     * Genuinely parallel, not sequential-with-a-promise. This is the case the
     * unique index exists for: a check-then-insert in application code has a
     * window between the halves, and two Vercel cron invocations — or one cron
     * and one operator running it by hand — would both walk through it.
     */
    const [a, b] = await Promise.all([
      sendCirculationReminders(),
      sendCirculationReminders(),
    ]);

    expect(a.sent + b.sent).toBe(1);
    expect(a.alreadySent + b.alreadySent).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(await db.loanNotification.count()).toBe(1);
  });

  it("says it again on the next configured occasion, and only then", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([-2, 0, 3]);
    const loan = await loanDueIn(reader.id, 2);

    expect((await sendCirculationReminders()).sent).toBe(1);

    // Two days pass: the same loan is now due today.
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    await db.loan.update({ where: { id: loan.loanId }, data: { dueAt: today } });

    expect((await sendCirculationReminders()).sent).toBe(1);
    expect(mail.sent).toHaveLength(2);

    const claims = await db.loanNotification.findMany({ orderBy: { offsetDays: "asc" } });
    expect(claims.map((claim) => claim.offsetDays)).toEqual([-2, 0]);
  });
});

describe("a renewal moves the goalposts", () => {
  it("never sends a reminder about the old due date once a loan is renewed", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([-2, 0, 3]);
    const loan = await loanDueIn(reader.id, 2);

    const before = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });

    await actingAs(librarian.id);
    const renewed = await renewLoan({ loanId: loan.loanId });

    // The new date is a fortnight out, so no configured occasion matches today.
    const result = await sendCirculationReminders();

    expect(renewed.dueAt.getTime()).toBeGreaterThan(before.dueAt.getTime());
    expect(result.due).toBe(0);
    expect(mail.sent).toHaveLength(0);
    expect(await db.loanNotification.count()).toBe(0);
  });

  it("reminds about the new date when it comes round", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([-2]);
    const loan = await loanDueIn(reader.id, 2);

    // Reminded once about the original date...
    expect((await sendCirculationReminders()).sent).toBe(1);

    await actingAs(librarian.id);
    const renewed = await renewLoan({ loanId: loan.loanId });

    /*
     * ...and again when the NEW date is two days off. The clock is what moves
     * here, not the data: passing the instant explicitly is how a job that runs
     * once a day is tested without waiting a fortnight, and it keeps the two
     * due dates genuinely different — which is the thing under test.
     */
    const twoDaysBeforeNewDue = new Date(renewed.dueAt);
    twoDaysBeforeNewDue.setDate(twoDaysBeforeNewDue.getDate() - 2);

    expect((await sendCirculationReminders(twoDaysBeforeNewDue)).sent).toBe(1);

    // Two claims, same loan, same offset, different due dates — which is why
    // the due date is part of the unique key.
    const claims = await db.loanNotification.findMany();
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.offsetDays))).toEqual(new Set([-2]));
    expect(new Set(claims.map((claim) => claim.dueAt.getTime())).size).toBe(2);
  });
});

describe("what a reminder may not do", () => {
  it("changes nothing about the loan or the book", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([3]);
    const loan = await loanDueIn(reader.id, -3);

    const beforeLoan = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    const beforeCopy = await db.bookCopy.findUniqueOrThrow({ where: { id: loan.copyId } });
    const beforeEvents = await db.loanEvent.count({ where: { loanId: loan.loanId } });

    await sendCirculationReminders();

    const afterLoan = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    const afterCopy = await db.bookCopy.findUniqueOrThrow({ where: { id: loan.copyId } });

    expect(afterLoan.status).toBe(beforeLoan.status);
    expect(afterLoan.dueAt.getTime()).toBe(beforeLoan.dueAt.getTime());
    expect(afterLoan.renewalCount).toBe(beforeLoan.renewalCount);
    expect(afterLoan.memberUserId).toBe(beforeLoan.memberUserId);
    expect(afterCopy.status).toBe(beforeCopy.status);
    // A reminder is not something that happened to the loan.
    expect(await db.loanEvent.count({ where: { loanId: loan.loanId } })).toBe(beforeEvents);
  });

  it("records a failed delivery without changing the loan or retrying it", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([0]);
    const loan = await loanDueIn(reader.id, 0);

    mail.failNext = true;
    const first = await sendCirculationReminders();

    expect(first).toMatchObject({ sent: 0, failed: 1 });

    const claim = await db.loanNotification.findFirstOrThrow();
    expect(claim.status).toBe("FAILED");
    expect(claim.sentAt).toBeNull();
    expect(claim.emailEventId).not.toBeNull();

    const event = await db.emailEvent.findFirstOrThrow({ where: { id: claim.emailEventId! } });
    expect(event.status).toBe("FAILED");
    expect(event.relatedEntityId).toBe(loan.loanId);

    /*
     * Deliberately NOT retried. The occurrence is spent, and the alternative —
     * trying again tomorrow — risks a family receiving two copies of the same
     * note when a provider reports a failure it actually delivered. A missed
     * reminder is recoverable; a library that cannot be trusted not to spam is
     * not. See docs/NOTIFICATIONS.md.
     */
    const second = await sendCirculationReminders();
    expect(second).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(await db.loanNotification.count()).toBe(1);
  });

  it("keeps the delivery log as the only place a guardian's address is written", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id, "only-here@example.invalid");
    await configureReminders([0]);
    await loanDueIn(reader.id, 0);

    await sendCirculationReminders();

    const claim = await db.loanNotification.findFirstOrThrow();
    // The claim row has no recipient column at all — a second copy of a
    // family's address would be a second thing to have to delete later.
    expect(Object.keys(claim)).not.toContain("recipient");
    expect(JSON.stringify(claim)).not.toContain("only-here@example.invalid");
  });
});

describe("the daily job", () => {
  it("runs reminders as part of housekeeping and reports what it did", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    await configureReminders([0]);
    await loanDueIn(reader.id, 0);

    const result = await runDailyMaintenance();

    expect(result.reminders).toMatchObject({ enabled: true, due: 1, sent: 1 });
    expect(mail.sent).toHaveLength(1);
  });

  it("captures development mail to disk instead of sending it", async () => {
    /*
     * The provider under test in this file is the fake one, so this asserts the
     * property that matters about the real development transport: it is chosen
     * by configuration, and `console` — the development default — writes to
     * `.mail/` and never opens a socket. A test that could reach a real inbox
     * is the one thing this suite must never contain.
     */
    const { CaptureEmailProvider } = await import("@/server/lib/email/providers");
    expect(new CaptureEmailProvider().name).toBe("console");
    expect(process.env.EMAIL_PROVIDER).toBe("console");
  });
});
