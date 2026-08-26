import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import {
  announceReturn,
  issueBook,
  listOwnLoans,
  returnBook,
  withdrawReturnAnnouncement,
} from "@/server/services/circulation-service";
import { RETURN_ANNOUNCEMENT_MESSAGES } from "@/lib/circulation";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * A reader telling the library a book is coming back.
 *
 * The load-bearing property under test is a negative one: **announcing must not
 * return the book.** The copy stays BORROWED, the loan stays ACTIVE, the due
 * date does not move, and nothing a child can press puts a book back on the
 * shelf. Everything else here is about that boundary holding.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
});

afterAll(async () => {
  await db.$disconnect();
});

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "MEMBER") {
  __setSessionHandle(await createSession(userId, kind));
}

/**
 * A book in a child's hands, issued the way the desk issues one.
 *
 * Not hand-written rows. A database invariant enforces "on loan implies
 * BORROWED" in *both* directions, so neither half can be inserted on its own —
 * which is exactly the guarantee this feature leans on, and a good reason to go
 * through the real service rather than around it.
 */
async function issueTo(memberId: string, overdueDays = 0) {
  const copy = await createBookCopy(fixture.libraryId);

  await actingAs(librarian.id, "STAFF");
  await issueBook({ memberUserId: memberId, copyId: copy.id });

  const loan = await db.loan.findFirstOrThrow({
    where: { copyId: copy.id, status: "ACTIVE" },
  });

  if (overdueDays > 0) {
    /*
     * Backdating is the only way to get a late book without waiting a
     * fortnight — and BOTH dates have to move: a check constraint requires the
     * due date to follow the issue date, so a loan due last week must have been
     * issued before that. Which is also true of every real overdue book.
     */
    await db.loan.update({
      where: { id: loan.id },
      data: {
        issuedAt: new Date(Date.now() - (overdueDays + 14) * 86_400_000),
        dueAt: new Date(Date.now() - overdueDays * 86_400_000),
      },
    });
  }

  return { copy, loan: await db.loan.findUniqueOrThrow({ where: { id: loan.id } }) };
}

describe("a reader announces a return", () => {
  it("records the notice without touching the loan or the copy", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy, loan } = await issueTo(reader.id);

    await actingAs(reader.id);
    await announceReturn({ code: copy.copyCode });

    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
    const copyAfter = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });

    expect(after.returnAnnouncedAt).not.toBeNull();
    expect(after.returnAnnouncedById).toBe(reader.id);

    // The whole point. None of this may move.
    expect(after.status).toBe("ACTIVE");
    expect(after.returnedAt).toBeNull();
    expect(after.returnedById).toBeNull();
    expect(after.dueAt.toISOString()).toBe(loan.dueAt.toISOString());
    expect(copyAfter.status).toBe("BORROWED");
  });

  it("is idempotent — saying it twice keeps the first time", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy, loan } = await issueTo(reader.id);

    await actingAs(reader.id);
    await announceReturn({ code: copy.copyCode });
    const first = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });

    await announceReturn({ code: copy.copyCode });
    const second = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });

    expect(second.returnAnnouncedAt?.toISOString()).toBe(first.returnAnnouncedAt?.toISOString());
  });

  it("refuses another child's book, in the same words as a book that does not exist", async () => {
    const reader = await createMember(fixture.libraryId);
    const other = await createMember(fixture.libraryId);
    const { copy } = await issueTo(other.id);

    await actingAs(reader.id);

    await expect(announceReturn({ code: copy.copyCode })).rejects.toThrow();
    await expect(announceReturn({ code: "NO-SUCH-CODE" })).rejects.toThrow();

    // Both refusals must read the same, so probing codes tells a child nothing.
    const notMine = await announceReturn({ code: copy.copyCode }).catch((e) => e);
    const nonsense = await announceReturn({ code: "NO-SUCH-CODE" }).catch((e) => e);
    expect(notMine.friendlyMessage ?? notMine.message).toBe(
      nonsense.friendlyMessage ?? nonsense.message,
    );
    expect(RETURN_ANNOUNCEMENT_MESSAGES.notYours).toBeTruthy();
  });

  it("is offered on an overdue book too", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy } = await issueTo(reader.id, 5);

    await actingAs(reader.id);

    // Bringing a book back is the one thing a late reader can always do.
    await expect(announceReturn({ code: copy.copyCode })).resolves.toBeTruthy();
    const shelf = await listOwnLoans();
    expect(shelf?.active[0]?.returnAnnouncedAt).not.toBeNull();
  });

  it("writes an audit row naming the reader as the actor", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy, loan } = await issueTo(reader.id);

    await actingAs(reader.id);
    await announceReturn({ code: copy.copyCode });

    const audit = await db.auditLog.findFirst({
      where: { action: "loan.return_announced", entityId: loan.id },
    });
    expect(audit?.actorUserId).toBe(reader.id);
  });
});

describe("a reader changes their mind", () => {
  it("clears the notice and leaves the loan exactly as it was", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy, loan } = await issueTo(reader.id);

    await actingAs(reader.id);

    await announceReturn({ code: copy.copyCode });
    await withdrawReturnAnnouncement({ code: copy.copyCode });

    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.returnAnnouncedAt).toBeNull();
    expect(after.returnAnnouncedById).toBeNull();
    expect(after.status).toBe("ACTIVE");
    expect(after.dueAt.toISOString()).toBe(loan.dueAt.toISOString());
  });

  it("refuses when there is nothing to withdraw", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy } = await issueTo(reader.id);

    await actingAs(reader.id);
    await expect(withdrawReturnAnnouncement({ code: copy.copyCode })).rejects.toThrow();
  });
});

describe("the desk still does the returning", () => {
  it("a reader cannot reach returnBook at all", async () => {
    const reader = await createMember(fixture.libraryId);
    const { loan } = await issueTo(reader.id);

    await actingAs(reader.id);

    // The permission gate, not the UI, is what stops this.
    await expect(returnBook({ loanId: loan.id })).rejects.toThrow();

    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.status).toBe("ACTIVE");
  });

  it("a librarian returning an announced book closes the loan normally", async () => {
    const reader = await createMember(fixture.libraryId);
    const { copy, loan } = await issueTo(reader.id);

    await actingAs(reader.id);
    await announceReturn({ code: copy.copyCode });

    await actingAs(librarian.id, "STAFF");
    await returnBook({ loanId: loan.id });

    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
    const copyAfter = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });

    expect(after.status).toBe("RETURNED");
    expect(after.returnedById).toBe(librarian.id);
    expect(copyAfter.status).toBe("AVAILABLE");
    // The notice stays: it is a record of what the reader said, and the loan is
    // history now.
    expect(after.returnAnnouncedAt).not.toBeNull();
  });
});
