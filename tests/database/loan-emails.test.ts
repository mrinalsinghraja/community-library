import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { DEFAULT_TIMEZONE, endOfDayInTimezone } from "@/lib/dates";
import { createSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import { UPLOAD_PURPOSES } from "@/server/lib/uploads";
import {
  decideBorrowRequest,
  issueBook,
  listPendingBorrowRequests,
  requestBorrow,
} from "@/server/services/circulation-service";
import { sendCirculationReminders } from "@/server/services/notification-service";
import { GET as emailCover } from "@/app/api/email-cover/[file]/route";
import { FakeEmailProvider } from "./fake-email";
import { FakeStorageDriver } from "./fake-storage";
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
 * The family-facing mail added in October 2026: the thank-you when a book is
 * handed over, covers carried inside the message, replies routed to the
 * librarian, and the weekly ask once a book is past its date.
 */

/** A transport that, like Gmail SMTP, carries inline pictures. */
class InlineFakeEmailProvider extends FakeEmailProvider {
  readonly supportsInlineImages = true;
}

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new InlineFakeEmailProvider();
const storage = new FakeStorageDriver();
const TIMEZONE = DEFAULT_TIMEZONE;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

async function readerWithGuardian(email = "parent@example.invalid") {
  const reader = await createMember(fixture.libraryId, { displayName: "Aarav Sharma" });
  await attachGuardian(fixture.libraryId, reader.id, email);
  return reader;
}

/** Gives a copy's title a cover whose bytes are in the fake store. */
async function withCover(copyId: string) {
  const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: copyId } });
  const key = `covers/${copy.id}.jpg`;
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  await storage.put(key, bytes, "image/jpeg", "PRIVATE");
  const media = await db.mediaObject.create({
    data: {
      libraryId: fixture.libraryId,
      storageKey: key,
      mimeType: "image/jpeg",
      byteSize: bytes.length,
      checksumSha256: "0".repeat(64),
      purpose: UPLOAD_PURPOSES.BOOK_COVER,
    },
  });
  await db.bookTitle.update({ where: { id: copy.titleId }, data: { coverMediaId: media.id } });
}

async function coverIdOf(copyId: string): Promise<string> {
  const copy = await db.bookCopy.findUniqueOrThrow({
    where: { id: copyId },
    select: { title: { select: { coverMediaId: true } } },
  });
  return copy.title.coverMediaId!;
}

function fetchCover(file: string) {
  return emailCover(new Request(`http://localhost/api/email-cover/${file}`), {
    params: Promise.resolve({ file }),
  });
}

async function setCatalogue(visibility: "PUBLIC" | "MEMBER_ONLY") {
  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: { catalogueVisibility: visibility },
  });
}

async function issue(memberUserId: string) {
  const copy = await createBookCopy(fixture.libraryId);
  await actingAs(librarian.id);
  return { copy, loan: await issueBook({ memberUserId, copyId: copy.id }) };
}

beforeAll(() => {
  __setEmailProviderForTests(mail);
  __setStorageDriverForTests(storage);
});

afterAll(async () => {
  __setEmailProviderForTests(null);
  __setStorageDriverForTests(null);
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  mail.reset();
  storage.objects.clear();
});

