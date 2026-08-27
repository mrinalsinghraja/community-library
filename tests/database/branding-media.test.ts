import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import { getAuthorizedMedia, sweepPendingMedia } from "@/server/services/media-service";
import { packagedMarkPng } from "@/server/reports/packaged-mark";
import { resolveCardMark } from "@/server/reports/card-mark";
import { removeLibraryLogo, updateLibraryLogo } from "@/server/services/settings-service";

import { FakeStorageDriver, pngBytes } from "./fake-storage";
import {
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * The library's logo.
 *
 * A logo is the opposite of a child's photograph in every way that matters
 * here — it is on the front page, the sign-in screen and the bottom of every
 * email, so a signed-out request for it is the normal case. It still goes
 * through the same upload gate and the same ledger, and it is still refused if
 * it is an SVG: a logo is the one image in this application shown to people who
 * have not signed in, and an SVG is a document that can carry script.
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const storageDriver = new FakeStorageDriver();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
}

beforeAll(async () => {
  __setStorageDriverForTests(storageDriver);
  await db.$connect();
});

afterAll(async () => {
  __setStorageDriverForTests(null);
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  storageDriver.objects.clear();
  fixture = await createLibraryFixture();
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  __setSessionHandle(null);
});

afterEach(() => {
  __setSessionHandle(null);
});

describe("uploading a logo", () => {
  it("stores it and points the library at it", async () => {
    await actingAs(admin.id);
    const { logoUrl } = await updateLibraryLogo({ bytes: pngBytes(), declaredMimeType: "image/png" });

    expect(logoUrl).toMatch(/^\/api\/media\/[0-9a-f-]+$/);

    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });
    expect(settings.logoUrl).toBe(logoUrl);
  });

  it("keeps the object, rather than letting the sweeper collect it", async () => {
    await actingAs(admin.id);
    const { logoUrl } = await updateLibraryLogo({ bytes: pngBytes() });
    const mediaId = logoUrl.split("/").pop()!;

    // The claim happens in the same transaction that starts pointing at it.
    const media = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.pendingDeletionAt).toBeNull();

    const swept = await sweepPendingMedia();
    expect(swept.purged).toBe(0);
    expect(await db.mediaObject.count({ where: { id: mediaId } })).toBe(1);
  });

  it("refuses an SVG, and leaves nothing behind when it does", async () => {
    await actingAs(admin.id);

    await expect(updateLibraryLogo({ bytes: svgBytes(), declaredMimeType: "image/svg+xml" }))
      .rejects.toThrow();

    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });
    expect(settings.logoUrl).toBeNull();

    // The row that was written before the refusal is scheduled for removal, so
    // the sweeper collects the bytes instead of leaving an orphan.
    await sweepPendingMedia();
    expect(storageDriver.objects.size).toBe(0);
  });

  it("refuses something that is not an image at all", async () => {
    await actingAs(admin.id);
    const notAnImage = new TextEncoder().encode("just some text, honestly");

    await expect(updateLibraryLogo({ bytes: notAnImage })).rejects.toThrow();
  });

  it("refuses a librarian", async () => {
    await actingAs(librarian.id);
    await expect(updateLibraryLogo({ bytes: pngBytes() })).rejects.toThrow();
  });

  it("refuses a child", async () => {
    const child = await createMember(fixture.libraryId);
    await actingAs(child.id, "MEMBER");
    await expect(updateLibraryLogo({ bytes: pngBytes() })).rejects.toThrow();
  });
});

describe("replacing and removing a logo", () => {
  it("schedules the old one for deletion when a new one arrives", async () => {
    await actingAs(admin.id);
    const first = await updateLibraryLogo({ bytes: pngBytes() });
    const firstId = first.logoUrl.split("/").pop()!;

    const second = await updateLibraryLogo({ bytes: pngBytes(96) });
    expect(second.logoUrl).not.toBe(first.logoUrl);

    const old = await db.mediaObject.findUniqueOrThrow({ where: { id: firstId } });
    expect(old.pendingDeletionAt).not.toBeNull();

    await sweepPendingMedia();
    expect(await db.mediaObject.count({ where: { id: firstId } })).toBe(0);
  });

  it("puts the drawn mark back", async () => {
    await actingAs(admin.id);
    await updateLibraryLogo({ bytes: pngBytes() });
    await removeLibraryLogo();

    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });
    expect(settings.logoUrl).toBeNull();
  });
});

