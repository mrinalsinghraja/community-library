import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { EMPTY_BOOK_FILTER, type BookFilter } from "@/lib/book-filter";
import { labelsPerSheet } from "@/lib/labels";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { createBook, type BookInput } from "@/server/services/catalogue-service";
import { countBookLabels, printBookLabels } from "@/server/services/label-service";

import { drawnText } from "../pdf-text";

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
 * Four properties are under test:
 *
 *   1. A range means that range — inclusive at both ends, and nothing outside.
 *   2. Every way of choosing books means what it says: a shelf, an age, a run
 *      of book IDs, a donation month, a family.
 *   3. A reader cannot print labels, whatever the screen does or does not show.
 *   4. Printing is recorded without the audit log becoming a copy of the
 *      catalogue — and without becoming a record of who searched for whom.
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

/** A filter as a librarian would have left the screen. */
function filter(overrides: Partial<BookFilter> = {}): BookFilter {
  return { ...EMPTY_BOOK_FILTER, ...overrides };
}

/** The two typed dates, as the added-on range the screen sends. */
function range(from: string, to: string): BookFilter {
  return filter({ addedFrom: from, addedTo: to });
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
    expect(await countBookLabels(range("2026-08-17", "2026-08-23"))).toBe(3);
  });

  it("leaves out what falls outside it", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(range("2026-08-18", "2026-08-22"))).toBe(1);
  });

  it("treats a single day as that day rather than as nothing", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(range("2026-08-20", "2026-08-20"))).toBe(1);
  });

  it("counts every book when no dates are given", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels()).toBe(5);
  });

  it("counts nothing for a week with no books in it", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(range("2026-09-10", "2026-09-17"))).toBe(0);
  });
});