describe("the borrowing thank-you", () => {
  it("goes to the guardian when the librarian issues a book", async () => {
    const reader = await readerWithGuardian();
    const { copy } = await issue(reader.id);

    const sent = mail.lastTo("loan_issued");
    expect(sent?.to).toBe("parent@example.invalid");
    expect(sent?.subject).toContain("Thank you for borrowing");
    const title = (await db.bookTitle.findFirstOrThrow({ where: { copies: { some: { id: copy.id } } } })).title;
    expect(sent?.text).toContain(title);
    expect(sent?.text).toContain("please return by");
    expect(sent?.text).toContain("Happy Reading!");
  });

  it("carries the cover inside the message", async () => {
    const reader = await readerWithGuardian();
    const copy = await createBookCopy(fixture.libraryId);
    await withCover(copy.id);
    await actingAs(librarian.id);
    await issueBook({ memberUserId: reader.id, copyId: copy.id });

    const sent = mail.lastTo("loan_issued")!;
    expect(sent.inlineImages).toHaveLength(1);
    expect(sent.inlineImages![0]!.contentType).toBe("image/jpeg");
    expect(sent.html).toContain(`cid:${sent.inlineImages![0]!.cid}`);
  });

  it("lists the book already at home when a second one goes out", async () => {
    const reader = await readerWithGuardian();
    await issue(reader.id);
    await issue(reader.id);

    const second = mail.sent.filter((message) => message.template === "loan_issued")[1]!;
    expect(second.text).toContain("Also at home with Aarav Sharma");
  });

  it("goes out when the librarian approves a child's own ask", async () => {
    const reader = await readerWithGuardian();
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.copyCode });
    await actingAs(librarian.id);
    const [request] = await listPendingBorrowRequests();

    await decideBorrowRequest({ requestId: request!.requestId, decision: "APPROVE" });

    expect(mail.lastTo("loan_issued")?.to).toBe("parent@example.invalid");
  });

  it("sends nothing when the child's ask is declined", async () => {
    const reader = await readerWithGuardian();
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.copyCode });
    await actingAs(librarian.id);
    const [request] = await listPendingBorrowRequests();

    await decideBorrowRequest({ requestId: request!.requestId, decision: "DECLINE", reason: "Back soon" });

    expect(mail.lastTo("loan_issued")).toBeUndefined();
  });

  it("never stops a book going out when there is nobody to write to, or mail fails", async () => {
    const orphan = await createMember(fixture.libraryId, { displayName: "No Guardian" });
    const first = await issue(orphan.id);
    expect(first.loan.loanId).toBeTruthy();
    expect(mail.sent).toHaveLength(0);

    const reader = await readerWithGuardian();
    mail.failNext = true;
    const second = await issue(reader.id);
    expect(await db.loan.findUnique({ where: { id: second.loan.loanId } })).not.toBeNull();
    const event = await db.emailEvent.findFirstOrThrow({ where: { template: "loan_issued" } });
    expect(event.status).toBe("FAILED");
  });

  it("routes replies to the library's contact address", async () => {
    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { contactEmail: "librarian@example.invalid" },
    });
    const reader = await readerWithGuardian();
    await issue(reader.id);

    const sent = mail.lastTo("loan_issued")!;
    expect(sent.replyTo).toBe("librarian@example.invalid");
    expect(sent.text).toContain("librarian@example.invalid");
  });
});

describe("the reminder schedule", () => {
  async function loanDueIn(memberUserId: string, days: number, withBookCover = false) {
    const copy = await createBookCopy(fixture.libraryId);
    if (withBookCover) await withCover(copy.id);
    await actingAs(librarian.id);
    const issued = await issueBook({ memberUserId, copyId: copy.id });
    const dueAt = endOfDayInTimezone(new Date(Date.now() + days * 86_400_000), TIMEZONE);
    const issuedAt = new Date(dueAt.getTime() - 14 * 86_400_000);
    await db.loan.update({ where: { id: issued.loanId }, data: { dueAt, issuedAt } });
    return issued.loanId;
  }

  async function remindersOn() {
    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { overdueRemindersEnabled: true, overdueReminderOffsets: [-7, -1] },
    });
  }

  function reminders() {
    return mail.sent.filter((message) => message.template !== "loan_issued");
  }

  it("is a week before and the day before by default", async () => {
    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });
    expect(settings.overdueReminderOffsets).toEqual([-7, -1]);
  });

  it("writes seven days before, with the cover", async () => {
    await remindersOn();
    const reader = await readerWithGuardian();
    await loanDueIn(reader.id, 7, true);

    expect((await sendCirculationReminders()).sent).toBe(1);
    const [sent] = reminders();
    expect(sent!.template).toBe("loan_due_soon");
    expect(sent!.inlineImages).toHaveLength(1);
  });

  it("asks every week once the date has passed, and only on those days", async () => {
    await remindersOn();
    const reader = await readerWithGuardian();
    const sister = await createMember(fixture.libraryId, { displayName: "Diya Sharma" });
    await attachGuardian(fixture.libraryId, sister.id, "parent2@example.invalid");
    await loanDueIn(reader.id, -14);
    await loanDueIn(reader.id, -10);
    await loanDueIn(sister.id, -21);

    const result = await sendCirculationReminders();
    expect(result.sent).toBe(2);
    expect(reminders().every((message) => message.template === "loan_overdue")).toBe(true);
    expect(reminders()[0]!.text).toMatch(/reply to this email or write to the librarian|have a word with the librarian/);
  });

  it("names two books due the same day in one message", async () => {
    await remindersOn();
    const reader = await readerWithGuardian();
    // Borrowed on the same visit, so both are due back tomorrow.
    await loanDueIn(reader.id, 1);
    await loanDueIn(reader.id, 1);

    const result = await sendCirculationReminders();
    expect(result.sent).toBe(2);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]!.subject).toContain("2 books");

    const claims = await db.loanNotification.findMany();
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.emailEventId)).size).toBe(1);
  });
});

