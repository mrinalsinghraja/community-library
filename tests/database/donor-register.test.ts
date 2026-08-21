import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { archiveBook, createBook, type BookInput } from "@/server/services/catalogue-service";
import { getDonorGifts, listDonorRegister } from "@/server/services/donor-service";

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
    ageGroup: "AGE_8_10",
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
});

beforeEach(async () => {
  await db.donation.deleteMany({});
  await db.bookCopy.deleteMany({});
  await db.bookTitle.deleteMany({});
  await db.codeSequence.updateMany({
    where: { libraryId: fixture.libraryId, kind: "BOOK_COPY" },
    data: { nextValue: 1 },
  });
});

afterEach(() => {
  signOut();
});

afterAll(async () => {
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
