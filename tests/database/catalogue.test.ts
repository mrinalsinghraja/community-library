import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import { storeChildPhoto } from "@/server/services/media-service";
import {
  archiveBook,
  browseCatalogue,
  createBook,
  donorAcknowledgement,
  getBookByCode,
  getBookForStaff,
  listBooksForStaff,
  listDonorCredits,
  removeBookCover,
  restoreBook,
  updateBook,
  type BookInput,
} from "@/server/services/catalogue-service";

import { FakeStorageDriver, elfBytes, pngBytes } from "./fake-storage";
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
 * The catalogue, against a real database and a recording object store.
 *
 * Four properties are under test throughout:
 *
 *   1. An invalid book cannot be created, whatever the caller sends. The
 *      dropdowns are a convenience; these are the rules.
 *   2. A reader can browse and a reader cannot manage. Hiding a button is not
 *      authorization, so every check here calls the service directly.
 *   3. A child can find a book by what they know about it — part of the title,
 *      part of the author, or the code on the label.
 *   4. Nothing is destroyed, and a donation is never turned into a score.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;
let categoryId: string;

const storageDriver = new FakeStorageDriver();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

function bookInput(overrides: Partial<BookInput> = {}): BookInput {
  return {
    title: "The Jungle Book",
    author: "Rudyard Kipling",
    categoryId,
    ageGroup: "AGE_8_10",
    condition: "GOOD",
    status: "AVAILABLE",
    donorName: "Mrinal",
    donorFlat: "P15",
    donatedOn: "",
    coverMediaId: "",
    ...overrides,
  };
}

/** Adds a book as the librarian, whoever the current test is acting as. */
async function addBook(overrides: Partial<BookInput> = {}) {
  await actingAs(librarian.id);
  return createBook(bookInput(overrides));
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  superAdmin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  reader = await createMember(fixture.libraryId);
  categoryId = (await defaultCategory(fixture.libraryId)).id;
  __setStorageDriverForTests(storageDriver);
});

beforeEach(async () => {
  storageDriver.reset();
  // Each block starts from an empty shelf, so a count assertion means what it
  // says rather than depending on which test ran first.
  await db.donation.deleteMany({});
  await db.bookCopy.deleteMany({});
  await db.bookTitle.deleteMany({});
  await db.mediaObject.deleteMany({});
  await db.codeSequence.updateMany({
    where: { libraryId: fixture.libraryId, kind: "BOOK_COPY" },
    data: { nextValue: 1 },
  });
});

afterEach(() => {
  __setSessionHandle(null);
});

