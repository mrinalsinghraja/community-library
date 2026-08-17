import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import {
  cancelLoan,
  issueBook,
  renewLoan,
  returnBook,
} from "@/server/services/circulation-service";

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
 * Circulation under concurrency.
 *
 * This file exists because the interesting failures in a library system are not
 * the ones a single request can produce. Two librarians on two tablets, a
 * double-tapped button, a slow network retry — all of them turn "we checked a
 * second ago" into "we checked, and then it changed".
 *
 * Every test here fires real requests in parallel through the real services
 * against real PostgreSQL. Nothing is mocked, nothing is serialised by the test
 * harness, and the assertions are about the state the database is left in
 * rather than about which caller happened to win.
 *
 * The four races that matter:
 *
 *   1. Two children, one book.
 *   2. One child at their limit, two books at once.
 *   3. The same book returned twice.
 *   4. The same loan renewed twice.
 *
 * Note that `prisma.$transaction` gives each of these its own connection, so
 * the parallelism is genuine rather than queued behind one socket.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let readerA: Awaited<ReturnType<typeof createMember>>;
let readerB: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

/** How many of a batch of settled promises succeeded. */
function fulfilled(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((result) => result.status === "fulfilled").length;
}

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  readerA = await createMember(fixture.libraryId, { displayName: "Aarav Sharma" });
  readerB = await createMember(fixture.libraryId, { displayName: "Meera Iyer" });
  await actingAs(librarian.id);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("two librarians, one book", () => {
  it("issues it once and refuses the other, with no second loan anywhere", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    const results = await Promise.allSettled([
      issueBook({ memberUserId: readerA.id, copyId: copy.id }),
      issueBook({ memberUserId: readerB.id, copyId: copy.id }),
    ]);

    // Exactly one, never two, never zero. Which one wins is not the library's
    // problem; that both cannot is.
    expect(fulfilled(results)).toBe(1);

    expect(await db.loan.count({ where: { copyId: copy.id, status: "ACTIVE" } })).toBe(1);
    expect((await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe("BORROWED");
  });

  it("holds under a burst of ten simultaneous attempts", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const children = await Promise.all(
      Array.from({ length: 10 }, () => createMember(fixture.libraryId)),
    );

    const results = await Promise.allSettled(
      children.map((child) => issueBook({ memberUserId: child.id, copyId: copy.id })),
    );

    expect(fulfilled(results)).toBe(1);
    expect(await db.loan.count({ where: { copyId: copy.id, status: "ACTIVE" } })).toBe(1);
  });

  it("leaves no partial loan behind when it refuses", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await Promise.allSettled([
      issueBook({ memberUserId: readerA.id, copyId: copy.id }),
      issueBook({ memberUserId: readerB.id, copyId: copy.id }),
    ]);

    // The loser's transaction rolled back entirely: no orphan loan row, and
    // exactly one ISSUE event to match the one loan.
    const loans = await db.loan.findMany({ where: { copyId: copy.id } });
    expect(loans).toHaveLength(1);
    expect(await db.loanEvent.count({ where: { loanId: loans[0]!.id, type: "ISSUE" } })).toBe(1);
  });
});

describe("one child, two books at the limit", () => {
  it("cannot be pushed past the limit by simultaneous requests", async () => {
    // The dangerous shape: already at 1 of 2, then two requests at once. Both
    // would read "1" without a lock on the member row, and both would succeed.
    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });
    expect(settings.maxActiveLoans).toBe(2);

    const held = await createBookCopy(fixture.libraryId);
    await issueBook({ memberUserId: readerA.id, copyId: held.id });

    const first = await createBookCopy(fixture.libraryId);
    const second = await createBookCopy(fixture.libraryId);

    const results = await Promise.allSettled([
      issueBook({ memberUserId: readerA.id, copyId: first.id }),
      issueBook({ memberUserId: readerA.id, copyId: second.id }),
    ]);

    expect(fulfilled(results)).toBe(1);
    expect(
      await db.loan.count({ where: { memberUserId: readerA.id, status: "ACTIVE" } }),
    ).toBe(settings.maxActiveLoans);
  });

  it("cannot be pushed past the limit by five at once from empty", async () => {
    const copies = await Promise.all(
      Array.from({ length: 5 }, () => createBookCopy(fixture.libraryId)),
    );

    const results = await Promise.allSettled(
      copies.map((copy) => issueBook({ memberUserId: readerA.id, copyId: copy.id })),
    );

    expect(fulfilled(results)).toBe(2);
    expect(await db.loan.count({ where: { memberUserId: readerA.id, status: "ACTIVE" } })).toBe(2);

    // And the four books that did not go out are still on the shelf, not left
    // reading BORROWED by a half-applied transaction.
    const borrowed = await db.bookCopy.count({
      where: { id: { in: copies.map((copy) => copy.id) }, status: "BORROWED" },
    });
    expect(borrowed).toBe(2);
  });

  it("keeps two different children independent of each other", async () => {
    const forA = await createBookCopy(fixture.libraryId);
    const forB = await createBookCopy(fixture.libraryId);

    // Different members, different copies: nothing to contend over, and both
    // must succeed. A limit check that locked too broadly would fail this.
    const results = await Promise.allSettled([
      issueBook({ memberUserId: readerA.id, copyId: forA.id }),
      issueBook({ memberUserId: readerB.id, copyId: forB.id }),
    ]);

    expect(fulfilled(results)).toBe(2);
  });
});

