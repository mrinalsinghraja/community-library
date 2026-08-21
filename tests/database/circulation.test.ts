import type { UserStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { DEFAULT_TIMEZONE, daysUntilDue } from "@/lib/dates";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { archiveBook, updateBook, type BookInput } from "@/server/services/catalogue-service";
import {
  cancelLoan,
  countDeskLoans,
  getIssuePreview,
  getLoanForStaff,
  issueBook,
  listLoansForStaff,
  listOwnLoans,
  renewLoan,
  returnBook,
  searchCopies,
  searchReaders,
} from "@/server/services/circulation-service";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  defaultCategory,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Circulation, against a real PostgreSQL.
 *
 * Everything here goes through the services, never through `db` directly for
 * the thing under test — because the rules live in the services and in the
 * database, and a test that inserted a loan row by hand would be testing
 * neither.
 *
 * Five properties are under test throughout:
 *
 *   1. A book that should not go out does not go out, whatever the caller
 *      sends. The desk's disabled buttons are a convenience; these are the
 *      rules.
 *   2. A copy reads BORROWED if and only if it has an active loan — and the
 *      database refuses to commit anything else.
 *   3. Overdue is derived. Moving a due date into the past is enough to make a
 *      loan overdue everywhere, with no job having run.
 *   4. A child sees their own books and cannot reach another child's, and
 *      nothing anywhere names a borrower to a reader.
 *   5. Nothing is rewritten. Returning, renewing and re-borrowing all append.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;
let otherReader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

/** A copy with a title and author worth searching for. */
async function namedCopy(title: string, author = "Rudyard Kipling") {
  const category = await defaultCategory(fixture.libraryId);
  const bookTitle = await db.bookTitle.create({
    data: {
      libraryId: fixture.libraryId,
      title,
      authors: [author],
      ageGroup: "AGE_8_10",
      categoryId: category.id,
    },
  });
  const code = `TST-B9${String(Math.floor(Math.random() * 900) + 100)}`;
  return db.bookCopy.create({
    data: { libraryId: fixture.libraryId, titleId: bookTitle.id, copyCode: code },
  });
}

/**
 * Backdates a loan so it is overdue. The only way to make one overdue, because
 * there is nothing to set: overdue is derived from the date.
 *
 * Both dates move. `due_at > issued_at` is a CHECK constraint, so a loan cannot
 * be dragged into the past by its due date alone — which is the database
 * refusing to hold a loan that came back before it went out.
 */
async function makeOverdue(loanId: string, daysAgo = 3) {
  const day = 24 * 60 * 60 * 1000;
  await db.loan.update({
    where: { id: loanId },
    data: {
      issuedAt: new Date(Date.now() - (daysAgo + 14) * day),
      dueAt: new Date(Date.now() - daysAgo * day),
    },
  });
}

async function issueTo(memberUserId: string, copyId: string) {
  await actingAs(librarian.id);
  return issueBook({ memberUserId, copyId });
}

/**
 * A second community, for tenancy tests.
 *
 * Built by hand rather than by calling `createLibraryFixture` twice: that
 * helper also seeds the permission catalogue, which is global and would collide
 * on its primary key. All this needs is a library with the MEMBER role, which
 * is what `createMember` reaches for.
 */
async function secondLibrary(): Promise<string> {
  const community = await db.community.create({
    data: { name: "Other Community", slug: "other-community", city: "Elsewhere" },
  });
  const library = await db.library.create({
    data: {
      communityId: community.id,
      name: "Other Children's Library",
      slug: "other-childrens-library",
      settings: { create: { copyCodePrefix: "OTH-B", memberCodePrefix: "OTH-R" } },
    },
  });
  const role = await db.role.create({
    data: { libraryId: library.id, key: "MEMBER", name: "Reader", sortOrder: 40 },
  });
  await db.rolePermission.create({ data: { roleId: role.id, permissionKey: "book.view" } });
  return library.id;
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  superAdmin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  reader = await createMember(fixture.libraryId, { displayName: "Aarav Sharma" });
  otherReader = await createMember(fixture.libraryId, { displayName: "Meera Iyer" });
});

