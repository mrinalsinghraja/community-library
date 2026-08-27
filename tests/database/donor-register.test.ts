import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import {
  archiveBook,
  createBook,
  updateBook,
  type BookInput,
} from "@/server/services/catalogue-service";
import { getAuthorizedMedia, storeBookCover } from "@/server/services/media-service";
import { getDonorGifts, listDonorRegister } from "@/server/services/donor-service";

import { FakeStorageDriver, pngBytes } from "./fake-storage";
import {
  createLibraryFixture,
  createStaff,
  db,
  defaultCategory,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * The donor register, against a real database.
 *
 * Two things are being defended here, and only one of them is a feature.
 *
 * The feature is what the owner asked for: who gave, which flat, how many
 * books, and a page per family listing them.
 *
 * The other is the donor's own choice, which is not the owner's to override and
 * not something a later template change may quietly undo. Most of the tests
 * below are that: a family who asked for the flat alone must not have their
 * name reach the page in any field, and a family who asked to stay out of it
 * must have no row, no id and no page -- not a hidden one, not an empty one.
 *
 * And one property that is easy to lose by accident: this page must work
 * SIGNED OUT. Every test here that reads the register does so with no session
 * at all, so a stray `requireActor` anywhere in the path fails the suite rather
 * than shipping a thank-you page that asks a stranger to sign in first.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let categoryId: string;
const storageDriver = new FakeStorageDriver();

async function actingAsLibrarian() {
  __setSessionHandle(await createSession(librarian.id, "STAFF"));
}

/** Signed out, which is how every read in this file is made. */
function signOut() {
  __setSessionHandle(null);
}

async function addBook(overrides: Partial<BookInput> = {}) {
  await actingAsLibrarian();
  const created = await createBook({
    title: "The Jungle Book",
    author: "Rudyard Kipling",
    categoryId,
    ageGroup: "AGE_8_11",
    condition: "GOOD",
    status: "AVAILABLE",
    donorName: "Anita Sharma",
    donorFlat: "B704",
    donatedOn: "",
    coverMediaId: "",
    ...overrides,
  });
  signOut();
  return created;
}

/** The consent is set at intake by the librarian; the form defaults to NAMED. */
async function setConsent(copyId: string, consent: "APARTMENT_ONLY" | "ANONYMOUS") {
  await db.donation.update({ where: { copyId }, data: { displayConsent: consent } });
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  categoryId = (await defaultCategory(fixture.libraryId)).id;
  __setStorageDriverForTests(storageDriver);
});

beforeEach(async () => {
  storageDriver.reset();
  await db.donation.deleteMany({});
  await db.bookCopy.deleteMany({});
  await db.bookTitle.deleteMany({});
  await db.mediaObject.deleteMany({});
  // Each block starts with an empty log, so "the audit row for this donation"
  // means this one rather than whichever test ran first.
  await db.auditLog.deleteMany({});
  await db.codeSequence.updateMany({
    where: { libraryId: fixture.libraryId, kind: "BOOK_COPY" },
    data: { nextValue: 1 },
  });
});

afterEach(() => {
  signOut();
});

afterAll(async () => {
  __setStorageDriverForTests(null);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------

describe("reading the register", () => {
  it("is readable with no session at all", async () => {
    await addBook();

    // No `actingAs` anywhere. A visitor deciding whether to give a book has no
    // account, and this page exists for them.
    const register = await listDonorRegister();

    expect(register.entries).toHaveLength(1);
    expect(register.entries[0]).toMatchObject({ name: "Anita Sharma", apartment: "B704" });
  });

  it("gives each family one row and counts their books", async () => {
    await addBook({ title: "One" });
    await addBook({ title: "Two" });
    await addBook({ title: "Three", donorName: "The Iyer family", donorFlat: "B204" });

    const { entries } = await listDonorRegister();

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.name, entry.bookCount])).toEqual([
      ["Anita Sharma", 2],
      ["The Iyer family", 1],
    ]);
  });

  it("sorts alphabetically and never by how many", async () => {
    // Zoya gives four, Aarav gives one. Alphabetical order puts Aarav first;
    // any ordering that reads as a league table puts Zoya there.
    await addBook({ title: "A", donorName: "Aarav", donorFlat: "A101" });
    for (const title of ["B", "C", "D", "E"]) {
      await addBook({ title, donorName: "Zoya", donorFlat: "Z909" });
    }

    const { entries } = await listDonorRegister();

    expect(entries.map((entry) => entry.label)).toEqual(["Aarav", "Zoya"]);
    expect(entries[0].bookCount).toBe(1);
    expect(entries[1].bookCount).toBe(4);
  });

  it("treats one family written two ways as one family", async () => {
    await addBook({ title: "One", donorName: "The Iyer family", donorFlat: "B204" });
    await addBook({ title: "Two", donorName: "the iyer family ", donorFlat: " b204" });

    const { entries } = await listDonorRegister();

    expect(entries).toHaveLength(1);
    expect(entries[0].bookCount).toBe(2);
    // The spelling shown is the one the library wrote first, not the sloppy one.
    expect(entries[0].name).toBe("The Iyer family");
  });

  it("keeps thanking a family whose book has been archived", async () => {
    const created = await addBook();

    await actingAsLibrarian();
    await archiveBook(created.copyId, "fell apart");
    signOut();

    // The book has left the shelf. The gift still happened, and so does the
    // thank-you.
    const { entries } = await listDonorRegister();
    expect(entries).toHaveLength(1);
    expect(entries[0].bookCount).toBe(1);
  });

  it("has nothing to say before the first gift", async () => {
    expect(await listDonorRegister()).toEqual({ entries: [], anonymousDonors: 0 });
  });
});