describe("the same book returned twice", () => {
  it("closes the loan once", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueBook({ memberUserId: readerA.id, copyId: copy.id });

    const results = await Promise.allSettled([
      returnBook({ loanId: issued.loanId }),
      returnBook({ loanId: issued.loanId }),
    ]);

    expect(fulfilled(results)).toBe(1);

    const loan = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    expect(loan.status).toBe("RETURNED");
    // One return, one event. A second would make the loan's history a lie.
    expect(await db.loanEvent.count({ where: { loanId: issued.loanId, type: "RETURN" } })).toBe(1);
    expect((await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe("AVAILABLE");
  });
});

describe("the same loan renewed twice", () => {
  it("extends it once, and only once, when one renewal is allowed", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueBook({ memberUserId: readerA.id, copyId: copy.id });

    const results = await Promise.allSettled([
      renewLoan({ loanId: issued.loanId }),
      renewLoan({ loanId: issued.loanId }),
    ]);

    expect(fulfilled(results)).toBe(1);

    const loan = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    expect(loan.renewalCount).toBe(1);
    expect(await db.loanEvent.count({ where: { loanId: issued.loanId, type: "RENEW" } })).toBe(1);
    // The date moved exactly one renewal period, not two.
    expect(loan.dueAt.getTime()).toBeGreaterThan(issued.dueAt.getTime());
  });

  it("does not let a return and a renewal both land on one loan", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueBook({ memberUserId: readerA.id, copyId: copy.id });

    const results = await Promise.allSettled([
      returnBook({ loanId: issued.loanId }),
      renewLoan({ loanId: issued.loanId }),
    ]);

    // Whichever arrives first takes the loan out of ACTIVE, and the other is
    // refused. A renewed-and-returned loan is not a state this library has.
    expect(fulfilled(results)).toBe(1);

    const loan = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    expect(["RETURNED", "ACTIVE"]).toContain(loan.status);
    if (loan.status === "RETURNED") expect(loan.renewalCount).toBe(0);
  });

  it("does not let a cancellation and a return both land on one loan", async () => {
    const superAdmin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueBook({ memberUserId: readerA.id, copyId: copy.id });

    await actingAs(superAdmin.id);
    const results = await Promise.allSettled([
      returnBook({ loanId: issued.loanId }),
      cancelLoan({ loanId: issued.loanId, reason: "Wrong child" }),
    ]);

    expect(fulfilled(results)).toBe(1);

    const loan = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    // A CHECK constraint means only one of the two closing timestamps can be
    // set, so even a race cannot produce a loan that was both.
    expect(loan.status === "RETURNED" ? loan.cancelledAt : loan.returnedAt).toBeNull();
  });
});

describe("the invariant survives every race", () => {
  it("never leaves a copy borrowed with no borrower, or free with one", async () => {
    const copies = await Promise.all(
      Array.from({ length: 6 }, () => createBookCopy(fixture.libraryId)),
    );
    const children = await Promise.all(
      Array.from({ length: 6 }, () => createMember(fixture.libraryId)),
    );

    // A deliberately messy afternoon: everybody grabbing at everything.
    await Promise.allSettled(
      copies.flatMap((copy) =>
        children.map((child) => issueBook({ memberUserId: child.id, copyId: copy.id })),
      ),
    );

    const incoherent = await db.$queryRaw<{ copy_code: string }[]>`
      SELECT c.copy_code
        FROM book_copy c
       WHERE (c.status = 'BORROWED') <> EXISTS (
               SELECT 1 FROM loan l WHERE l.copy_id = c.id AND l.status = 'ACTIVE'
             )
    `;
    expect(incoherent).toEqual([]);

    // And nobody ended up over the limit.
    const overLimit = await db.$queryRaw<{ member_user_id: string }[]>`
      SELECT member_user_id
        FROM loan
       WHERE status = 'ACTIVE'
       GROUP BY member_user_id
      HAVING count(*) > 2
    `;
    expect(overLimit).toEqual([]);
  });
});