afterAll(async () => {
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

describe("issuing a book", () => {
  it("gives one physical copy to one child, with a due date the settings decide", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });

    const issued = await issueTo(reader.id, copy.id);

    expect(issued.copyCode).toBe(copy.copyCode);
    expect(issued.readerName).toBe("Aarav Sharma");

    /*
     * 14 days, from library_settings — not a literal anywhere in src/.
     *
     * Counted in **calendar days in the library's timezone**, which is the only
     * count that matches what a due date means. This assertion used to divide
     * milliseconds and round: a due date is the *end* of its day, so the span
     * is 14 days plus whatever is left of today, and the rounding flipped to 15
     * whenever the suite ran before noon in Asia/Kolkata. The library was
     * always right; the arithmetic in the test was not.
     */
    const days = daysUntilDue(issued.dueAt, DEFAULT_TIMEZONE);
    expect(days).toBe(settings.borrowingPeriodDays);

    const loan = await db.loan.findFirstOrThrow({ where: { copyId: copy.id } });
    expect(loan.status).toBe("ACTIVE");
    expect(loan.renewalCount).toBe(0);
    expect(loan.returnedAt).toBeNull();
    expect(loan.issuedById).toBe(librarian.id);
  });

  it("marks the copy BORROWED in the same transaction", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);

    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(after.status).toBe("BORROWED");
  });

  it("records an ISSUE event and an audit row", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    const events = await db.loanEvent.findMany({ where: { loanId: issued.loanId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("ISSUE");
    expect(events[0]?.actorUserId).toBe(librarian.id);

    const audit = await db.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.LOAN_ISSUED, entityId: issued.loanId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorUserId).toBe(librarian.id);
  });

  it("refuses a book that is already out", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);

    await expect(issueTo(otherReader.id, copy.id)).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("already out"),
    });

    expect(await db.loan.count({ where: { copyId: copy.id } })).toBe(1);
  });

  it("refuses a lost book, and does not quietly find it", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({ where: { id: copy.id }, data: { status: "LOST" } });

    await expect(issueTo(reader.id, copy.id)).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("missing"),
    });

    // Still lost. Attempting to issue a lost book is not how it is recovered.
    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(after.status).toBe("LOST");
  });

  it("refuses a damaged book", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({ where: { id: copy.id }, data: { condition: "DAMAGED" } });

    await expect(issueTo(reader.id, copy.id)).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("damaged"),
    });
  });

  it("lets a mended book go out once its condition is changed back", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({ where: { id: copy.id }, data: { condition: "DAMAGED" } });
    await expect(issueTo(reader.id, copy.id)).rejects.toThrow();

    // The escape hatch is a librarian looking at the object, not a flag.
    await db.bookCopy.update({ where: { id: copy.id }, data: { condition: "FAIR" } });
    await expect(issueTo(reader.id, copy.id)).resolves.toBeTruthy();
  });

  it("refuses an archived book", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({
      where: { id: copy.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    await expect(issueTo(reader.id, copy.id)).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("no longer part of the library"),
    });
  });

  it("refuses a suspended reader, without saying why they are suspended", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.appUser.update({
      where: { id: reader.id },
      data: { status: "SUSPENDED", statusReason: "Kept losing books" },
    });

    const error = await issueTo(reader.id, copy.id).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      friendlyMessage: "This library account is currently unavailable for borrowing.",
    });
    // The internal reason is the library's business, not the desk screen's.
    expect(JSON.stringify(error)).not.toContain("Kept losing books");
  });

  /**
   * Every account state, not a convenient subset.
   *
   * ACTIVE is the only one that may borrow, and the rule is written as an
   * allowlist so that a state added to the enum later cannot quietly inherit
   * the right to take books home. This table is the proof, and it is also the
   * thing that would fail loudly if someone widened the list.
   */
  const ELIGIBILITY: readonly { status: UserStatus; mayBorrow: boolean }[] = [
    // Set up but not finished: the guardian has not completed activation, so
    // nobody has yet confirmed this child is enrolled on the agreed terms.
    { status: "INVITED", mayBorrow: false },
    { status: "ACTIVE", mayBorrow: true },
    { status: "SUSPENDED", mayBorrow: false },
    { status: "DEACTIVATED", mayBorrow: false },
    { status: "ARCHIVED", mayBorrow: false },
  ];

  for (const { status, mayBorrow } of ELIGIBILITY) {
    it(`${mayBorrow ? "lends to" : "refuses"} a reader whose account is ${status}`, async () => {
      const copy = await createBookCopy(fixture.libraryId);
      await db.appUser.update({ where: { id: reader.id }, data: { status } });

      if (mayBorrow) {
        const loan = await issueTo(reader.id, copy.id);
        expect(loan.loanId).toBeTruthy();
        return;
      }

      await expect(issueTo(reader.id, copy.id)).rejects.toMatchObject({
        code: "RULE_VIOLATION",
        // One sentence for every refused state. A desk that said "this account
        // is only invited" would be narrating a family's paperwork to whoever
        // is standing at the counter.
        friendlyMessage: "This library account is currently unavailable for borrowing.",
      });

      // Server-side, so no loan exists whatever the screen believed.
      expect(await db.loan.count({ where: { memberUserId: reader.id } })).toBe(0);
      const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
      expect(after.status).toBe("AVAILABLE");
    });
  }

  for (const { status, mayBorrow } of ELIGIBILITY) {
    it(`${mayBorrow ? "allows" : "blocks"} renewal for a reader whose account is ${status}`, async () => {
      const copy = await createBookCopy(fixture.libraryId);
      // Issue while ACTIVE — the account state can change while a book is out.
      const loan = await issueTo(reader.id, copy.id);
      await db.appUser.update({ where: { id: reader.id }, data: { status } });

      await actingAs(librarian.id);
      if (mayBorrow) {
        await expect(renewLoan({ loanId: loan.loanId })).resolves.toBeTruthy();
        return;
      }

      await expect(renewLoan({ loanId: loan.loanId })).rejects.toMatchObject({
        friendlyMessage: "This library account is currently unavailable for borrowing.",
      });

      const unchanged = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
      expect(unchanged.renewalCount).toBe(0);
      expect(unchanged.dueAt.toISOString()).toBe(loan.dueAt.toISOString());
    });
  }

  it("does not offer an ineligible reader at the desk", async () => {
    await db.appUser.update({ where: { id: reader.id }, data: { status: "INVITED" } });
    await actingAs(librarian.id);

    const results = await searchReaders("Aarav");
    const found = results.find((row) => row.memberUserId === reader.id);

    // The desk still finds them — a librarian must be able to look someone up.
    // It just does not pretend they can borrow.
    expect(found?.canBorrow).toBe(false);
  });

  it("stops at the configured loan limit, with a message naming the number", async () => {
    const first = await createBookCopy(fixture.libraryId);
    const second = await createBookCopy(fixture.libraryId);
    const third = await createBookCopy(fixture.libraryId);

    await issueTo(reader.id, first.id);
    await issueTo(reader.id, second.id);

    await expect(issueTo(reader.id, third.id)).rejects.toMatchObject({
      friendlyMessage: "Aarav Sharma already has 2 books borrowed. Please return one before borrowing another.",
    });

    expect(await db.loan.count({ where: { memberUserId: reader.id, status: "ACTIVE" } })).toBe(2);
  });

  it("reads the loan limit from settings rather than a constant", async () => {
    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { maxActiveLoans: 1 },
    });

    const first = await createBookCopy(fixture.libraryId);
    const second = await createBookCopy(fixture.libraryId);

    await issueTo(reader.id, first.id);
    await expect(issueTo(reader.id, second.id)).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("already has a book borrowed"),
    });
  });

  it("writes an audit row when it refuses, so a refusal leaves a trace", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({ where: { id: copy.id }, data: { status: "LOST" } });

    await expect(issueTo(reader.id, copy.id)).rejects.toThrow();

    const refusal = await db.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.LOAN_ISSUE_REFUSED, entityId: copy.id },
    });
    expect(refusal).toBeTruthy();
  });

  it("refuses a member from another library", async () => {
    const stranger = await createMember(await secondLibrary());
    const copy = await createBookCopy(fixture.libraryId);

    // NotFound, not NotAuthorized: the answer must not confirm the id exists.
    await expect(issueTo(stranger.id, copy.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps two copies of the same title independent", async () => {
    const category = await defaultCategory(fixture.libraryId);
    const title = await db.bookTitle.create({
      data: {
        libraryId: fixture.libraryId,
        title: "The Jungle Book",
        authors: ["Rudyard Kipling"],
        ageGroup: "AGE_8_10",
        categoryId: category.id,
      },
    });
    const first = await db.bookCopy.create({
      data: { libraryId: fixture.libraryId, titleId: title.id, copyCode: "TST-B7001" },
    });
    const second = await db.bookCopy.create({
      data: { libraryId: fixture.libraryId, titleId: title.id, copyCode: "TST-B7002" },
    });

    await issueTo(reader.id, first.id);

    // Borrowing one copy says nothing about the other. A loan belongs to the
    // object on the shelf, never to the title.
    expect((await db.bookCopy.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("BORROWED");
    expect((await db.bookCopy.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("AVAILABLE");
    await expect(issueTo(otherReader.id, second.id)).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The database's own guarantee
// ---------------------------------------------------------------------------

describe("the source of truth", () => {
  it("refuses a copy marked BORROWED with no active loan", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await expect(
      db.bookCopy.update({ where: { id: copy.id }, data: { status: "BORROWED" } }),
    ).rejects.toThrow(/must have a borrower/);
  });

  it("refuses a copy taken off BORROWED while a loan is still active", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);

    await expect(
      db.bookCopy.update({ where: { id: copy.id }, data: { status: "AVAILABLE" } }),
    ).rejects.toThrow(/must read BORROWED/);
  });

  it("refuses a second active loan on the same copy, at the index", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);

    // Straight past every service check, at the database itself.
    await expect(
      db.loan.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          memberUserId: otherReader.id,
          dueAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow();

    expect(await db.loan.count({ where: { copyId: copy.id, status: "ACTIVE" } })).toBe(1);
  });

  it("refuses a RENEW event that does not carry both dates", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await expect(
      db.loanEvent.create({ data: { loanId: issued.loanId, type: "RENEW" } }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

describe("returning a book", () => {
  it("closes the loan, puts the copy back and keeps the dates", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await returnBook({ loanId: issued.loanId });

    const loan = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    expect(loan.status).toBe("RETURNED");
    expect(loan.returnedAt).toBeTruthy();
    expect(loan.returnedById).toBe(librarian.id);
    // Untouched. The return is an event, not an edit.
    expect(loan.dueAt.getTime()).toBe(issued.dueAt.getTime());

    expect((await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe("AVAILABLE");
  });

  it("refuses to return the same book twice", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await returnBook({ loanId: issued.loanId });

    await expect(returnBook({ loanId: issued.loanId })).rejects.toMatchObject({
      friendlyMessage: "That book has already been brought back.",
    });
  });

  it("refuses a loan that does not exist", async () => {
    await actingAs(librarian.id);
    await expect(returnBook({ loanId: "01912345-0000-7000-8000-000000000000" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("never silently resets a condition to Good", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({ where: { id: copy.id }, data: { condition: "FAIR" } });
    const issued = await issueTo(reader.id, copy.id);

    await returnBook({ loanId: issued.loanId });

    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(after.condition).toBe("FAIR");
    expect(after.status).toBe("AVAILABLE");
  });

  it("keeps a book that came back damaged off the shelf", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await returnBook({ loanId: issued.loanId, condition: "DAMAGED" });

    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(after.condition).toBe("DAMAGED");
    // DAMAGED, not AVAILABLE: the next child is not handed something falling
    // apart just because the loan closed.
    expect(after.status).toBe("DAMAGED");

    const events = await db.loanEvent.findMany({ where: { loanId: issued.loanId } });
    expect(events.map((event) => event.type).sort()).toEqual(["ISSUE", "MARK_DAMAGED", "RETURN"]);
  });

  it("lets the same copy go out again as a NEW loan", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const first = await issueTo(reader.id, copy.id);
    await returnBook({ loanId: first.loanId });

    const second = await issueTo(otherReader.id, copy.id);

    expect(second.loanId).not.toBe(first.loanId);
    const loans = await db.loan.findMany({ where: { copyId: copy.id }, orderBy: { issuedAt: "asc" } });
    expect(loans).toHaveLength(2);
    expect(loans[0]?.status).toBe("RETURNED");
    expect(loans[0]?.memberUserId).toBe(reader.id);
    expect(loans[1]?.status).toBe("ACTIVE");
    expect(loans[1]?.memberUserId).toBe(otherReader.id);
  });
});

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

describe("renewing a loan", () => {
  it("extends from the current due date, not from today", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });

    const { dueAt } = await renewLoan({ loanId: issued.loanId });

    // Calendar days in the library's timezone, for the same reason as above.
    const added = daysUntilDue(dueAt, DEFAULT_TIMEZONE, issued.dueAt);
    expect(added).toBe(settings.renewalPeriodDays);
  });

  it("keeps the original issue date and records the old due date in history", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    const before = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });

    await renewLoan({ loanId: issued.loanId });

    const after = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    expect(after.issuedAt.getTime()).toBe(before.issuedAt.getTime());
    expect(after.renewalCount).toBe(1);

    const renewal = await db.loanEvent.findFirstOrThrow({
      where: { loanId: issued.loanId, type: "RENEW" },
    });
    // The original due date is not lost; it moved into the event.
    expect(renewal.previousDueAt?.getTime()).toBe(before.dueAt.getTime());
    expect(renewal.newDueAt?.getTime()).toBe(after.dueAt.getTime());
  });

  it("stops at the configured maximum", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await renewLoan({ loanId: issued.loanId });
    await expect(renewLoan({ loanId: issued.loanId })).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("already been kept for longer once"),
    });

    expect((await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } })).renewalCount).toBe(1);
  });

  it("refuses an overdue loan by default", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await makeOverdue(issued.loanId);

    await expect(renewLoan({ loanId: issued.loanId })).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("past its date"),
    });
  });

  it("allows an overdue renewal when the library configures it", async () => {
    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { allowRenewalWhenOverdue: true },
    });

    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await makeOverdue(issued.loanId);

    await expect(renewLoan({ loanId: issued.loanId })).resolves.toBeTruthy();
  });

  it("refuses to renew a returned loan", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await returnBook({ loanId: issued.loanId });

    await expect(renewLoan({ loanId: issued.loanId })).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses to renew for a suspended reader", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    await expect(renewLoan({ loanId: issued.loanId })).rejects.toMatchObject({
      friendlyMessage: "This library account is currently unavailable for borrowing.",
    });
  });
});

