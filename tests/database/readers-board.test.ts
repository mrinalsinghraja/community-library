import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import {
  claimUnclaimedChildPhoto,
  getAuthorizedMedia,
  storeChildPhoto,
} from "@/server/services/media-service";
import {
  memberIsOnReadersBoard,
  readersOfTheMonth,
} from "@/server/services/readers-board-service";

import { FakeStorageDriver, pngBytes } from "./fake-storage";
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
 * The readers' board, against a real database.
 *
 * The property that matters most here cannot be checked without Postgres: that
 * one child's photograph becomes readable by another child ONLY while the first
 * child is on the board, and only where a guardian consented to it. Everything
 * about this feature is safe or unsafe at that one join.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let onBoard: Awaited<ReturnType<typeof createMember>>;
let optedOut: Awaited<ReturnType<typeof createMember>>;
let stranger: Awaited<ReturnType<typeof createMember>>;

let onBoardPhoto = "";
let optedOutPhoto = "";

const storageDriver = new FakeStorageDriver();
const DAY = 24 * 60 * 60 * 1000;

/** A day inside the month that has just finished. */
function lastMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 12));
}

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** What the librarian records when a family asks to be left off the card. */
async function optOutOfBoard(memberUserId: string) {
  await db.consentRecord.create({
    data: {
      libraryId: fixture.libraryId,
      type: "READERS_BOARD",
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      method: "WEB_FORM",
      consentVersion: "test-1",
      consentTextSnapshot: "Test fixture.",
      memberUserId,
    },
  });
}

/** A finished loan inside last month, so the child qualifies for the board. */
async function borrowedLastMonth(memberUserId: string, times = 1) {
  for (let i = 0; i < times; i += 1) {
    const copy = await createBookCopy(fixture.libraryId);
    const issued = lastMonth();
    await db.loan.create({
      data: {
        libraryId: fixture.libraryId,
        copyId: copy.id,
        memberUserId,
        status: "RETURNED",
        issuedAt: issued,
        dueAt: new Date(issued.getTime() + 14 * DAY),
        returnedAt: new Date(issued.getTime() + 3 * DAY),
      },
    });
  }
}

async function givePhoto(memberUserId: string): Promise<string> {
  const stored = await storeChildPhoto({ libraryId: fixture.libraryId, bytes: pngBytes() });
  // A freshly uploaded photo is unclaimed and swept unless approval claims it.
  await claimUnclaimedChildPhoto(db, {
    mediaId: stored.mediaId,
    libraryId: fixture.libraryId,
  });
  await db.memberProfile.update({
    where: { userId: memberUserId },
    data: { photoMediaId: stored.mediaId },
  });
  return stored.mediaId;
}

beforeAll(async () => {
  await resetDatabase();
  __setStorageDriverForTests(storageDriver);

  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");

  onBoard = await createMember(fixture.libraryId, { displayName: "Meera Raghunathan" });
  optedOut = await createMember(fixture.libraryId, { displayName: "Aarav Krishnamurthy" });
  stranger = await createMember(fixture.libraryId, { displayName: "Rohan Das" });

  await borrowedLastMonth(onBoard.id, 3);

  // Reads the most in the library, and their family asked to be left off.
  await optOutOfBoard(optedOut.id);
  await borrowedLastMonth(optedOut.id, 9);

  onBoardPhoto = await givePhoto(onBoard.id);
  optedOutPhoto = await givePhoto(optedOut.id);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("who is on the board", () => {
  it("includes a child whose family never said otherwise", async () => {
    await actingAs(stranger.id, "MEMBER");
    const board = await readersOfTheMonth();

    expect(board.map((row) => row.firstName)).toContain("Meera");
  });

  it("leaves out a child whose family asked to be left off", async () => {
    await actingAs(stranger.id, "MEMBER");
    const board = await readersOfTheMonth();

    // Nine books to Meera's three. An opt-out beats any amount of reading.
    expect(board.map((row) => row.firstName)).not.toContain("Aarav");
  });

  it("shows a first name only, never the whole one", async () => {
    await actingAs(stranger.id, "MEMBER");
    const board = await readersOfTheMonth();

    for (const row of board) {
      expect(row.firstName).not.toContain(" ");
      expect(row.firstName).not.toContain("Raghunathan");
    }
  });

  it("drops a child the moment their family opts out", async () => {
    await optOutOfBoard(onBoard.id);

    await actingAs(stranger.id, "MEMBER");
    expect(await readersOfTheMonth()).toHaveLength(0);

    await db.consentRecord.deleteMany({
      where: { memberUserId: onBoard.id, type: "READERS_BOARD" },
    });
  });

  it("refuses a signed-out caller entirely", async () => {
    __setSessionHandle(null);
    await expect(readersOfTheMonth()).rejects.toThrow();
  });
});

describe("whose photograph another child may read", () => {
  it("lets one child see the photo of a child who is on the board", async () => {
    await actingAs(stranger.id, "MEMBER");

    const media = await getAuthorizedMedia(onBoardPhoto);
    expect(media.mimeType).toBe("image/png");
  });

  it("refuses the photo of a child whose family opted out", async () => {
    await actingAs(stranger.id, "MEMBER");

    // Aarav reads the most in the library and his face is still nobody's to see.
    await expect(getAuthorizedMedia(optedOutPhoto)).rejects.toThrow();
  });

  it("stops serving the photo the moment their family opts out", async () => {
    await optOutOfBoard(onBoard.id);

    await actingAs(stranger.id, "MEMBER");
    await expect(getAuthorizedMedia(onBoardPhoto)).rejects.toThrow();

    await db.consentRecord.deleteMany({
      where: { memberUserId: onBoard.id, type: "READERS_BOARD" },
    });
  });

  it("refuses a signed-out request for a board photo", async () => {
    // The board is a signed-in page. A face on it is not a public asset.
    __setSessionHandle(null);
    await expect(getAuthorizedMedia(onBoardPhoto)).rejects.toThrow();
  });

  it("still lets a child see their own photo when they are off the board", async () => {
    await actingAs(optedOut.id, "MEMBER");

    const media = await getAuthorizedMedia(optedOutPhoto);
    expect(media.mimeType).toBe("image/png");
  });

  it("still lets the desk see a photo, board or no board", async () => {
    await actingAs(librarian.id);

    await expect(getAuthorizedMedia(optedOutPhoto)).resolves.toBeDefined();
    await expect(getAuthorizedMedia(onBoardPhoto)).resolves.toBeDefined();
  });
});

describe("the answer the board itself gives", () => {
  it("agrees with what the card shows", async () => {
    expect(await memberIsOnReadersBoard(fixture.libraryId, onBoard.id)).toBe(true);
    expect(await memberIsOnReadersBoard(fixture.libraryId, optedOut.id)).toBe(false);
    expect(await memberIsOnReadersBoard(fixture.libraryId, stranger.id)).toBe(false);
  });

  it("is scoped to one library", async () => {
    /*
     * The same member id, asked about a different library, is not on its board.
     * A bare id rather than a second fixture: `createLibraryFixture` seeds the
     * global permission rows and can only run once per database.
     */
    const elsewhere = "00000000-0000-4000-8000-000000000000";
    expect(await memberIsOnReadersBoard(elsewhere, onBoard.id)).toBe(false);
  });
});