describe("who may see a logo", () => {
  it("is readable by a visitor who has not signed in", async () => {
    await actingAs(admin.id);
    const { logoUrl } = await updateLibraryLogo({ bytes: pngBytes() });
    const mediaId = logoUrl.split("/").pop()!;

    __setSessionHandle(null);
    const media = await getAuthorizedMedia(mediaId);

    expect(media.mimeType).toBe("image/png");
    expect(media.byteSize).toBeGreaterThan(0);
  });

  it("stops being readable the moment it is removed", async () => {
    await actingAs(admin.id);
    const { logoUrl } = await updateLibraryLogo({ bytes: pngBytes() });
    const mediaId = logoUrl.split("/").pop()!;

    await removeLibraryLogo();
    __setSessionHandle(null);

    await expect(getAuthorizedMedia(mediaId)).rejects.toThrow();
  });

  it("does not make a child's photograph public along with it", async () => {
    // The branding branch is written separately from the photograph rules for
    // exactly this reason: the mistake that would matter most here is a change
    // meant for logos loosening what applies to a child.
    const child = await createMember(fixture.libraryId);
    const photo = await db.mediaObject.create({
      data: {
        libraryId: fixture.libraryId,
        visibility: "PRIVATE",
        storageKey: "child_photo/test/private.png",
        mimeType: "image/png",
        byteSize: 10,
        checksumSha256: "x".repeat(64),
        purpose: "child_photo",
      },
    });
    await db.memberProfile.update({
      where: { userId: child.id },
      data: { photoMediaId: photo.id },
    });

    __setSessionHandle(null);
    await expect(getAuthorizedMedia(photo.id)).rejects.toThrow();
  });
});

describe("the logo on a downloaded card", () => {
  /*
   * The card a family saves has to be the card they were shown, mark and all.
   * The PDF is drawn on a server, so it cannot reach for the file the browser
   * gets from the static handler — it either reads the uploaded logo out of the
   * media store or falls back to the mark packaged with the code.
   */

  it("draws the library's own uploaded logo", async () => {
    await actingAs(admin.id);
    const bytes = pngBytes(4096);
    const { logoUrl } = await updateLibraryLogo({ bytes, declaredMimeType: "image/png" });

    const mark = await resolveCardMark(logoUrl);

    expect(mark.format).toBe("png");
    expect(Buffer.from(mark.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("falls back to the packaged mark when the library has uploaded none", async () => {
    await actingAs(admin.id);
    const mark = await resolveCardMark(null);

    expect(mark.format).toBe("png");
    expect(Buffer.from(mark.bytes).equals(Buffer.from(packagedMarkPng))).toBe(true);
  });

  it("falls back rather than failing when the logo has gone", async () => {
    await actingAs(admin.id);
    const { logoUrl } = await updateLibraryLogo({ bytes: pngBytes() });
    await removeLibraryLogo();
    await sweepPendingMedia();

    // A card with the packaged mark beats a download that 500s because a row
    // was mid-deletion when a family pressed the button.
    const mark = await resolveCardMark(logoUrl);
    expect(Buffer.from(mark.bytes).equals(Buffer.from(packagedMarkPng))).toBe(true);
  });

  it("ignores anything that is not one of this library's media ids", async () => {
    await actingAs(admin.id);

    for (const url of ["https://example.test/logo.png", "/api/media/../../etc/passwd", ""]) {
      const mark = await resolveCardMark(url);
      expect(Buffer.from(mark.bytes).equals(Buffer.from(packagedMarkPng))).toBe(true);
    }
  });
});