// ---------------------------------------------------------------------------
// Cancellation — the correction mechanism
// ---------------------------------------------------------------------------

describe("cancelling a mis-issue", () => {
  it("keeps the loan, frees the book and records the reason", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await actingAs(superAdmin.id);
    await cancelLoan({ loanId: issued.loanId, reason: "Handed to the wrong child" });

    const loan = await db.loan.findUniqueOrThrow({ where: { id: issued.loanId } });
    // Not deleted. The library's account of what happened stays.
    expect(loan.status).toBe("CANCELLED");
    expect(loan.cancelledAt).toBeTruthy();
    expect(loan.cancelledById).toBe(superAdmin.id);
    expect(loan.issuedAt).toBeTruthy();

    expect((await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe("AVAILABLE");

    const event = await db.loanEvent.findFirstOrThrow({
      where: { loanId: issued.loanId, type: "CANCEL" },
    });
    expect(event.note).toBe("Handed to the wrong child");

    const audit = await db.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.LOAN_CANCELLED, entityId: issued.loanId },
    });
    expect(audit).toBeTruthy();
  });

  it("requires a reason", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await actingAs(superAdmin.id);
    await expect(cancelLoan({ loanId: issued.loanId, reason: "  " })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("frees the copy for the next child", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await actingAs(superAdmin.id);
    await cancelLoan({ loanId: issued.loanId, reason: "Wrong book" });

    await expect(issueTo(otherReader.id, copy.id)).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Overdue, derived
// ---------------------------------------------------------------------------

describe("overdue", () => {
  it("is not a column anywhere", async () => {
    const columns = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND lower(column_name) LIKE '%overdue%'
    `;
    /*
     * Every match is configuration — a policy number or a reminder schedule.
     * None of them is loan state. If this list ever grows a column on `loan` or
     * `book_copy`, somebody has stored a derived fact that a missed job can
     * leave wrong, and this test is where they find out.
     */
    expect(columns.map((column) => column.column_name).sort()).toEqual([
      "allow_renewal_when_overdue",
      "block_on_overdue_days",
      "overdue_reminder_offsets",
      "overdue_reminders_enabled",
    ]);

    const onLoanTables = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('loan', 'loan_event', 'book_copy')
         AND lower(column_name) LIKE '%overdue%'
    `;
    expect(onLoanTables).toEqual([]);
  });

  it("is not a loan status", async () => {
    const values = await db.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::"LoanStatus"))::text AS value
    `;
    expect(values.map((row) => row.value)).toEqual(["ACTIVE", "RETURNED", "CANCELLED"]);
  });

  it("appears in the desk's filter as soon as the date passes", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    expect((await listLoansForStaff({ filter: "overdue" })).total).toBe(0);

    // No job runs. The date moves, and the answer changes.
    await makeOverdue(issued.loanId);

    const overdue = await listLoansForStaff({ filter: "overdue" });
    expect(overdue.total).toBe(1);
    expect(overdue.items[0]?.copyCode).toBe(copy.copyCode);

    const counts = await countDeskLoans();
    expect(counts).toEqual({ active: 1, overdue: 1 });
  });

  it("stops being overdue the moment the book comes back", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await makeOverdue(issued.loanId);

    await returnBook({ loanId: issued.loanId });

    // A returned book is never *currently* overdue, however late it was.
    expect((await listLoansForStaff({ filter: "overdue" })).total).toBe(0);
    expect(await countDeskLoans()).toEqual({ active: 0, overdue: 0 });
  });
});

// ---------------------------------------------------------------------------
// The child's own view, and everybody else's
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("shows a child their own books", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnLoans();

    expect(mine?.active).toHaveLength(1);
    expect(mine?.active[0]?.code).toBe(copy.copyCode);
    expect(mine?.limit).toBe(2);
  });

  it("shows a child nothing of another child's books", async () => {
    const theirs = await createBookCopy(fixture.libraryId);
    await issueTo(otherReader.id, theirs.id);

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnLoans();

    // There is no id to pass and therefore nothing to tamper with. The only
    // possible answer is their own, and their own is empty.
    expect(mine?.active).toEqual([]);
    expect(mine?.history).toEqual([]);
  });

  it("returns no borrower field to a reader, for any book", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(otherReader.id, copy.id);

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnLoans();

    // Nothing in a reader-facing shape carries a name, an id or a due date
    // belonging to somebody else.
    expect(JSON.stringify(mine)).not.toContain("Meera");
    expect(JSON.stringify(mine)).not.toContain(otherReader.id);
  });

  it("keeps a cancelled loan out of a child's history", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await actingAs(superAdmin.id);
    await cancelLoan({ loanId: issued.loanId, reason: "Wrong child" });

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnLoans();
    expect(mine?.active).toEqual([]);
    expect(mine?.history).toEqual([]);
  });

  it("keeps a child's history after the book comes back", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await returnBook({ loanId: issued.loanId });

    await actingAs(reader.id, "MEMBER");
    const mine = await listOwnLoans();
    expect(mine?.active).toEqual([]);
    expect(mine?.history).toHaveLength(1);
    expect(mine?.history[0]?.returnedAt).toBeTruthy();
  });

  it("gives staff no library card", async () => {
    await actingAs(librarian.id);
    expect(await listOwnLoans()).toBeNull();
  });
});

describe("authorization", () => {
  it("does not let a member issue a book", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(reader.id, "MEMBER");

    await expect(issueBook({ memberUserId: reader.id, copyId: copy.id })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("does not let a member return their own book", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await actingAs(reader.id, "MEMBER");
    await expect(returnBook({ loanId: issued.loanId })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("does not let a member renew their own loan", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    await actingAs(reader.id, "MEMBER");
    await expect(renewLoan({ loanId: issued.loanId })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("does not let a member reach the desk's loan list, though they hold loan.view", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(otherReader.id, copy.id);
    await actingAs(reader.id, "MEMBER");

    // The trap this guards against: `loan.view` is held by every reader, so a
    // desk screen guarded by it would be open to the whole library.
    await expect(listLoansForStaff()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(countDeskLoans()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(searchReaders("Meera")).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(searchCopies("Test")).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("does not let a librarian cancel without loan.correct", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);

    // A junior librarian works the desk but does not rewrite its records.
    const junior = await createStaff(fixture.libraryId, "LIBRARIAN");
    await db.rolePermission.deleteMany({
      where: { permissionKey: "loan.correct", role: { libraryId: fixture.libraryId, key: "LIBRARIAN" } },
    });
    await actingAs(junior.id);

    await expect(cancelLoan({ loanId: issued.loanId, reason: "Wrong child" })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("lets a librarian run the whole desk", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(librarian.id);

    const issued = await issueBook({ memberUserId: reader.id, copyId: copy.id });
    await expect(renewLoan({ loanId: issued.loanId })).resolves.toBeTruthy();
    await expect(returnBook({ loanId: issued.loanId })).resolves.toBeTruthy();
    await expect(listLoansForStaff()).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Searching the desk
// ---------------------------------------------------------------------------

describe("finding people and books at the desk", () => {
  it("finds a child by part of their name or their card number", async () => {
    await actingAs(librarian.id);

    expect((await searchReaders("aara")).map((row) => row.displayName)).toContain("Aarav Sharma");

    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: reader.id } });
    expect((await searchReaders(profile.memberCode)).map((row) => row.memberUserId)).toContain(
      reader.id,
    );
  });

  it("returns nothing about a child's guardian or where they live", async () => {
    await actingAs(librarian.id);
    const results = await searchReaders("aara");

    const serialised = JSON.stringify(results);
    expect(serialised).not.toContain("guardian");
    expect(serialised).not.toContain("apartment");
    expect(serialised).not.toContain("dateOfBirth");
    expect(serialised).not.toContain("birthYear");
  });

  it("finds a book by code, title or author, and says why one cannot go out", async () => {
    await namedCopy("The Jungle Book");
    await actingAs(librarian.id);

    expect((await searchCopies("jungle")).map((row) => row.title)).toContain("The Jungle Book");
    expect((await searchCopies("kipl")).map((row) => row.title)).toContain("The Jungle Book");

    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);
    await actingAs(librarian.id);

    const found = (await searchCopies(copy.copyCode))[0];
    expect(found?.copyCode).toBe(copy.copyCode);
    // Shown, not hidden: a librarian holding the book must be told what the
    // library thinks of it.
    expect(found?.blockedReason).toContain("already out");
  });

  it("leaves archived copies out of the desk's search entirely", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({
      where: { id: copy.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    await actingAs(librarian.id);
    expect(await searchCopies(copy.copyCode)).toEqual([]);
  });

  it("previews the due date and every blocker before anything is written", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.bookCopy.update({ where: { id: copy.id }, data: { condition: "DAMAGED" } });
    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    await actingAs(librarian.id);
    const preview = await getIssuePreview(reader.id, copy.id);

    expect(preview.loanPeriodDays).toBe(14);
    expect(preview.blockers).toHaveLength(2);
    expect(await db.loan.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("history", () => {
  it("keeps every circulation of the same copy distinguishable", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    const first = await issueTo(reader.id, copy.id);
    await returnBook({ loanId: first.loanId });
    const second = await issueTo(otherReader.id, copy.id);
    await returnBook({ loanId: second.loanId });
    const third = await issueTo(reader.id, copy.id);

    const loans = await db.loan.findMany({ where: { copyId: copy.id } });
    expect(loans).toHaveLength(3);
    expect(new Set(loans.map((loan) => loan.id)).size).toBe(3);
    expect(loans.filter((loan) => loan.status === "ACTIVE").map((loan) => loan.id)).toEqual([
      third.loanId,
    ]);
  });

  it("tells the whole story of one loan", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueTo(reader.id, copy.id);
    await renewLoan({ loanId: issued.loanId });
    await returnBook({ loanId: issued.loanId, condition: "DAMAGED" });

    const detail = await getLoanForStaff(issued.loanId);

    /*
     * The set, and the two orderings that are real.
     *
     * RETURN and MARK_DAMAGED are written in the same transaction with the same
     * timestamp — the librarian took the book back and looked at it in one
     * motion — so there is no true order between them and the test does not
     * invent one. What IS true is that the issue came first and the renewal
     * came before the return.
     */
    const types = detail.events.map((event) => event.type);
    expect(types.slice().sort()).toEqual(["ISSUE", "MARK_DAMAGED", "RENEW", "RETURN"]);
    expect(types[0]).toBe("ISSUE");
    expect(types.indexOf("RENEW")).toBeLessThan(types.indexOf("RETURN"));

    const renewal = detail.events.find((event) => event.type === "RENEW");
    expect(renewal?.previousDueAt).toBeTruthy();
    expect(renewal?.newDueAt).toBeTruthy();
    expect(detail.events.every((event) => event.actorName === librarian.displayName)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The catalogue, now that circulation owns the status
// ---------------------------------------------------------------------------

describe("the catalogue defers to circulation", () => {
  function bookInput(status?: BookInput["status"]): BookInput {
    return {
      title: "The Jungle Book",
      author: "Rudyard Kipling",
      categoryId: "",
      ageGroup: "AGE_8_10",
      condition: "GOOD",
      status,
      donorName: "",
      donorFlat: "",
      donatedOn: "",
      coverMediaId: "",
    };
  }

  it("refuses to change the status of a book that is out", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);
    const category = await defaultCategory(fixture.libraryId);

    await actingAs(librarian.id);
    await expect(
      updateBook(copy.id, { ...bookInput("AVAILABLE"), categoryId: category.id }),
    ).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("out with a reader"),
    });
  });

  it("still lets a librarian fix the title of a book that is out", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);
    const category = await defaultCategory(fixture.libraryId);

    await actingAs(librarian.id);
    await updateBook(copy.id, {
      ...bookInput(undefined),
      title: "The Jungle Book (corrected)",
      categoryId: category.id,
    });

    const after = await db.bookCopy.findUniqueOrThrow({
      where: { id: copy.id },
      include: { title: true },
    });
    expect(after.title.title).toBe("The Jungle Book (corrected)");
    expect(after.status).toBe("BORROWED");
  });

  it("refuses to archive a book that is out", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await issueTo(reader.id, copy.id);

    await actingAs(librarian.id);
    await expect(archiveBook(copy.id)).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("out with a reader"),
    });
  });
});
