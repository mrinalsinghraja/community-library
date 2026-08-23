import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { endOfDayInTimezone } from "@/lib/dates";
import { createSession } from "@/server/auth/session-store";
import {
  circulationSummary,
  listBookActivity,
  listCirculation,
  listReaderActivity,
} from "@/server/services/circulation-reports-service";

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
 * The period reports, against a real database.
 *
 * All three are SQL aggregates over a window, which is precisely the thing a
 * unit test cannot check: the counting, the window's edges, and the difference
 * between a fact about the period and a fact about today all live in the query.
 *
 * Four properties are under test:
 *
 *   1. A period means "issued in it", inclusive at both ends.
 *   2. "Still out" and "late" describe today, not the period.
 *   3. A reader cannot read any of them, and naming readers needs `member.view`.
 *   4. Readers come back in alphabetical order, never ranked by how much they
 *      read. That is the one ordering this feature must never have.
 */

const TIMEZONE = "Asia/Kolkata";

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

/**
 * Places a loan directly, so its dates can be exactly what the test needs.
 *
 * The copy's status is moved with it. A database CHECK enforces that a copy
 * with an active loan against it reads BORROWED — writing the loan alone is
 * rejected, which is the constraint doing its job.
 */
async function loan(opts: {
  memberUserId: string;
  copyId: string;
  issued: string;
  due: string;
  returned?: string;
  renewals?: number;
}) {
  /*
   * One transaction, because the two triggers that keep a copy and its loan
   * agreeing are DEFERRABLE INITIALLY DEFERRED. Written as two statements
   * outside a transaction, each is checked on its own and whichever lands
   * first is incoherent by itself.
   */
  return db.$transaction(async (tx) => {
    await tx.bookCopy.update({
      where: { id: opts.copyId },
      data: { status: opts.returned ? "AVAILABLE" : "BORROWED" },
    });

    return tx.loan.create({
      data: {
        libraryId: fixture.libraryId,
        copyId: opts.copyId,
        memberUserId: opts.memberUserId,
        status: opts.returned ? "RETURNED" : "ACTIVE",
        issuedAt: new Date(opts.issued),
        dueAt: new Date(opts.due),
        returnedAt: opts.returned ? new Date(opts.returned) : null,
        renewalCount: opts.renewals ?? 0,
      },
    });
  });
}

/** The instants the screen derives from two typed dates. */
function range(from: string, to: string) {
  return {
    from: new Date(`${from}T00:00:00.000+05:30`),
    to: endOfDayInTimezone(new Date(`${to}T00:00:00.000+05:30`), TIMEZONE),
  };
}

const AUGUST = () => range("2026-08-01", "2026-08-31");

