import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  findStrandedCopies,
  markMissing,
  markOnShelf,
  recordLoan,
  ReconciliationError,
} from "../../scripts/lib/circulation-reconciliation";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Reconciling a book whose record and whose shelf disagree.
 *
 * Phase 2 let a librarian type "Borrowed" onto a copy, with no loan behind it
 * and therefore no borrower. Phase 3 cannot run while such a copy exists, and
 * the question this file settles is what happens next.
 *
 * The answer under test: **nothing automatic**. A deployment that reset the
 * copy to AVAILABLE would be telling a child the book is on the shelf when it
 * may be in another child's bag; one that wrote a loan would be naming a
 * borrower nothing in the database knows. Both are somebody's job, not the
 * migration's, and the tests below are the proof that the code cannot be
 * talked into either.
 *
 * Constructing the broken state takes a deliberate act — the deferred
 * constraint trigger from migration 6 makes it uncommittable through any
 * ordinary path. `strand()` disables that trigger to build exactly the row a
 * Phase 2 database would hand us. That is the point: this is the one state the
 * system is not supposed to be able to reach, and reconciliation is what
 * happens when it turns out to be there anyway.
 */

let fixture: Fixture;

const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260817200000_phase3_circulation/migration.sql",
  ),
  "utf8",
);

/**
 * Creates a copy that reads BORROWED with no loan, and commits it.
 *
 * The trigger is switched off for exactly one statement. Nothing in the
 * application can do this; a Phase 2 database arrives already in this state.
 */
async function strand(): Promise<{ id: string; copyCode: string }> {
  const copy = await createBookCopy(fixture.libraryId);

  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `ALTER TABLE book_copy DISABLE TRIGGER copy_status_matches_its_loan`,
    );
    await tx.$executeRaw`UPDATE book_copy SET status = 'BORROWED' WHERE id = ${copy.id}`;
    await tx.$executeRawUnsafe(
      `ALTER TABLE book_copy ENABLE TRIGGER copy_status_matches_its_loan`,
    );
  });

  return { id: copy.id, copyCode: copy.copyCode };
}

/** Runs the guard the migration runs. Resolves when the database is coherent. */
async function runGuard(): Promise<void> {
  await db.$executeRawUnsafe(`SELECT circulation_assert_no_stranded_copies()`);
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
});

