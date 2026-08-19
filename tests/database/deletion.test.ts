import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { archiveBook, deleteBook } from "@/server/services/catalogue-service";
import { issueBook, requestBorrow, returnBook } from "@/server/services/circulation-service";
import { deactivateMember } from "@/server/services/account-service";

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
 * Deletion belongs to the Super Admin, and almost nothing may be deleted.
 *
 * Two rules, and the second is the interesting one:
 *
 *   1. **Who.** `book.delete` and `member.deactivate` are held by the Super
 *      Admin alone. A librarian fixing a mistake edits, archives or suspends —
 *      all reversible, all theirs.
 *
 *   2. **What.** Even the Super Admin cannot erase history. A copy that has
 *      been borrowed, asked for or given cannot be deleted at all; the answer
 *      is to archive it. What is deletable is exactly the row that records
 *      nothing — the duplicate somebody typed in twice.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let admin: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

afterAll(async () => {
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  reader = await createMember(fixture.libraryId);
});

describe("a librarian cannot delete anything", () => {
  it("is refused a book deletion, server-side", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(librarian.id);

    await expect(deleteBook(copy.id, "duplicate")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    // Still there.
    expect(await db.bookCopy.count({ where: { id: copy.id } })).toBe(1);
  });

  it("is refused closing a member's account", async () => {
    // A librarian may pause an account and un-pause it. Ending a membership,
    // when a family leaves the building, belongs with whoever approved it.
    await actingAs(librarian.id);

    await expect(deactivateMember(reader.id, "family moved away")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    const unchanged = await db.appUser.findUniqueOrThrow({ where: { id: reader.id } });
    expect(unchanged.status).toBe("ACTIVE");
  });

  it("keeps the reversible half of the job", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(librarian.id);

    await expect(archiveBook(copy.id, "fell apart")).resolves.toBeUndefined();

    const archived = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
  });
});

describe("a reader cannot delete anything", () => {
  it("is refused a book deletion", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(reader.id, "MEMBER");

    await expect(deleteBook(copy.id, "I do not like it")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("is refused archiving too", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(reader.id, "MEMBER");

    await expect(archiveBook(copy.id, "no")).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

describe("the Super Admin may delete a book with no history", () => {
  it("removes a duplicate, and leaves an audit row saying what it was", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(admin.id);

    const result = await deleteBook(copy.id, "entered twice by mistake");
    expect(result.copyCode).toBe(copy.copyCode);

    expect(await db.bookCopy.count({ where: { id: copy.id } })).toBe(0);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.BOOK_COPY_DELETED },
    });
    expect(entry.actorUserId).toBe(admin.id);
    // The record of what was removed outlives the thing that was removed.
    expect(JSON.stringify(entry.metadata)).toContain(copy.copyCode);
    expect(JSON.stringify(entry.metadata)).toContain("entered twice by mistake");
  });

  it("insists on a reason", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(admin.id);

    await expect(deleteBook(copy.id, "")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.bookCopy.count({ where: { id: copy.id } })).toBe(1);
  });
});

describe("even the Super Admin cannot erase history", () => {
  it("refuses a copy that has ever been borrowed", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await actingAs(librarian.id);
    const loan = await issueBook({ memberUserId: reader.id, copyId: copy.id });
    await returnBook({ loanId: loan.loanId });

    await actingAs(admin.id);
    await expect(deleteBook(copy.id, "tidying up")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });

    expect(await db.bookCopy.count({ where: { id: copy.id } })).toBe(1);

    // The refusal is worth a row of its own: somebody tried to remove a book
    // the library has a history with.
    expect(
      await db.auditLog.count({ where: { action: AUDIT_ACTIONS.BOOK_COPY_DELETE_REFUSED } }),
    ).toBe(1);
  });

  it("refuses a copy a child has asked for", async () => {
    const copy = await createBookCopy(fixture.libraryId);

    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.copyCode });

    await actingAs(admin.id);
    await expect(deleteBook(copy.id, "tidying up")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses a copy somebody gave to the library", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await db.donation.create({
      data: {
        libraryId: fixture.libraryId,
        copyId: copy.id,
        donorName: "A Neighbour",
        displayConsent: "NAMED",
      },
    });

    await actingAs(admin.id);
    await expect(deleteBook(copy.id, "tidying up")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });

    // The gift is still recorded.
    expect(await db.donation.count({ where: { copyId: copy.id } })).toBe(1);
  });

  it("says to archive it instead", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(librarian.id);
    const loan = await issueBook({ memberUserId: reader.id, copyId: copy.id });
    await returnBook({ loanId: loan.loanId });

    await actingAs(admin.id);
    await expect(deleteBook(copy.id, "tidying up")).rejects.toMatchObject({
      friendlyMessage: expect.stringContaining("Archive it instead"),
    });
  });
});