describe("covers when the transport cannot carry them", () => {
  const linking = new FakeEmailProvider();

  it("links the public cover URL instead, while the catalogue is public", async () => {
    __setEmailProviderForTests(linking);
    try {
      await setCatalogue("PUBLIC");
      const reader = await readerWithGuardian();
      const copy = await createBookCopy(fixture.libraryId);
      await withCover(copy.id);
      await actingAs(librarian.id);
      await issueBook({ memberUserId: reader.id, copyId: copy.id });

      const sent = linking.lastTo("loan_issued")!;
      expect(sent.inlineImages ?? []).toHaveLength(0);
      expect(sent.html).toContain(`/api/email-cover/${await coverIdOf(copy.id)}.webp`);
    } finally {
      linking.reset();
      __setEmailProviderForTests(mail);
    }
  });

  it("leaves the picture out when the catalogue is for members only", async () => {
    __setEmailProviderForTests(linking);
    try {
      await setCatalogue("MEMBER_ONLY");
      const reader = await readerWithGuardian();
      const copy = await createBookCopy(fixture.libraryId);
      await withCover(copy.id);
      await actingAs(librarian.id);
      await issueBook({ memberUserId: reader.id, copyId: copy.id });

      expect(linking.lastTo("loan_issued")!.html).not.toContain("/api/email-cover/");
    } finally {
      linking.reset();
      __setEmailProviderForTests(mail);
    }
  });
});

describe("the email cover route", () => {
  it("serves a book cover, publicly cacheable, while the catalogue is public", async () => {
    await setCatalogue("PUBLIC");
    const copy = await createBookCopy(fixture.libraryId);
    await withCover(copy.id);

    const response = await fetchCover(`${await coverIdOf(copy.id)}.webp`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/^public/);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("answers nothing while the catalogue is for members only", async () => {
    await setCatalogue("MEMBER_ONLY");
    const copy = await createBookCopy(fixture.libraryId);
    await withCover(copy.id);
    expect((await fetchCover(`${await coverIdOf(copy.id)}.webp`)).status).toBe(404);
  });

  it("never serves anything that is not a book cover", async () => {
    await setCatalogue("PUBLIC");
    const key = "photos/child.jpg";
    await storage.put(key, new Uint8Array([1, 2, 3]), "image/jpeg", "PRIVATE");
    const photo = await db.mediaObject.create({
      data: {
        libraryId: fixture.libraryId,
        storageKey: key,
        mimeType: "image/jpeg",
        byteSize: 3,
        checksumSha256: "1".repeat(64),
        purpose: UPLOAD_PURPOSES.CHILD_PHOTO,
      },
    });
    expect((await fetchCover(`${photo.id}.webp`)).status).toBe(404);
    expect((await fetchCover("not-an-id.webp")).status).toBe(404);
  });
});