beforeEach(async () => {
  // One transaction, because the trigger is deferred to commit: deleting a
  // loan and putting its copy back on the shelf are only coherent together.
  await db.$transaction(async (tx) => {
    await tx.loanEvent.deleteMany();
    await tx.loan.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.bookCopy.updateMany({ data: { status: "AVAILABLE" } });
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the migration's guard", () => {
  it("passes silently when every borrowed book has a borrower", async () => {
    await expect(runGuard()).resolves.not.toThrow();
  });

  it("refuses to continue when a copy reads BORROWED with no loan", async () => {
    const stranded = await strand();

    await expect(runGuard()).rejects.toThrow(/BORROWED with no loan/);
    // And it names the book, so the operator knows which shelf to walk to.
    await expect(runGuard()).rejects.toThrow(stranded.copyCode);
  });

  it("leaves the copy exactly as it found it", async () => {
    const stranded = await strand();

    await expect(runGuard()).rejects.toThrow();

    const after = await db.bookCopy.findUniqueOrThrow({ where: { id: stranded.id } });
    // The single most important assertion in this file. A deployment must
    // never make a book that might be in a child's bag look available.
    expect(after.status).toBe("BORROWED");
  });

  it("fabricates no borrower and no loan", async () => {
    await strand();

    await expect(runGuard()).rejects.toThrow();

    expect(await db.loan.count()).toBe(0);
    expect(await db.loanEvent.count()).toBe(0);
  });

  it("passes once the book has been resolved", async () => {
    const stranded = await strand();
    await expect(runGuard()).rejects.toThrow();

    await markOnShelf(db, {
      copyCode: stranded.copyCode,
      operator: "Test Operator",
      reason: "Found on the returns trolley",
    });

    await expect(runGuard()).resolves.not.toThrow();
  });
});

describe("the migration file itself", () => {
  it("calls the guard", () => {
    expect(MIGRATION_SQL).toContain("SELECT circulation_assert_no_stranded_copies();");
  });

  it("contains no automatic reset of a borrowed copy", () => {
    // A regression test against re-introducing the silent repair. Any statement
    // that sets a book_copy status inside this migration would be the migration
    // deciding where a physical book is, which is the thing it must not do.
    const statements = MIGRATION_SQL.split(";")
      .map((statement) => statement.replace(/--[^\n]*/g, "").trim())
      .filter((statement) => /^\s*(UPDATE|INSERT\s+INTO)\s+book_copy/i.test(statement));

    expect(statements).toEqual([]);
  });

  it("writes no audit row on the library's behalf", () => {
    // The previous design wrote `loan.corrected` rows describing a decision
    // nobody had made. Corrections are now signed by the operator who made them.
    expect(MIGRATION_SQL).not.toMatch(/INSERT\s+INTO\s+audit_log/i);
  });

  it("runs the guard before it installs anything", () => {
    // Prisma applies these statements in order, so a failure at the guard means
    // nothing below it has run. That only holds while the guard is first.
    const guardAt = MIGRATION_SQL.indexOf("SELECT circulation_assert_no_stranded_copies();");
    const firstAlter = MIGRATION_SQL.search(/^ALTER TABLE/m);

    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstAlter);
  });
});

describe("finding what needs a decision", () => {
  it("lists the stranded copy with enough to identify the book", async () => {
    const stranded = await strand();

    const found = await findStrandedCopies(db);

    expect(found).toHaveLength(1);
    expect(found[0]!.copyCode).toBe(stranded.copyCode);
    expect(found[0]!.title).toContain("Test Book");
  });

  it("does not list a borrowed copy that has a borrower", async () => {
    const copy = await createBookCopy(fixture.libraryId);
    const member = await createMember(fixture.libraryId);

    await db.$transaction(async (tx) => {
      await tx.loan.create({
        data: {
          libraryId: fixture.libraryId,
          copyId: copy.id,
          memberUserId: member.id,
          dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.bookCopy.update({ where: { id: copy.id }, data: { status: "BORROWED" } });
    });

    expect(await findStrandedCopies(db)).toEqual([]);
  });
});

describe("the three resolutions", () => {
  it("marks a book on the shelf as available, under the operator's name", async () => {
    const stranded = await strand();

    await markOnShelf(db, {
      copyCode: stranded.copyCode,
      operator: "Priya",
      reason: "Found on the returns trolley",
    });

    const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: stranded.id } });
    expect(copy.status).toBe("AVAILABLE");

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: stranded.id } });
    expect(audit.actorLabel).toBe("Priya");
    expect(audit.metadata).toMatchObject({ from: "BORROWED", to: "AVAILABLE" });
    // Still nobody's name against the book.
    expect(await db.loan.count()).toBe(0);
  });

  it("marks a book nobody can find as lost, not as available", async () => {
    const stranded = await strand();

    await markMissing(db, {
      copyCode: stranded.copyCode,
      operator: "Priya",
      reason: "Not on the shelf and nobody recalls lending it",
    });

    const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: stranded.id } });
    // LOST is the honest state: the library does not have it, does not know who
    // does, and is not about to promise it to the next child who asks.
    expect(copy.status).toBe("LOST");
    expect(await db.loan.count()).toBe(0);
  });

  it("records a real loan when the operator knows who has the book", async () => {
    const stranded = await strand();
    const member = await createMember(fixture.libraryId, { displayName: "Known Borrower" });
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    const issuedAt = new Date("2026-08-01T12:00:00Z");
    const dueAt = new Date("2026-08-15T12:00:00Z");

    await recordLoan(db, {
      copyCode: stranded.copyCode,
      memberCode: profile.memberCode,
      issuedAt,
      dueAt,
      operator: "Priya",
      reason: "The family confirmed they have it at home",
    });

    const loan = await db.loan.findFirstOrThrow({ where: { copyId: stranded.id } });
    expect(loan.memberUserId).toBe(member.id);
    expect(loan.status).toBe("ACTIVE");
    // The operator's dates, not today's. The child's history should read as
    // what happened.
    expect(loan.issuedAt.toISOString()).toBe(issuedAt.toISOString());
    expect(loan.dueAt.toISOString()).toBe(dueAt.toISOString());
    // No member of staff issued this through the desk, and it does not claim one.
    expect(loan.issuedById).toBeNull();

    const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: stranded.id } });
    expect(copy.status).toBe("BORROWED");

    const event = await db.loanEvent.findFirstOrThrow({ where: { loanId: loan.id } });
    expect(event.type).toBe("ISSUE");
  });

  it("refuses a card number that belongs to nobody", async () => {
    const stranded = await strand();

    await expect(
      recordLoan(db, {
        copyCode: stranded.copyCode,
        memberCode: "TST-R9999",
        issuedAt: new Date("2026-08-01T12:00:00Z"),
        dueAt: new Date("2026-08-15T12:00:00Z"),
        operator: "Priya",
        reason: "Thought it was this child, was not sure",
      }),
    ).rejects.toThrow(ReconciliationError);

    // A wrong card must not become a loan against whoever happens to exist.
    expect(await db.loan.count()).toBe(0);
  });

  it("refuses a decision with no operator and no reason", async () => {
    const stranded = await strand();

    await expect(
      markOnShelf(db, { copyCode: stranded.copyCode, operator: "", reason: "Found it" }),
    ).rejects.toThrow(/operator name is required/);

    await expect(
      markOnShelf(db, { copyCode: stranded.copyCode, operator: "Priya", reason: "cleanup" }),
    ).rejects.toThrow(/reason/);

    const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: stranded.id } });
    expect(copy.status).toBe("BORROWED");
  });

  it("refuses a copy that is not stranded at all", async () => {
    const healthy = await createBookCopy(fixture.libraryId);

    await expect(
      markOnShelf(db, {
        copyCode: healthy.copyCode,
        operator: "Priya",
        reason: "Tidying up the catalogue",
      }),
    ).rejects.toThrow(/not one of the copies needing reconciliation/);
  });
});