let zara: Awaited<ReturnType<typeof createMember>>;
let arjun: Awaited<ReturnType<typeof createMember>>;
let popular: Awaited<ReturnType<typeof createBookCopy>>;
let quiet: Awaited<ReturnType<typeof createBookCopy>>;
/** A third copy, so the loan after the window is not the same physical book. */
let spare: Awaited<ReturnType<typeof createBookCopy>>;

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  reader = await createMember(fixture.libraryId);

  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: { timezone: TIMEZONE },
  });

  // Named so the alphabetical assertion means something: Arjun reads less than
  // Zara, so name order and count order disagree.
  zara = await createMember(fixture.libraryId, { displayName: "Zara" });
  arjun = await createMember(fixture.libraryId, { displayName: "Arjun" });

  popular = await createBookCopy(fixture.libraryId);
  quiet = await createBookCopy(fixture.libraryId);
  spare = await createBookCopy(fixture.libraryId);

  // Before the window.
  await loan({
    memberUserId: zara.id, copyId: popular.id,
    issued: "2026-07-20T06:00:00Z", due: "2026-08-03T06:00:00Z",
    returned: "2026-07-30T06:00:00Z",
  });

  // First day of the window, returned late.
  await loan({
    memberUserId: zara.id, copyId: popular.id,
    issued: "2026-08-01T06:00:00Z", due: "2026-08-15T06:00:00Z",
    returned: "2026-08-20T06:00:00Z",
  });

  /*
   * Mid window, kept longer twice, still out and past its date.
   *
   * The due date is inside the window rather than at the end of it so that
   * "late today" is true whenever this test runs. A date a fortnight after the
   * issue would have been in the future on the day this was written, which is
   * exactly the kind of fixture that passes in September and fails in August.
   */
  await loan({
    memberUserId: zara.id, copyId: quiet.id,
    issued: "2026-08-10T06:00:00Z", due: "2026-08-14T06:00:00Z",
    renewals: 2,
  });

  // Last day of the window.
  await loan({
    memberUserId: arjun.id, copyId: popular.id,
    issued: "2026-08-31T12:00:00Z", due: "2026-09-14T06:00:00Z",
    returned: "2026-09-05T06:00:00Z",
  });

  /*
   * After the window, and on a third copy. `quiet` is still in Zara's bag, and
   * a unique index enforces that one physical book cannot be in two pairs of
   * hands — which is the database being right about the world.
   */
  await loan({
    memberUserId: arjun.id, copyId: spare.id,
    issued: "2026-09-10T06:00:00Z", due: "2026-09-24T06:00:00Z",
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the window", () => {
  it("counts what was issued inside it, at both edges", async () => {
    await actingAs(librarian.id);
    const summary = await circulationSummary(AUGUST());

    // 1 Aug, 10 Aug and 31 Aug. Not 20 July, not 10 September.
    expect(summary.issued).toBe(3);
  });

  it("leaves out what was issued before or after", async () => {
    await actingAs(librarian.id);
    const rows = await listCirculation(AUGUST());

    for (const row of rows) {
      expect(row.issuedAt.getTime()).toBeGreaterThanOrEqual(AUGUST().from.getTime());
      expect(row.issuedAt.getTime()).toBeLessThanOrEqual(AUGUST().to.getTime());
    }
  });

  it("treats a single day as that day", async () => {
    await actingAs(librarian.id);
    const summary = await circulationSummary(range("2026-08-10", "2026-08-10"));

    expect(summary.issued).toBe(1);
  });

  it("counts everything when no dates are given", async () => {
    await actingAs(librarian.id);
    expect((await circulationSummary()).issued).toBe(5);
  });
});

describe("what belongs to the period and what belongs to today", () => {
  it("separates returned, still out and late now", async () => {
    await actingAs(librarian.id);
    const summary = await circulationSummary(AUGUST());

    expect(summary.returned).toBe(2); // the 1 Aug and 31 Aug loans came back
    expect(summary.stillOut).toBe(1); // the 10 Aug loan has not
    expect(summary.overdueNow).toBe(1); // and it is long past 24 Aug
  });

  it("counts renewals of loans issued in the period", async () => {
    await actingAs(librarian.id);
    expect((await circulationSummary(AUGUST())).renewals).toBe(2);
  });

  it("counts distinct readers and distinct copies", async () => {
    await actingAs(librarian.id);
    const summary = await circulationSummary(AUGUST());

    expect(summary.activeReaders).toBe(2);
    expect(summary.booksMoved).toBe(2);
  });

  it("measures days late for a book that came back late", async () => {
    await actingAs(librarian.id);
    const rows = await listCirculation(AUGUST());

    const late = rows.find((row) => row.issuedAt.toISOString().startsWith("2026-08-01"));
    const onTime = rows.find((row) => row.issuedAt.toISOString().startsWith("2026-08-31"));

    expect(late?.daysLate).toBe(5); // due 15 Aug, back 20 Aug
    expect(onTime?.daysLate).toBeNull(); // due 14 Sep, back 5 Sep
  });

  it("measures days late for a book that is still out and overdue", async () => {
    await actingAs(librarian.id);
    const rows = await listCirculation(AUGUST());

    // Due 14 Aug 2026 and never returned. Counted to today, so it only grows.
    const stillLate = rows.find((row) => row.issuedAt.toISOString().startsWith("2026-08-10"));

    expect(stillLate?.returnedAt).toBeNull();
    expect(stillLate?.overdueNow).toBe(true);
    expect(stillLate?.daysLate).toBeGreaterThan(0);
  });

  it("counts days out from issue to return, or to now while it is still out", async () => {
    await actingAs(librarian.id);
    const rows = await listCirculation(AUGUST());

    const returned = rows.find((row) => row.issuedAt.toISOString().startsWith("2026-08-01"));
    expect(returned?.daysOut).toBe(19); // 1 Aug -> 20 Aug

    const stillOut = rows.find((row) => row.issuedAt.toISOString().startsWith("2026-08-10"));
    expect(stillOut?.overdueNow).toBe(true);
    expect(stillOut?.returnedAt).toBeNull();
  });
});

