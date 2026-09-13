import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { GET as getMedia } from "@/app/api/media/[id]/route";
import { GET as getThumb } from "@/app/api/media/[id]/thumb/route";
import { createSession } from "@/server/auth/session-store";
import { COVER_THUMB_LONG_EDGE } from "@/server/lib/cover-thumbnail";
import { makeCoverThumbnail } from "@/server/lib/cover-thumbnail-sharp";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import { backfillCoverThumbnails } from "@/server/services/cover-thumbnail-backfill";
import {
  claimUnclaimedBookCover,
  claimUnclaimedChildPhoto,
  purgeScheduledMedia,
  scheduleMediaDeletion,
  storeBookCover,
  storeChildPhoto,
} from "@/server/services/media-service";

import { FakeStorageDriver, pngBytes } from "./fake-storage";
import { createLibraryFixture, createMember, db, resetDatabase, type Fixture } from "./helpers";

/**
 * The media routes as a browser meets them (ADR-072).
 *
 * Covers now come in two sizes and are kept by the browser for good. Neither of
 * those may change anything about a child's photograph, or about who may see a
 * cover. So this file calls the real route handlers and reads the real headers:
 *
 *   1. a child's photograph goes out with exactly the headers it had before;
 *   2. a cover is `private, immutable` and has a WebP thumbnail;
 *   3. the thumbnail route refuses exactly what the original route refuses,
 *      with exactly the same empty 404;
 *   4. the backfill is additive, a dry run writes nothing, and a second run is
 *      a no-op.
 */

const UNKNOWN_ID = "01999999-9999-7999-8999-999999999999";

let fixture: Fixture;
const storageDriver = new FakeStorageDriver();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "MEMBER") {
  __setSessionHandle(await createSession(userId, kind));
}

type Handler = typeof getMedia;

