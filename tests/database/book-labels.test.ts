import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { endOfDayInTimezone } from "@/lib/dates";
import { labelsPerSheet } from "@/lib/labels";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { createBook, type BookInput } from "@/server/services/catalogue-service";
import { countBookLabels, printBookLabels } from "@/server/services/label-service";

import {
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  defaultCategory,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Printing shelf labels, against a real database.
 *
 * The date range is the whole point of this feature and the one part that
 * cannot be tested without PostgreSQL: it is a SQL predicate on `created_at`,
 * resolved from a day a librarian typed into an instant in the library's own
 * timezone. A unit test of the wrapper would prove the wrapper works and say
 * nothing about whether "books added last week" returns last week's books.
 *
 * Three properties are under test:
 *
 *   1. A range means that range — inclusive at both ends, and nothing outside.
 *   2. A reader cannot print labels, whatever the screen does or does not show.
 *   3. Printing is recorded without the audit log becoming a copy of the
 *      catalogue.
 */

const TIMEZONE = "Asia/Kolkata";

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;
let categoryId: string;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

function bookInput(overrides: Partial<BookInput> = {}): BookInput {
  return {
    title: "The Jungle Book",
    author: "Rudyard Kipling",
    categoryId,
    ageGroup: "AGE_8_11",
    condition: "GOOD",
    status: "AVAILABLE",
    donorName: "",
    donorFlat: "",
    donatedOn: "",
    coverMediaId: "",
    ...overrides,
  };
}

/** Adds a book and back-dates when it was entered, which is what labels filter on. */
async function addBookOn(day: string, title: string) {
  await actingAs(librarian.id);
  const created = await createBook(bookInput({ title }));

  const at = new Date(`${day}T06:00:00.000Z`); // midday in Asia/Kolkata
  await db.bookCopy.update({ where: { id: created.copyId }, data: { createdAt: at } });

  return created;
}

/** The instants the route derives from two typed dates. */
function range(from: string, to: string) {
  return {
    from: new Date(`${from}T00:00:00.000+05:30`),
    to: endOfDayInTimezone(new Date(`${to}T00:00:00.000+05:30`), TIMEZONE),
  };
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  reader = await createMember(fixture.libraryId);
  categoryId = (await defaultCategory(fixture.libraryId)).id;

  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: { timezone: TIMEZONE },
  });

  await addBookOn("2026-08-10", "Long Before");
  await addBookOn("2026-08-17", "On The First Day");
  await addBookOn("2026-08-20", "In The Middle");
  await addBookOn("2026-08-23", "On The Last Day");
  await addBookOn("2026-08-30", "Long After");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the date range", () => {
  it("includes both ends of the week", async () => {
    await actingAs(librarian.id);
    const { from, to } = range("2026-08-17", "2026-08-23");

    expect(await countBookLabels(from, to)).toBe(3);
  });

  it("leaves out what falls outside it", async () => {
    await actingAs(librarian.id);
    const { from, to } = range("2026-08-18", "2026-08-22");

    expect(await countBookLabels(from, to)).toBe(1);
  });

  it("treats a single day as that day rather than as nothing", async () => {
    await actingAs(librarian.id);
    const { from, to } = range("2026-08-20", "2026-08-20");

    expect(await countBookLabels(from, to)).toBe(1);
  });

  it("counts every book when no dates are given", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels()).toBe(5);
  });

  it("counts nothing for a week with no books in it", async () => {
    await actingAs(librarian.id);
    const { from, to } = range("2026-09-10", "2026-09-17");

    expect(await countBookLabels(from, to)).toBe(0);
  });
});

describe("the sheet", () => {
  it("prints one label per copy in the range", async () => {
    await actingAs(librarian.id);
    const { from, to } = range("2026-08-17", "2026-08-23");

    const file = await printBookLabels({
      from,
      to,
      size: "standard",
      cutGuides: true,
      selectedIds: [],
    });

    expect(file.labelCount).toBe(3);
    expect(file.sheetCount).toBe(1);
    expect(file.contentType).toBe("application/pdf");
    expect(file.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("names the file after the library and the day", async () => {
    await actingAs(librarian.id);
    const file = await printBookLabels({
      size: "standard",
      cutGuides: true,
      selectedIds: [],
    });

    expect(file.filename).toMatch(/^[a-z0-9-]+_book-labels_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("prints only the copies that were ticked", async () => {
    await actingAs(librarian.id);
    const middle = await db.bookCopy.findFirstOrThrow({
      where: { title: { title: "In The Middle" } },
    });

    const file = await printBookLabels({
      size: "standard",
      cutGuides: true,
      selectedIds: [middle.id],
    });

    expect(file.labelCount).toBe(1);
  });

  it("opens as a real PDF with the sheets it claims", async () => {
    await actingAs(librarian.id);
    const file = await printBookLabels({
      size: "small",
      cutGuides: false,
      selectedIds: [],
    });

    const reopened = await PDFDocument.load(file.bytes);
    expect(reopened.getPageCount()).toBe(file.sheetCount);
    expect(file.sheetCount).toBe(Math.max(1, Math.ceil(5 / labelsPerSheet("small"))));
  });
});

describe("who may print them", () => {
  it("refuses a reader", async () => {
    await actingAs(reader.id, "MEMBER");

    await expect(
      printBookLabels({ size: "standard", cutGuides: true, selectedIds: [] }),
    ).rejects.toThrow();
  });

  it("refuses a reader even a count", async () => {
    await actingAs(reader.id, "MEMBER");
    await expect(countBookLabels()).rejects.toThrow();
  });
});

describe("what the log records", () => {
  it("records the print without copying the catalogue into it", async () => {
    await actingAs(librarian.id);
    const { from, to } = range("2026-08-17", "2026-08-23");

    await printBookLabels({ from, to, size: "large", cutGuides: true, selectedIds: [] });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { libraryId: fixture.libraryId, action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
      orderBy: { occurredAt: "desc" },
    });

    const metadata = entry.metadata as Record<string, unknown>;
    expect(metadata.labelCount).toBe(3);
    expect(metadata.size).toBe("large");
    expect(metadata.scope).toBe("range");

    // No book codes, no titles. The log says a sheet was printed; it does not
    // become a second copy of the shelf.
    const serialised = JSON.stringify(metadata);
    expect(serialised).not.toContain("On The First Day");
    expect(serialised).not.toContain("In The Middle");
  });

  it("does not log a count, so changing the dates does not flood the log", async () => {
    await actingAs(librarian.id);
    const before = await db.auditLog.count({
      where: { action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
    });

    await countBookLabels();
    await countBookLabels(...Object.values(range("2026-08-17", "2026-08-23")));

    const after = await db.auditLog.count({
      where: { action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
    });
    expect(after).toBe(before);
  });
});