describe("how much each reader is reading", () => {
  it("counts per reader, and leaves out anybody who read nothing", async () => {
    await actingAs(librarian.id);
    const rows = await listReaderActivity(AUGUST());

    expect(rows.map((row) => row.readerName).sort()).toEqual(["Arjun", "Zara"]);

    const zaraRow = rows.find((row) => row.readerName === "Zara");
    expect(zaraRow?.borrowed).toBe(2);
    expect(zaraRow?.returned).toBe(1);
    expect(zaraRow?.stillOut).toBe(1);
    expect(zaraRow?.overdueNow).toBe(1);
    expect(zaraRow?.renewals).toBe(2);
    expect(zaraRow?.distinctTitles).toBe(2);
  });

  it("lists readers by name, never ranked by how much they read", async () => {
    await actingAs(librarian.id);
    const rows = await listReaderActivity(AUGUST());

    // Zara borrowed twice and Arjun once. A ranking would put Zara first.
    expect(rows.map((row) => row.readerName)).toEqual(["Arjun", "Zara"]);
    expect(rows[0].borrowed).toBeLessThan(rows[1].borrowed);
  });

  it("reports the first and last time somebody borrowed in the period", async () => {
    await actingAs(librarian.id);
    const zaraRow = (await listReaderActivity(AUGUST())).find((r) => r.readerName === "Zara");

    expect(zaraRow?.firstBorrowedAt?.toISOString()).toContain("2026-08-01");
    expect(zaraRow?.lastBorrowedAt?.toISOString()).toContain("2026-08-10");
  });
});

describe("how much each book is read", () => {
  it("counts per title and puts the most borrowed first", async () => {
    await actingAs(librarian.id);
    const rows = await listBookActivity(AUGUST());

    expect(rows).toHaveLength(2);
    expect(rows[0].timesBorrowed).toBe(2); // the popular one
    expect(rows[1].timesBorrowed).toBe(1);
    expect(rows[0].timesBorrowed).toBeGreaterThanOrEqual(rows[1].timesBorrowed);
  });

  it("counts distinct readers of a title", async () => {
    await actingAs(librarian.id);
    const rows = await listBookActivity(AUGUST());

    expect(rows[0].readers).toBe(2); // Zara and Arjun both took it
    expect(rows[1].readers).toBe(1);
  });

  it("reports how many copies are on the shelf", async () => {
    await actingAs(librarian.id);
    const rows = await listBookActivity(AUGUST());

    for (const row of rows) expect(row.copies).toBe(1);
  });
});

describe("who may read these", () => {
  it("refuses a reader the summary", async () => {
    await actingAs(reader.id, "MEMBER");
    await expect(circulationSummary(AUGUST())).rejects.toThrow();
  });

  it("refuses a reader the loan list", async () => {
    await actingAs(reader.id, "MEMBER");
    await expect(listCirculation(AUGUST())).rejects.toThrow();
  });

  it("refuses a reader their own neighbours' reading", async () => {
    await actingAs(reader.id, "MEMBER");
    await expect(listReaderActivity(AUGUST())).rejects.toThrow();
  });

  it("refuses a reader the book activity", async () => {
    await actingAs(reader.id, "MEMBER");
    await expect(listBookActivity(AUGUST())).rejects.toThrow();
  });

  it("lets a librarian read all four", async () => {
    await actingAs(librarian.id);

    await expect(circulationSummary(AUGUST())).resolves.toBeDefined();
    await expect(listCirculation(AUGUST())).resolves.toBeDefined();
    await expect(listReaderActivity(AUGUST())).resolves.toBeDefined();
    await expect(listBookActivity(AUGUST())).resolves.toBeDefined();
  });
});