// ---------------------------------------------------------------------------

describe("the donor's own choice", () => {
  it("prints the flat and never the name when the family asked for the flat alone", async () => {
    const created = await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });
    await setConsent(created.copyId, "APARTMENT_ONLY");

    const { entries } = await listDonorRegister();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBeNull();
    expect(entries[0].apartment).toBe("B704");
    // Named by their flat, so two flat-only families are two rows a reader can
    // tell apart -- and so the order on screen matches the words on screen.
    expect(entries[0].label).toBe("The family in B704");
    // Not merely hidden by the page: the name never leaves the service, so no
    // template, no export and no serialisation can put it back.
    expect(JSON.stringify(entries[0])).not.toContain("Anita");
  });

  it("still opens a page for a flat-only family, with the name absent there too", async () => {
    const created = await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });
    await setConsent(created.copyId, "APARTMENT_ONLY");

    const { entries } = await listDonorRegister();
    const detail = await getDonorGifts(entries[0].id);

    expect(detail.entry.name).toBeNull();
    expect(detail.entry.apartment).toBe("B704");
    expect(detail.gifts).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("Anita");
  });

  it("gives an anonymous family no row, no name and no flat", async () => {
    const created = await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });
    await setConsent(created.copyId, "ANONYMOUS");

    const register = await listDonorRegister();

    expect(register.entries).toEqual([]);
    expect(register.anonymousDonors).toBe(1);
    expect(JSON.stringify(register)).not.toContain("Anita");
    expect(JSON.stringify(register)).not.toContain("B704");
  });

  it("counts anonymous families, not anonymous books", async () => {
    for (const title of ["One", "Two", "Three"]) {
      const created = await addBook({ title, donorName: "Anita Sharma", donorFlat: "B704" });
      await setConsent(created.copyId, "ANONYMOUS");
    }
    const other = await addBook({ title: "Four", donorName: "Zoya", donorFlat: "Z909" });
    await setConsent(other.copyId, "ANONYMOUS");

    // Four books, two families. Publishing "4" would say more about how much
    // one household gave than the page is allowed to.
    expect((await listDonorRegister()).anonymousDonors).toBe(2);
  });

  it("splits a family who chose differently on different days", async () => {
    await addBook({ title: "One", donorName: "Anita Sharma", donorFlat: "B704" });
    const second = await addBook({ title: "Two", donorName: "Anita Sharma", donorFlat: "B704" });
    await setConsent(second.copyId, "ANONYMOUS");

    const register = await listDonorRegister();

    // The choice belongs to the gift, not to the household. One book is
    // credited because they asked for that, and one is not because they asked
    // for that too.
    expect(register.entries).toHaveLength(1);
    expect(register.entries[0].bookCount).toBe(1);
    expect(register.anonymousDonors).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("one family's page", () => {
  it("lists their books, oldest gift first", async () => {
    const first = await addBook({ title: "Given first" });
    await addBook({ title: "Given later" });

    // Backdate the first gift so the ordering is a real one rather than an
    // accident of insertion order.
    await db.donation.update({
      where: { copyId: first.copyId },
      data: { donatedAt: new Date("2026-01-04T06:00:00Z") },
    });

    const { entries } = await listDonorRegister();
    const { entry, gifts } = await getDonorGifts(entries[0].id);

    expect(entry.bookCount).toBe(2);
    expect(gifts.map((gift) => gift.title)).toEqual(["Given first", "Given later"]);
    expect(gifts[0].authors).toEqual(["Rudyard Kipling"]);
    expect(gifts[0].givenAt.toISOString()).toBe("2026-01-04T06:00:00.000Z");
  });

  it("shows one family's gifts and not another's", async () => {
    await addBook({ title: "Hers", donorName: "Anita Sharma", donorFlat: "B704" });
    await addBook({ title: "Theirs", donorName: "The Iyer family", donorFlat: "B204" });

    const { entries } = await listDonorRegister();
    const anita = entries.find((entry) => entry.name === "Anita Sharma");

    const { gifts } = await getDonorGifts(anita!.id);
    expect(gifts.map((gift) => gift.title)).toEqual(["Hers"]);
  });

  it("refuses an id that was never real", async () => {
    await addBook();

    await expect(getDonorGifts("0123456789abcdef")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("has no page for an anonymous family, however the id is arrived at", async () => {
    const created = await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });

    // Take the id while the gift is still credited, then honour a family who
    // changes their mind: the link they were given must stop working.
    const { entries } = await listDonorRegister();
    const id = entries[0].id;
    await setConsent(created.copyId, "ANONYMOUS");

    await expect(getDonorGifts(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("identifies a family by a hash, never by their name or flat", async () => {
    await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });

    const { entries } = await listDonorRegister();
    const id = entries[0].id;

    // The id ends up in the address bar, in server logs and in the browser
    // history of whatever device opened it. None of those agreed to hold a
    // neighbour's name and flat number.
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id.toLowerCase()).not.toContain("anita");
    expect(id.toLowerCase()).not.toContain("b704");
  });

  it("gives the same family the same link every time it is asked", async () => {
    await addBook({ title: "One" });
    const before = (await listDonorRegister()).entries[0].id;

    await addBook({ title: "Two" });
    const after = (await listDonorRegister()).entries[0].id;

    // Nothing stores this id, so a bookmark only keeps working if it is derived
    // the same way on every request.
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe("the year a family gave", () => {
  it("carries one year, and a span when there is more than one", async () => {
    const first = await addBook({ title: "One" });
    const second = await addBook({ title: "Two" });

    await db.donation.update({
      where: { copyId: first.copyId },
      data: { donatedAt: new Date("2024-06-01T06:00:00Z") },
    });
    await db.donation.update({
      where: { copyId: second.copyId },
      data: { donatedAt: new Date("2026-02-01T06:00:00Z") },
    });

    const { entries } = await listDonorRegister();
    expect(entries[0].firstYear).toBe(2024);
    expect(entries[0].lastYear).toBe(2026);
  });

  it("separates two households who lived in the same flat", async () => {
    /*
     * The reason the column exists. Flats get rented, so B704 in 2023 and B704
     * in 2026 are usually two different families -- and a register that shows
     * only the flat reads them as one entry that grew.
     */
    const older = await addBook({ title: "Old", donorName: "Ravi Menon", donorFlat: "B704" });
    const newer = await addBook({ title: "New", donorName: "Farida Sheikh", donorFlat: "B704" });

    await db.donation.update({
      where: { copyId: older.copyId },
      data: { donatedAt: new Date("2023-04-01T06:00:00Z") },
    });
    await db.donation.update({
      where: { copyId: newer.copyId },
      data: { donatedAt: new Date("2026-04-01T06:00:00Z") },
    });

    const { entries } = await listDonorRegister();

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.apartment, entry.firstYear])).toEqual([
      ["B704", 2026],
      ["B704", 2023],
    ]);
  });

  it("reads the year off the library's calendar, not the server's", async () => {
    const created = await addBook();
    // 31 December 2025, 20:00 UTC — already 1 January 2026 in Asia/Kolkata.
    await db.donation.update({
      where: { copyId: created.copyId },
      data: { donatedAt: new Date("2025-12-31T20:00:00Z") },
    });

    const { entries } = await listDonorRegister();
    expect(entries[0].firstYear).toBe(2026);
  });
});

// ---------------------------------------------------------------------------

describe("covers on a public donor page", () => {
  /** Uploads a cover and hangs it on the title this copy belongs to. */
  async function giveCoverTo(copyId: string): Promise<string> {
    const stored = await storeBookCover({ libraryId: fixture.libraryId, bytes: pngBytes() });
    const copy = await db.bookCopy.findUniqueOrThrow({
      where: { id: copyId },
      select: { titleId: true },
    });
    await db.mediaObject.update({
      where: { id: stored.mediaId },
      data: { pendingDeletionAt: null },
    });
    await db.bookTitle.update({
      where: { id: copy.titleId },
      data: { coverMediaId: stored.mediaId },
    });
    return stored.mediaId;
  }

  it("shows the jacket of a book that is credited on the register", async () => {
    const created = await addBook();
    const coverId = await giveCoverTo(created.copyId);

    // Signed out, with the catalogue still member-only. The title and author
    // are already printed on that family's page; the jacket adds no fact about
    // the collection that the page did not already state.
    await expect(getAuthorizedMedia(coverId)).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("still refuses the jacket of a book nobody gave", async () => {
    const bought = await addBook({ title: "Bought", donorName: "" });
    const coverId = await giveCoverTo(bought.copyId);

    // The catalogue did not open. A book the library bought has no donor page
    // to appear on, so a signed-out request for its cover is refused exactly as
    // it was before.
    await expect(getAuthorizedMedia(coverId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses the jacket of a book given anonymously", async () => {
    const created = await addBook();
    await setConsent(created.copyId, "ANONYMOUS");
    const coverId = await giveCoverTo(created.copyId);

    // An anonymous family has no page, so their books are on nobody's, so their
    // covers stay behind the front door with the rest of the shelf.
    await expect(getAuthorizedMedia(coverId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a signed-in member read any cover, as before", async () => {
    const bought = await addBook({ title: "Bought", donorName: "" });
    const coverId = await giveCoverTo(bought.copyId);

    __setSessionHandle(await createSession(librarian.id, "STAFF"));
    await expect(getAuthorizedMedia(coverId)).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("hands the cover id to the family's page", async () => {
    const created = await addBook();
    const coverId = await giveCoverTo(created.copyId);

    const { entries } = await listDonorRegister();
    const { gifts } = await getDonorGifts(entries[0].id);

    expect(gifts[0].coverMediaId).toBe(coverId);
  });
});

// ---------------------------------------------------------------------------

describe("the do-not-publish tick box", () => {
  it("publishes the name when nobody ticked it", async () => {
    // The default, and the wording at the desk says so. Asking every family to
    // opt in would leave the thank-you page empty.
    await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });

    const { entries } = await listDonorRegister();
    expect(entries[0].name).toBe("Anita Sharma");
  });

  it("keeps the name off the page when it is ticked", async () => {
    await addBook({ donorName: "Anita Sharma", donorFlat: "B704", donorAnonymous: true });

    const register = await listDonorRegister();

    expect(register.entries).toEqual([]);
    expect(register.anonymousDonors).toBe(1);
    // The librarian still knows who gave the book. The page does not.
    const donation = await db.donation.findFirstOrThrow({ select: { donorName: true } });
    expect(donation.donorName).toBe("Anita Sharma");
  });

  it("takes a family off the page when the box is ticked later", async () => {
    const created = await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });

    __setSessionHandle(await createSession(librarian.id, "STAFF"));
    await updateBook(created.copyId, {
      title: "The Jungle Book",
      author: "Rudyard Kipling",
      categoryId,
      ageGroup: "AGE_8_11",
      condition: "GOOD",
      status: "AVAILABLE",
      donorName: "Anita Sharma",
      donorFlat: "B704",
      donatedOn: "",
      coverMediaId: "",
      donorAnonymous: true,
    });
    signOut();

    const register = await listDonorRegister();
    expect(register.entries).toEqual([]);
    expect(register.anonymousDonors).toBe(1);
  });

  it("does not un-hide a flat-only family when the form is saved untouched", async () => {
    /*
     * The trap this closes. APARTMENT_ONLY is not offered by the tick box, so a
     * librarian opening the form to fix a spelling leaves the box unticked --
     * and if unticked meant "reset to the library default", that save would
     * publish a name the family asked to keep off the page.
     */
    const created = await addBook({ donorName: "Anita Sharma", donorFlat: "B704" });
    await setConsent(created.copyId, "APARTMENT_ONLY");

    __setSessionHandle(await createSession(librarian.id, "STAFF"));
    await updateBook(created.copyId, {
      title: "The Jungle Book",
      author: "Rudyard Kipling",
      categoryId,
      ageGroup: "AGE_8_11",
      condition: "GOOD",
      status: "AVAILABLE",
      donorName: "Anita Sharma",
      donorFlat: "B704",
      donatedOn: "",
      coverMediaId: "",
      donorAnonymous: false,
    });
    signOut();

    const { entries } = await listDonorRegister();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBeNull();
    expect(entries[0].apartment).toBe("B704");
  });

  it("never writes the raw name into the audit metadata as published", async () => {
    await addBook({ donorName: "Anita Sharma", donorFlat: "B704", donorAnonymous: true });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "donation.recorded" },
      select: { metadata: true },
    });

    // The librarian's record still names the donor — that is what it is for —
    // and it also records that the family asked to stay off the page.
    expect(JSON.stringify(audit.metadata)).toContain("Anita Sharma");
    expect(audit.metadata).toMatchObject({ anonymous: true });
  });
});