describe("the sheet", () => {
  it("prints one label per copy in the range", async () => {
    await actingAs(librarian.id);
    const file = await printBookLabels({
      filter: range("2026-08-17", "2026-08-23"),
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
      filter: filter(),
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
      filter: filter(),
      size: "standard",
      cutGuides: true,
      selectedIds: [middle.id],
    });

    expect(file.labelCount).toBe(1);
  });

  it("opens as a real PDF with the sheets it claims", async () => {
    await actingAs(librarian.id);
    const file = await printBookLabels({
      filter: filter(),
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
      printBookLabels({ filter: filter(), size: "standard", cutGuides: true, selectedIds: [] }),
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
    await printBookLabels({
      filter: range("2026-08-17", "2026-08-23"),
      size: "large",
      cutGuides: true,
      selectedIds: [],
    });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { libraryId: fixture.libraryId, action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
      orderBy: { occurredAt: "desc" },
    });

    const metadata = entry.metadata as Record<string, unknown>;
    expect(metadata.labelCount).toBe(3);
    expect(metadata.size).toBe("large");
    expect(metadata.scope).toBe("filter");

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
    await countBookLabels(range("2026-08-17", "2026-08-23"));

    const after = await db.auditLog.count({
      where: { action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
    });
    expect(after).toBe(before);
  });
});

/**
 * The donor's credit, from the record to the sticker.
 *
 * This is the one personal thing a label carries, and the consent that governs
 * it is a column in the database, so it is checked end to end: a real donation
 * row, the real service, and the finished PDF read back. A unit test proves the
 * sentence is built correctly; only this proves that the sentence built is the
 * one that was recorded for that book.
 *
 * The name that must not appear is asserted for by name. "It printed something"
 * is not the property — "it did not print Meera Nair" is.
 */
describe("the donor's credit on the label", () => {
  /** Adds a donated book and returns the copy, so a sheet can be one label. */
  async function donatedBook(
    title: string,
    donor: { donorName: string; donorFlat: string; donorAnonymous?: boolean },
  ) {
    await actingAs(librarian.id);
    const created = await createBook(
      bookInput({ title, donatedOn: "2026-08-12", ...donor }),
    );
    return created.copyId;
  }

  /** One label, so nothing on the sheet came from another book. */
  async function labelText(copyId: string) {
    await actingAs(librarian.id);
    const file = await printBookLabels({
      filter: filter(),
      size: "standard",
      cutGuides: false,
      selectedIds: [copyId],
    });

    expect(file.labelCount).toBe(1);
    return drawnText(file.bytes);
  }

  it("prints the name, the flat and the month for a family who agreed to be named", async () => {
    const copyId = await donatedBook("A Named Gift", {
      donorName: "Meera Nair",
      donorFlat: "A-1204",
    });

    const text = await labelText(copyId);
    expect(text).toContain("Meera Nair");
    expect(text).toContain("A-1204");
    expect(text).toContain("Aug 2026");
  });

  it("prints no name and no month for a family who asked not to be named", async () => {
    const copyId = await donatedBook("An Anonymous Gift", {
      donorName: "Rahul Barua",
      donorFlat: "C-901",
      donorAnonymous: true,
    });

    const text = await labelText(copyId);
    expect(text).toContain("Donated by a neighbour");
    expect(text).not.toContain("Rahul");
    expect(text).not.toContain("C-901");
    // The register already says who gave in a given year. The month would be
    // one more column to line that up against.
    expect(text).not.toContain("Aug 2026");
  });

  it("prints the flat without the name when that is what was recorded", async () => {
    const copyId = await donatedBook("A Flat-Only Gift", {
      donorName: "Anita Das",
      donorFlat: "B-302",
    });

    // The desk sets this from the library's own default; forced here so the
    // third branch of the consent is exercised against a real row.
    await db.donation.update({
      where: { copyId },
      data: { displayConsent: "APARTMENT_ONLY" },
    });

    const text = await labelText(copyId);
    expect(text).toContain("B-302");
    expect(text).not.toContain("Anita");
  });

  it("says nothing about a donor on a book the library bought", async () => {
    await actingAs(librarian.id);
    const created = await createBook(bookInput({ title: "A Bought Book" }));

    const text = await labelText(created.copyId);
    expect(text).toContain("A Bought Book");
    expect(text).not.toContain("Donated");
  });

  it("keeps the donor off the audit log, which already holds the donation", async () => {
    const copyId = await donatedBook("A Logged Gift", {
      donorName: "Priya Sen",
      donorFlat: "D-104",
    });
    await labelText(copyId);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { libraryId: fixture.libraryId, action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
      orderBy: { occurredAt: "desc" },
    });

    // Printing a sheet is not a second place the donor register lives.
    expect(JSON.stringify(entry.metadata)).not.toContain("Priya");
  });
});

/**
 * Choosing books by everything except when they were catalogued.
 *
 * Every one of these is a SQL predicate, and three of them are predicates that
 * did not exist before: a numeric range pulled out of the end of a book code, a
 * donation date, and a donor. They are checked against a real database because
 * that is the only place the claim can be true — a librarian who prints
 * "everything the Nairs gave" and gets somebody else's books has printed
 * stickers that are wrong in a way nobody notices until the books are back on
 * the shelf.
 */
describe("the other ways of choosing books", () => {
  let comics: string;
  let stories: string;

  beforeAll(async () => {
    await actingAs(librarian.id);
    const categories = await db.bookCategory.findMany({ where: { libraryId: fixture.libraryId } });
    stories = categories[0].id;
    comics = categories[1]?.id ?? categories[0].id;

    await createBook(
      bookInput({
        title: "A Comic For The Nairs",
        categoryId: comics,
        ageGroup: "AGE_5_7",
        donorName: "Kavya Borthakur",
        donorFlat: "Z-9001",
        donatedOn: "2026-07-15",
      }),
    );
    await createBook(
      bookInput({
        title: "A Story From Another Flat",
        categoryId: stories,
        ageGroup: "AGE_12_16",
        donorName: "Ritu Phukan",
        donorFlat: "Y-8002",
        donatedOn: "2026-08-02",
      }),
    );
  });

  it("counts every book when nothing is chosen", async () => {
    await actingAs(librarian.id);
    const everything = await countBookLabels();

    expect(everything).toBe(await db.bookCopy.count({ where: { libraryId: fixture.libraryId } }));
    expect(everything).toBeGreaterThan(6);
  });

  it("narrows to one shelf", async () => {
    await actingAs(librarian.id);
    const onComics = await countBookLabels(filter({ categoryId: comics }));

    expect(onComics).toBe(1);
    expect(onComics).toBeLessThan(await countBookLabels());
  });

  it("narrows to a reading age", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(filter({ ageGroup: "AGE_5_7" }))).toBe(1);
    expect(await countBookLabels(filter({ ageGroup: "AGE_12_16" }))).toBe(1);
  });

  it("narrows to when a family gave the book, not when it was catalogued", async () => {
    await actingAs(librarian.id);

    // One donation in July, one on 2 August; both books were catalogued today.
    // A filter that quietly read created_at would answer nought to both.
    expect(
      await countBookLabels(filter({ donatedFrom: "2026-07-01", donatedTo: "2026-07-31" })),
    ).toBe(1);
    expect(
      await countBookLabels(filter({ donatedFrom: "2026-08-01", donatedTo: "2026-08-05" })),
    ).toBe(1);
    expect(
      await countBookLabels(filter({ donatedFrom: "2026-07-01", donatedTo: "2026-08-05" })),
    ).toBe(2);
  });

  it("counts a donation on the first and last day of the range", async () => {
    await actingAs(librarian.id);
    expect(
      await countBookLabels(filter({ donatedFrom: "2026-07-15", donatedTo: "2026-07-15" })),
    ).toBe(1);
  });

  it("narrows to a family by name, partly typed and in any case", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(filter({ donorName: "borthakur" }))).toBe(1);
    expect(await countBookLabels(filter({ donorName: "KAVYA" }))).toBe(1);
    expect(await countBookLabels(filter({ donorName: "Nobody Here" }))).toBe(0);
  });

  it("narrows to a flat", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(filter({ donorFlat: "Z-9001" }))).toBe(1);
    expect(await countBookLabels(filter({ donorFlat: "Y-8002" }))).toBe(1);
  });

  it("leaves out books nobody gave when a donor is asked about", async () => {
    await actingAs(librarian.id);
    // Most of the fixture was bought. A donor question is about given books.
    expect(await countBookLabels(filter({ donorName: "a" }))).toBeLessThan(
      await countBookLabels(),
    );
  });

  it("does not let a typed percent sign match the whole register", async () => {
    await actingAs(librarian.id);
    expect(await countBookLabels(filter({ donorName: "%" }))).toBe(0);
    expect(await countBookLabels(filter({ donorFlat: "%" }))).toBe(0);
  });

  it("narrows to a run of book IDs", async () => {
    await actingAs(librarian.id);
    const all = await db.bookCopy.findMany({
      where: { libraryId: fixture.libraryId },
      select: { copyCode: true },
      orderBy: { copyCode: "asc" },
    });
    const number = (code: string) => Number.parseInt(/(\d+)$/.exec(code)![1], 10);
    const first = number(all[0].copyCode);
    const third = number(all[2].copyCode);

    expect(await countBookLabels(filter({ codeFrom: String(first), codeTo: String(third) }))).toBe(3);
    expect(await countBookLabels(filter({ codeFrom: all[0].copyCode, codeTo: all[2].copyCode }))).toBe(3);
    expect(await countBookLabels(filter({ codeFrom: String(first), codeTo: String(first) }))).toBe(1);
  });

  it("prints the sheet the filter describes, and says so in its footer", async () => {
    await actingAs(librarian.id);
    const file = await printBookLabels({
      filter: filter({ donorFlat: "Z-9001" }),
      size: "standard",
      cutGuides: false,
      selectedIds: [],
    });

    expect(file.labelCount).toBe(1);
    const text = drawnText(file.bytes);
    expect(text).toContain("A Comic For The Nairs");
    expect(text).toContain("Z-9001");
    expect(text).not.toContain("A Story From Another Flat");
  });

  it("keeps what was typed about a family out of the audit log", async () => {
    await actingAs(librarian.id);
    await printBookLabels({
      filter: filter({ donorName: "Kavya Borthakur", donorFlat: "Z-9001" }),
      size: "standard",
      cutGuides: false,
      selectedIds: [],
    });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { libraryId: fixture.libraryId, action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED },
      orderBy: { occurredAt: "desc" },
    });

    const serialised = JSON.stringify(entry.metadata);
    // Which filters were used, never what was typed into them. The log must not
    // become the place that records who went looking for which family.
    expect(serialised).toContain("donor");
    expect(serialised).not.toContain("Kavya");
    expect(serialised).not.toContain("Z-9001");
  });
});