afterAll(async () => {
  __setStorageDriverForTests(null);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------

describe("adding a book", () => {
  it("creates a title, a copy, a code and a donation from one form", async () => {
    const created = await addBook();

    expect(created.createdNewTitle).toBe(true);
    // Issued by the allocator, never typed by the librarian.
    expect(created.copyCode).toBe("TST-B0001");

    const copy = await db.bookCopy.findUniqueOrThrow({
      where: { id: created.copyId },
      include: { title: true, donation: true },
    });

    expect(copy.title.title).toBe("The Jungle Book");
    expect(copy.title.authors).toEqual(["Rudyard Kipling"]);
    expect(copy.title.ageGroup).toBe("AGE_8_10");
    expect(copy.status).toBe("AVAILABLE");
    expect(copy.condition).toBe("GOOD");
    expect(copy.donation?.donorName).toBe("Mrinal");
    expect(copy.donation?.donorApartment).toBe("P15");
  });

  it("gives a second copy of the same book its own code and shares the title", async () => {
    const first = await addBook();
    const second = await addBook();

    expect(second.createdNewTitle).toBe(false);
    expect(second.copyCode).not.toBe(first.copyCode);

    // One book, two physical objects — the distinction Phase 0 built the schema
    // around, and the reason a copy code is not a book id.
    expect(await db.bookTitle.count({ where: { libraryId: fixture.libraryId } })).toBe(1);
    expect(await db.bookCopy.count({ where: { libraryId: fixture.libraryId } })).toBe(2);
  });

  it("treats a different author as a different book, despite the same title", async () => {
    await addBook();
    const other = await addBook({ author: "Somebody Else" });

    expect(other.createdNewTitle).toBe(true);
    expect(await db.bookTitle.count({ where: { libraryId: fixture.libraryId } })).toBe(2);
  });

  it("refuses a book with no title", async () => {
    await actingAs(librarian.id);
    await expect(createBook(bookInput({ title: "   " }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await db.bookCopy.count()).toBe(0);
  });

  it("refuses a book with no author", async () => {
    await actingAs(librarian.id);
    await expect(createBook(bookInput({ author: "" }))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuses an unknown age group", async () => {
    await actingAs(librarian.id);
    await expect(
      createBook(bookInput({ ageGroup: "AGE_99" as BookInput["ageGroup"] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses an unknown condition", async () => {
    await actingAs(librarian.id);
    await expect(
      // "WORN" was a real value before Phase 2 and is not one now.
      createBook(bookInput({ condition: "WORN" as BookInput["condition"] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a status a librarian may not set by hand", async () => {
    await actingAs(librarian.id);
    // ARCHIVED is a real CopyStatus, but archiving is its own audited action
    // with its own reason — not a value somebody can pick from a list.
    await expect(
      createBook(bookInput({ status: "ARCHIVED" as BookInput["status"] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a category that is not this library's", async () => {
    const otherCategory = await db.bookCategory.create({
      data: {
        libraryId: (
          await db.library.create({
            data: {
              communityId: (
                await db.community.create({ data: { name: "Other", slug: "other-community" } })
              ).id,
              name: "Other Library",
              slug: "other-library",
            },
          })
        ).id,
        name: "Smuggled",
        slug: "smuggled",
      },
    });

    await actingAs(librarian.id);
    await expect(
      createBook(bookInput({ categoryId: otherCategory.id })),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await db.bookCategory.delete({ where: { id: otherCategory.id } });
  });

  it("refuses a retired category", async () => {
    const retired = await db.bookCategory.create({
      data: { libraryId: fixture.libraryId, name: "Retired", slug: "retired", isActive: false },
    });

    await actingAs(librarian.id);
    await expect(createBook(bookInput({ categoryId: retired.id }))).rejects.toMatchObject({
      code: "VALIDATION",
    });

    await db.bookCategory.delete({ where: { id: retired.id } });
  });

  it("gives concurrent cataloguing distinct book IDs", async () => {
    await actingAs(librarian.id);

    // Two librarians at the same desk. The allocator's single atomic UPDATE is
    // what makes this impossible to collide; a mock could not fail this test.
    const results = await Promise.all([
      createBook(bookInput({ title: "One" })),
      createBook(bookInput({ title: "Two" })),
      createBook(bookInput({ title: "Three" })),
      createBook(bookInput({ title: "Four" })),
      createBook(bookInput({ title: "Five" })),
    ]);

    const codes = results.map((result) => result.copyCode);
    expect(new Set(codes).size).toBe(5);
  });

  it("accepts a book with no donor at all", async () => {
    const created = await addBook({ donorName: "", donorFlat: "" });

    const copy = await db.bookCopy.findUniqueOrThrow({
      where: { id: created.copyId },
      include: { donation: true },
    });

    // Donation is voluntary, including on this form. A book the library bought
    // is a book, and nothing about it depends on somebody having given it.
    expect(copy.donation).toBeNull();
    expect(copy.acquisitionType).toBe("PURCHASE");
  });

  it("refuses a donation date in the future", async () => {
    await actingAs(librarian.id);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    await expect(
      createBook(bookInput({ donatedOn: nextYear.toISOString().slice(0, 10) })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("writes an audit row naming the copy, the title and the donation", async () => {
    const created = await addBook();

    const actions = (
      await db.auditLog.findMany({
        where: { libraryId: fixture.libraryId, entityId: created.copyId },
        select: { action: true },
      })
    ).map((row) => row.action);

    expect(actions).toContain(AUDIT_ACTIONS.BOOK_COPY_CREATED);
    expect(actions).toContain(AUDIT_ACTIONS.DONATION_RECORDED);
  });
});

// ---------------------------------------------------------------------------

describe("who may manage the catalogue", () => {
  it("lets a Super Admin add a book", async () => {
    await actingAs(superAdmin.id);
    await expect(createBook(bookInput())).resolves.toMatchObject({ copyCode: "TST-B0001" });
  });

  it("refuses a member creating a book", async () => {
    await actingAs(reader.id, "MEMBER");
    await expect(createBook(bookInput())).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("refuses a member editing a book", async () => {
    const created = await addBook();

    await actingAs(reader.id, "MEMBER");
    await expect(updateBook(created.copyId, bookInput())).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("refuses a member changing a book's status", async () => {
    const created = await addBook();

    await actingAs(reader.id, "MEMBER");
    await expect(
      updateBook(created.copyId, bookInput({ status: "LOST" })),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: created.copyId } });
    expect(copy.status).toBe("AVAILABLE");
  });

  it("refuses a member changing donor information", async () => {
    const created = await addBook();

    await actingAs(reader.id, "MEMBER");
    await expect(
      updateBook(created.copyId, bookInput({ donorName: "Not Me" })),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    const donation = await db.donation.findUniqueOrThrow({ where: { copyId: created.copyId } });
    expect(donation.donorName).toBe("Mrinal");
  });

  it("refuses a member archiving a book", async () => {
    const created = await addBook();

    await actingAs(reader.id, "MEMBER");
    await expect(archiveBook(created.copyId)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("refuses a member reaching the librarian's book list", async () => {
    await addBook();

    /*
     * The important one. Every reader holds `book.view` — that is what lets a
     * child browse — so the desk screens must be guarded by a permission only
     * somebody managing the collection has. Guarding them with book.view would
     * hand any nine-year-old the donor names and condition notes.
     */
    await actingAs(reader.id, "MEMBER");
    await expect(listBooksForStaff()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(getBookForStaff("anything")).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("lets a librarian manage books", async () => {
    const created = await addBook();

    await actingAs(librarian.id);
    await expect(listBooksForStaff()).resolves.toMatchObject({ total: 1 });
    await expect(updateBook(created.copyId, bookInput({ condition: "FAIR" }))).resolves.toBeUndefined();
    await expect(archiveBook(created.copyId, "fell apart")).resolves.toBeUndefined();
  });

  it("refuses a signed-out visitor browsing a member-only catalogue", async () => {
    await addBook();

    __setSessionHandle(null);
    // MEMBER_ONLY is the configured default for this deployment.
    await expect(browseCatalogue()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    await expect(getBookByCode("TST-B0001")).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });

  it("refuses a book copy id belonging to another library", async () => {
    const created = await addBook();

    // Same shape as every other cross-tenant probe in this system: not found,
    // never "forbidden", so the answer cannot confirm the id is real.
    await actingAs(librarian.id);
    await db.bookCopy.update({
      where: { id: created.copyId },
      data: { libraryId: (await db.library.findFirstOrThrow({ where: { slug: "other-library" } })).id },
    });

    await expect(getBookForStaff(created.copyId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------

describe("searching", () => {
  beforeEach(async () => {
    await addBook({ title: "The Jungle Book", author: "Rudyard Kipling" });
    await addBook({ title: "Matilda", author: "Roald Dahl" });
    await addBook({ title: "Charlie and the Chocolate Factory", author: "Roald Dahl" });
    await actingAs(reader.id, "MEMBER");
  });

  it("finds a book by part of its title", async () => {
    const result = await browseCatalogue({ search: "jungle" });
    expect(result.items.map((book) => book.title)).toEqual(["The Jungle Book"]);
  });

  it("ignores case", async () => {
    const upper = await browseCatalogue({ search: "JUNGLE" });
    const lower = await browseCatalogue({ search: "jungle" });
    expect(upper.total).toBe(1);
    expect(lower.total).toBe(1);
  });

  it("finds books by part of the author's name", async () => {
    const result = await browseCatalogue({ search: "dahl" });
    expect(result.total).toBe(2);
  });

  it("finds a book by its book ID", async () => {
    const result = await browseCatalogue({ search: "tst-b0001" });
    expect(result.total).toBe(1);
  });

  /*
   * Books used to be labelled in the readers' namespace. The old label must not
   * quietly keep working, or two strings would name the same book and the
   * separation would exist only on paper.
   */
  it("does not find a book by the code it used to carry", async () => {
    const result = await browseCatalogue({ search: "TST-R0001" });
    expect(result.total).toBe(0);
  });

  it("does not search donor names", async () => {
    // Every book above was donated by "Mrinal". A donor's name is a thank-you,
    // not a search key — nobody enumerates the catalogue by who lives where.
    const result = await browseCatalogue({ search: "Mrinal" });
    expect(result.total).toBe(0);
  });

  it("treats a wildcard as a literal character", async () => {
    // "%" would otherwise match the entire catalogue.
    const result = await browseCatalogue({ search: "%" });
    expect(result.total).toBe(0);
  });

  it("returns nothing rather than everything for an unmatched search", async () => {
    const result = await browseCatalogue({ search: "zzzzzz" });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("filtering", () => {
  let comicsId: string;

  beforeEach(async () => {
    comicsId = (
      await db.bookCategory.findUniqueOrThrow({
        where: { libraryId_slug: { libraryId: fixture.libraryId, slug: "comics" } },
      })
    ).id;

    await addBook({ title: "Story One", ageGroup: "AGE_5_7", condition: "GOOD", status: "AVAILABLE" });
    // Not BORROWED, which stopped being a status a form can set when Phase 3
    // gave circulation ownership of it. DAMAGED is the nearest thing this test
    // needs: a second, distinguishable status a librarian still chooses.
    await addBook({
      title: "Comic One",
      categoryId: comicsId,
      ageGroup: "AGE_11_14",
      condition: "FAIR",
      status: "DAMAGED",
    });
  });

  it("filters by shelf", async () => {
    await actingAs(reader.id, "MEMBER");
    const result = await browseCatalogue({ categoryId: comicsId });
    expect(result.items.map((book) => book.title)).toEqual(["Comic One"]);
  });

  it("filters by reading age", async () => {
    await actingAs(reader.id, "MEMBER");
    const result = await browseCatalogue({ ageGroup: "AGE_5_7" });
    expect(result.items.map((book) => book.title)).toEqual(["Story One"]);
  });

  it("filters by condition, for staff", async () => {
    await actingAs(librarian.id);
    const result = await listBooksForStaff({ condition: "FAIR" });
    expect(result.items.map((book) => book.title)).toEqual(["Comic One"]);
  });

  it("filters by status, for staff", async () => {
    await actingAs(librarian.id);
    const result = await listBooksForStaff({ status: "DAMAGED" });
    expect(result.items.map((book) => book.title)).toEqual(["Comic One"]);
  });

  it("pages without losing anybody", async () => {
    await actingAs(reader.id, "MEMBER");
    const first = await browseCatalogue({ pageSize: 1, page: 1 });
    const second = await browseCatalogue({ pageSize: 1, page: 2 });

    expect(first.pageCount).toBe(2);
    expect(first.items[0].code).not.toBe(second.items[0].code);
  });

  it("clamps a page number past the end instead of showing nothing", async () => {
    await actingAs(reader.id, "MEMBER");
    const result = await browseCatalogue({ pageSize: 1, page: 99 });

    // A filter change can strand somebody on page 7 of a 2-page result.
    expect(result.page).toBe(2);
    expect(result.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("cover pictures", () => {
  it("stores a valid cover and attaches it to the book", async () => {
    await actingAs(librarian.id);
    const cover = await db.mediaObject.findFirst({ where: { purpose: "book_cover" } });
    expect(cover).toBeNull();

    const created = await createBook(
      bookInput({ coverMediaId: await uploadCover() }),
    );

    const copy = await db.bookCopy.findUniqueOrThrow({
      where: { id: created.copyId },
      include: { title: { include: { coverMedia: true } } },
    });

    expect(copy.title.coverMedia).not.toBeNull();
    // Never a public URL, even though a book jacket is not sensitive: the
    // catalogue is member-only and a CDN link would be a way around the door.
    expect(copy.title.coverMedia?.publicUrl).toBeNull();
    expect(copy.title.coverMedia?.visibility).toBe("PRIVATE");
    // Claimed in the same transaction that linked it.
    expect(copy.title.coverMedia?.pendingDeletionAt).toBeNull();
  });

  it("refuses an executable renamed as a picture", async () => {
    await actingAs(librarian.id);
    await expect(
      uploadCover(elfBytes()),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(storageDriver.objects.size).toBe(0);
  });

  it("refuses an oversized picture without storing it", async () => {
    await actingAs(librarian.id);
    await expect(uploadCover(pngBytes(6 * 1024 * 1024))).rejects.toMatchObject({
      code: "VALIDATION",
    });

    expect(storageDriver.objects.size).toBe(0);
  });

  it("refuses to attach a child's photograph as a book cover", async () => {
    /*
     * The attack this guards: post a book form carrying a *child photograph's*
     * media id, and have a private picture of a child appear on a catalogue
     * page every member can see. The claim is scoped by purpose, so the id
     * simply does not resolve.
     */
    const childPhoto = await storeChildPhoto({
      libraryId: fixture.libraryId,
      bytes: pngBytes(),
    });

    await actingAs(librarian.id);
    await expect(
      createBook(bookInput({ coverMediaId: childPhoto.mediaId })),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // And nothing was created on the way to being refused.
    expect(await db.bookCopy.count()).toBe(0);
  });

  it("removes a cover and its bytes", async () => {
    await actingAs(librarian.id);
    const created = await createBook(bookInput({ coverMediaId: await uploadCover() }));

    expect(storageDriver.objects.size).toBe(1);

    await removeBookCover(created.copyId);

    expect(storageDriver.objects.size).toBe(0);
    expect(await db.mediaObject.count({ where: { purpose: "book_cover" } })).toBe(0);

    const copy = await db.bookCopy.findUniqueOrThrow({
      where: { id: created.copyId },
      include: { title: true },
    });
    expect(copy.title.coverMediaId).toBeNull();
  });

  it("replaces a cover, leaving no orphan behind", async () => {
    await actingAs(librarian.id);
    const created = await createBook(bookInput({ coverMediaId: await uploadCover() }));

    await updateBook(created.copyId, bookInput({ coverMediaId: await uploadCover() }));

    // Exactly one object on disk and one row: the old bytes went with the row.
    expect(storageDriver.objects.size).toBe(1);
    expect(await db.mediaObject.count({ where: { purpose: "book_cover" } })).toBe(1);
  });
});

/** Uploads a cover the way the action does, returning its unclaimed media id. */
async function uploadCover(bytes: Uint8Array = pngBytes()): Promise<string> {
  const { storeBookCover } = await import("@/server/services/media-service");
  const stored = await storeBookCover({ libraryId: fixture.libraryId, bytes });
  return stored.mediaId;
}

// ---------------------------------------------------------------------------

describe("donors", () => {
  it("renders a named credit with the flat number", () => {
    expect(
      donorAcknowledgement({
        donorName: "Mrinal",
        donorApartment: "P15",
        displayConsent: "NAMED",
      }),
    ).toBe("📚 Donated by Mrinal from P15");
  });

  it("hides the name when the donor asked for apartment only", () => {
    const credit = donorAcknowledgement({
      donorName: "Mrinal",
      donorApartment: "P15",
      displayConsent: "APARTMENT_ONLY",
    });

    expect(credit).toBe("📚 Donated by a family in P15");
    expect(credit).not.toContain("Mrinal");
  });

  it("hides both when the donor asked to stay anonymous, and still says thank you", () => {
    const credit = donorAcknowledgement({
      donorName: "Mrinal",
      donorApartment: "P15",
      displayConsent: "ANONYMOUS",
    });

    expect(credit).toBe("📚 Donated by a neighbour");
    expect(credit).not.toContain("Mrinal");
    expect(credit).not.toContain("P15");
  });

  it("does not open a book at a reader's card number", async () => {
    await addBook();
    await actingAs(reader.id, "MEMBER");

    // Same number, other namespace: /books/TST-R0001 is not this book's page.
    await expect(getBookByCode("TST-R0001")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getBookByCode("TST-B0001")).resolves.toBeTruthy();
  });

  it("puts the acknowledgement on the book's page and nowhere on the card", async () => {
    await addBook();
    await actingAs(reader.id, "MEMBER");

    const detail = await getBookByCode("TST-B0001");
    expect(detail.donorAcknowledgement).toBe("📚 Donated by Mrinal from P15");

    // The browse card has no donor field at all, so no template change can put
    // one on a tile by accident.
    const browse = await browseCatalogue();
    expect(Object.keys(browse.items[0])).not.toContain("donorName");
    expect(JSON.stringify(browse.items[0])).not.toContain("Mrinal");
  });

  it("thanks each family once, and counts nothing", async () => {
    await addBook({ title: "One" });
    await addBook({ title: "Two" });
    await addBook({ title: "Three", donorName: "The Iyer family", donorFlat: "B204" });

    await actingAs(reader.id, "MEMBER");
    const credits = await listDonorCredits();

    // Three books, two families, two thank-yous. A family who gave two books
    // appears exactly as a family who gave one.
    expect(credits).toHaveLength(2);

    /*
     * And there is nothing to rank them by. Each credit carries exactly one
     * field — the sentence to render — so no template can accidentally print a
     * total, and no "sort by generosity" can be added without first adding a
     * number that deliberately does not exist. Gratitude, not competition.
     */
    for (const credit of credits) {
      expect(Object.keys(credit)).toEqual(["acknowledgement"]);
    }
  });

  it("keeps thanking a donor whose book has been archived", async () => {
    const created = await addBook();
    await actingAs(librarian.id);
    await archiveBook(created.copyId, "fell apart");

    await actingAs(reader.id, "MEMBER");
    // The book is gone from the shelf. The gift still happened.
    expect(await listDonorCredits()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("archiving instead of deleting", () => {
  it("takes the book off the reader's shelf but keeps every record", async () => {
    const created = await addBook();

    await actingAs(librarian.id);
    await archiveBook(created.copyId, "fell apart");

    const copy = await db.bookCopy.findUniqueOrThrow({
      where: { id: created.copyId },
      include: { donation: true },
    });

    expect(copy.status).toBe("ARCHIVED");
    expect(copy.archivedAt).not.toBeNull();
    // The code, the donation and the history all survive. Somebody gave that
    // book, and there is no delete anywhere in this catalogue.
    expect(copy.copyCode).toBe("TST-B0001");
    expect(copy.donation?.donorName).toBe("Mrinal");

    await actingAs(reader.id, "MEMBER");
    expect((await browseCatalogue()).total).toBe(0);
    await expect(getBookByCode("TST-B0001")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps an archived book out of the staff list until it is asked for", async () => {
    const created = await addBook();
    await actingAs(librarian.id);
    await archiveBook(created.copyId);

    expect((await listBooksForStaff()).total).toBe(0);
    expect((await listBooksForStaff({ includeArchived: true })).total).toBe(1);
  });

  it("refuses to edit an archived book", async () => {
    const created = await addBook();
    await actingAs(librarian.id);
    await archiveBook(created.copyId);

    await expect(updateBook(created.copyId, bookInput())).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("puts an archived book back on the shelf", async () => {
    const created = await addBook();
    await actingAs(librarian.id);
    await archiveBook(created.copyId);
    await restoreBook(created.copyId);

    const copy = await db.bookCopy.findUniqueOrThrow({ where: { id: created.copyId } });
    expect(copy.status).toBe("AVAILABLE");
    // The CHECK constraint requires status and archived_at to agree in both
    // directions, so a restore that forgot the timestamp would fail here.
    expect(copy.archivedAt).toBeNull();
  });

  it("records who archived it and why", async () => {
    const created = await addBook();
    await actingAs(librarian.id);
    await archiveBook(created.copyId, "spine fell off");

    const row = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.BOOK_COPY_ARCHIVED, entityId: created.copyId },
    });

    expect(row.actorUserId).toBe(librarian.id);
    expect(row.metadata).toMatchObject({ reason: "spine fell off", copyCode: "TST-B0001" });
  });
});

// ---------------------------------------------------------------------------

describe("editing", () => {
  it("records a status change and a condition change separately", async () => {
    const created = await addBook();

    await actingAs(librarian.id);
    await updateBook(created.copyId, bookInput({ status: "LOST", condition: "DAMAGED" }));

    const actions = (
      await db.auditLog.findMany({
        where: { entityId: created.copyId },
        select: { action: true },
      })
    ).map((row) => row.action);

    expect(actions).toContain(AUDIT_ACTIONS.BOOK_COPY_STATUS_CHANGED);
    expect(actions).toContain(AUDIT_ACTIONS.BOOK_COPY_CONDITION_CHANGED);
  });

  it("changes title-level fields for every copy of that book", async () => {
    const first = await addBook();
    const second = await addBook();

    await actingAs(librarian.id);
    await updateBook(first.copyId, bookInput({ ageGroup: "AGE_11_14" }));

    const other = await getBookForStaff(second.copyId);
    // Correct, and the reason the edit screen says so out loud: the reading age
    // belongs to the book, not to one object on the shelf.
    expect(other.ageGroup).toBe("AGE_11_14");
  });

  it("removes the donation when the donor name is cleared", async () => {
    const created = await addBook();

    await actingAs(librarian.id);
    await updateBook(created.copyId, bookInput({ donorName: "", donorFlat: "" }));

    expect(await db.donation.findUnique({ where: { copyId: created.copyId } })).toBeNull();
    // What was there is still in the log.
    const row = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.DONATION_UPDATED, entityId: created.copyId },
    });
    expect(row.metadata).toMatchObject({ removed: true, previousDonorName: "Mrinal" });
  });
});