function call(handler: Handler, id: string, headers: Record<string, string> = {}) {
  return handler(new Request(`http://localhost/api/media/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

function headerEntries(response: Response): Array<[string, string]> {
  return [...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function jacket(width = 800, height = 1200): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 110, b: 85 } },
  });
  return new Uint8Array(await image.jpeg({ quality: 90 }).toBuffer());
}

async function setCatalogue(visibility: "PUBLIC" | "MEMBER_ONLY") {
  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: { catalogueVisibility: visibility },
  });
}

/**
 * Uploads a cover the way the book form does: the picture, plus the thumbnail
 * the cover picker made in the browser. sharp stands in for the browser's canvas
 * here, and a picture it cannot decode goes up without one -- as it would from a
 * browser that could not make one. Pass `thumbnailBytes` to send something else.
 */
async function uploadCover(
  bytes: Uint8Array,
  thumbnailBytes?: Uint8Array | null,
): Promise<string> {
  const thumbnail =
    thumbnailBytes === undefined
      ? await makeCoverThumbnail(bytes).then((made) => made.bytes, () => null)
      : thumbnailBytes;
  const stored = await storeBookCover({
    libraryId: fixture.libraryId,
    bytes,
    thumbnailBytes: thumbnail ?? undefined,
  });
  await claimUnclaimedBookCover(db, { mediaId: stored.mediaId, libraryId: fixture.libraryId });
  return stored.mediaId;
}

async function givePhotoTo(memberUserId: string): Promise<string> {
  const stored = await storeChildPhoto({ libraryId: fixture.libraryId, bytes: pngBytes() });
  await claimUnclaimedChildPhoto(db, { mediaId: stored.mediaId, libraryId: fixture.libraryId });
  await db.memberProfile.update({
    where: { userId: memberUserId },
    data: { photoMediaId: stored.mediaId },
  });
  return stored.mediaId;
}

beforeAll(() => {
  __setStorageDriverForTests(storageDriver);
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  storageDriver.reset();
  await setCatalogue("MEMBER_ONLY");
});

afterEach(() => {
  __setSessionHandle(null);
});

afterAll(async () => {
  __setStorageDriverForTests(null);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------

describe("a child's photograph, served", () => {
  it("goes out with exactly the headers it had before covers were cached", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);
    await actingAs(child.id);

    const response = await call(getMedia, mediaId);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(body.byteLength).toBeGreaterThan(0);
    // Byte for byte, and nothing else: no ETag, no immutable, no public.
    expect(headerEntries(response)).toEqual([
      ["cache-control", "private, no-store, max-age=0, must-revalidate"],
      ["content-disposition", "inline"],
      ["content-length", String(body.byteLength)],
      ["content-security-policy", "default-src 'none'; sandbox; base-uri 'none'"],
      ["content-type", "image/png"],
      ["x-content-type-options", "nosniff"],
    ]);
  });

  it("is sent in full every time, whatever the browser claims to already hold", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);
    const row = await db.mediaObject.findUniqueOrThrow({
      where: { id: mediaId },
      select: { checksumSha256: true },
    });
    await actingAs(child.id);

    const response = await call(getMedia, mediaId, { "if-none-match": `"${row.checksumSha256}"` });

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("has no thumbnail, and the thumbnail route refuses it with the same empty 404 as an unknown id", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);
    await actingAs(child.id);

    const row = await db.mediaObject.findUniqueOrThrow({
      where: { id: mediaId },
      select: { thumbStorageKey: true },
    });
    expect(row.thumbStorageKey).toBeNull();

    const forPhoto = await call(getThumb, mediaId);
    const forUnknown = await call(getThumb, UNKNOWN_ID);

    expect(forPhoto.status).toBe(404);
    expect((await forPhoto.arrayBuffer()).byteLength).toBe(0);
    expect(headerEntries(forPhoto)).toEqual(headerEntries(forUnknown));
  });

  it("cannot be given a thumbnail even by writing to the database directly", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    await expect(
      db.mediaObject.update({
        where: { id: mediaId },
        data: {
          thumbStorageKey: `book_cover_thumb/x/${randomUUID()}.webp`,
          thumbMimeType: "image/webp",
          thumbByteSize: 100,
          thumbChecksumSha256: "a".repeat(64),
        },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("a book cover, served", () => {
  it("stores the thumbnail uploaded with it, a WebP no longer than 320 px", async () => {
    const mediaId = await uploadCover(await jacket(800, 1200));

    const row = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
    expect(row.thumbStorageKey).toMatch(/^book_cover_thumb\//);
    expect(row.thumbMimeType).toBe("image/webp");
    expect(row.thumbByteSize).toBeLessThan(row.byteSize);

    const stored = storageDriver.objects.get(row.thumbStorageKey!);
    expect(stored).toBeDefined();
    expect(stored!.byteLength).toBe(row.thumbByteSize);

    const meta = await sharp(Buffer.from(stored!)).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(COVER_THUMB_LONG_EDGE);
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(320);
  });

  it("drops a thumbnail that is too big, not a picture, or an executable, and still stores the cover", async () => {
    const cover = await jacket();
    const elf = new Uint8Array(512);
    elf.set([0x7f, 0x45, 0x4c, 0x46], 0);
    const tooBig = new Uint8Array(await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    }).webp({ quality: 95 }).toBuffer());
    expect(tooBig.byteLength).toBeGreaterThan(64 * 1024);

    for (const bad of [tooBig, new Uint8Array(4096).fill(9), elf]) {
      const mediaId = await uploadCover(cover, bad);
      const row = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
      expect(row.byteSize).toBe(cover.byteLength);
      expect(row.thumbStorageKey).toBeNull();
    }
  });

  it("is stored without a thumbnail when the browser sent none, and lists get the original", async () => {
    const member = await createMember(fixture.libraryId);
    const cover = await jacket();
    const mediaId = await uploadCover(cover, null);
    await actingAs(member.id);

    const response = await call(getThumb, mediaId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(cover.byteLength);
  });

  it("is kept privately and for good by the browser, and never by a shared cache", async () => {
    const member = await createMember(fixture.libraryId);
    const mediaId = await uploadCover(await jacket());
    await actingAs(member.id);

    const first = await call(getMedia, mediaId);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const again = await call(getMedia, mediaId, { "if-none-match": etag! });
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect((await again.arrayBuffer()).byteLength).toBe(0);
  });

  it("serves the thumbnail from /thumb to anyone who may see the cover", async () => {
    const member = await createMember(fixture.libraryId);
    const mediaId = await uploadCover(await jacket());
    const row = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
    await actingAs(member.id);

    const response = await call(getThumb, mediaId);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe(`"${row.thumbChecksumSha256}"`);
    expect(body.byteLength).toBe(row.thumbByteSize);
    expect(body.byteLength).toBeLessThan(row.byteSize);
  });

  it("refuses a signed-out visitor both pictures while the catalogue is member-only, exactly as it refuses an unknown id", async () => {
    const mediaId = await uploadCover(await jacket());
    __setSessionHandle(null);

    const responses = [
      await call(getMedia, mediaId),
      await call(getThumb, mediaId),
      await call(getMedia, UNKNOWN_ID),
      await call(getThumb, UNKNOWN_ID),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect((await response.arrayBuffer()).byteLength).toBe(0);
      expect(headerEntries(response)).toEqual(headerEntries(responses[2]));
    }
  });

  it("refuses the thumbnail of a cover that is pending deletion", async () => {
    const member = await createMember(fixture.libraryId);
    const mediaId = await uploadCover(await jacket());
    await scheduleMediaDeletion(db, mediaId);
    await actingAs(member.id);

    const thumb = await call(getThumb, mediaId);
    const original = await call(getMedia, mediaId);

    expect(thumb.status).toBe(404);
    expect(original.status).toBe(404);
    expect(headerEntries(thumb)).toEqual(headerEntries(await call(getThumb, UNKNOWN_ID)));
  });

  it("falls back to the original when a cover has no thumbnail", async () => {
    const member = await createMember(fixture.libraryId);
    // A PNG signature over noise: a valid upload that sharp cannot decode, so
    // it is stored without a thumbnail -- exactly like a pre-thumbnail cover.
    const mediaId = await uploadCover(pngBytes());
    const row = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
    expect(row.thumbStorageKey).toBeNull();
    await actingAs(member.id);

    const response = await call(getThumb, mediaId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toBe(`"${row.checksumSha256}"`);
    expect((await response.arrayBuffer()).byteLength).toBe(row.byteSize);
  });

  it("falls back to the original when the thumbnail's bytes have gone missing", async () => {
    const member = await createMember(fixture.libraryId);
    const mediaId = await uploadCover(await jacket());
    const row = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
    storageDriver.objects.delete(row.thumbStorageKey!);
    await actingAs(member.id);

    const response = await call(getThumb, mediaId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(row.byteSize);
  });

  it("takes its thumbnail with it when it is purged", async () => {
    const mediaId = await uploadCover(await jacket());
    const row = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });

    await scheduleMediaDeletion(db, mediaId);
    expect(await purgeScheduledMedia(mediaId)).toBe(true);

    expect(storageDriver.objects.has(row.storageKey)).toBe(false);
    expect(storageDriver.objects.has(row.thumbStorageKey!)).toBe(false);
    expect(await db.mediaObject.findUnique({ where: { id: mediaId } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("the thumbnail backfill", () => {
  /** A cover stored the way every cover was before thumbnails existed. */
  async function legacyObject(
    purpose: "book_cover" | "child_photo",
    options: { pendingDeletion?: boolean } = {},
  ): Promise<{ id: string; storageKey: string; bytes: Uint8Array }> {
    const bytes = await jacket(700, 1050);
    const storageKey = `${purpose}/legacy/${randomUUID()}.jpg`;
    await storageDriver.put(storageKey, bytes, "image/jpeg", "PRIVATE");
    const row = await db.mediaObject.create({
      data: {
        libraryId: fixture.libraryId,
        visibility: "PRIVATE",
        storageKey,
        mimeType: "image/jpeg",
        byteSize: bytes.byteLength,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
        purpose,
        pendingDeletionAt: options.pendingDeletion ? new Date() : null,
      },
      select: { id: true },
    });
    return { id: row.id, storageKey, bytes };
  }

  function snapshot(): Map<string, string> {
    return new Map(
      [...storageDriver.objects].map(([key, bytes]) => [
        key,
        createHash("sha256").update(bytes).digest("hex"),
      ]),
    );
  }

  it("counts and estimates in a dry run, and writes nothing at all", async () => {
    await legacyObject("book_cover");
    await legacyObject("book_cover");
    const before = snapshot();

    const result = await backfillCoverThumbnails({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toBe(2);
    expect(result.sourceBytes).toBeGreaterThan(0);
    expect(result.estimatedThumbnailBytes).toBeGreaterThan(0);
    expect(result.created).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(await db.mediaObject.count({ where: { thumbStorageKey: { not: null } } })).toBe(0);
  });

  it("thumbnails every cover without touching an original, and a second run does nothing", async () => {
    const a = await legacyObject("book_cover");
    const b = await legacyObject("book_cover");

    const first = await backfillCoverThumbnails({ dryRun: false });
    expect(first.created).toBe(2);
    expect(first.bytesWritten).toBeGreaterThan(0);

    for (const cover of [a, b]) {
      // The original is exactly the bytes it was.
      expect(Buffer.from(storageDriver.objects.get(cover.storageKey)!).equals(Buffer.from(cover.bytes))).toBe(true);

      const row = await db.mediaObject.findUniqueOrThrow({ where: { id: cover.id } });
      expect(row.storageKey).toBe(cover.storageKey);
      expect(row.thumbMimeType).toBe("image/webp");
      const meta = await sharp(Buffer.from(storageDriver.objects.get(row.thumbStorageKey!)!)).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(320);
    }

    const afterFirst = snapshot();
    const second = await backfillCoverThumbnails({ dryRun: false });

    expect(second.candidates).toBe(0);
    expect(second.created).toBe(0);
    expect(snapshot()).toEqual(afterFirst);
  });

  it("never reaches a child's photograph or a cover already pending deletion", async () => {
    const photo = await legacyObject("child_photo");
    const leaving = await legacyObject("book_cover", { pendingDeletion: true });
    const before = snapshot();

    const result = await backfillCoverThumbnails({ dryRun: false });

    expect(result.candidates).toBe(0);
    expect(result.created).toBe(0);
    expect(snapshot()).toEqual(before);
    for (const id of [photo.id, leaving.id]) {
      const row = await db.mediaObject.findUniqueOrThrow({ where: { id } });
      expect(row.thumbStorageKey).toBeNull();
    }
  });
});
