import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  COVER_THUMB_LONG_EDGE,
  COVER_THUMB_MAX_BYTES,
  acceptCoverThumbnail,
  buildCoverThumbnailStorageKey,
} from "@/server/lib/cover-thumbnail";
import { makeCoverThumbnail } from "@/server/lib/cover-thumbnail-sharp";

/**
 * The small copy of a book cover (ADR-072).
 *
 * Two halves. The server's: a thumbnail uploaded with a cover is accepted only
 * if it is a small WebP or JPEG, is stored without metadata, and anything else
 * is dropped rather than failing the save. The backfill's: sharp makes a WebP in
 * the jacket's own shape, never enlarges, and writes no metadata.
 */

async function jacket(width: number, height: number, withExif = false): Promise<Uint8Array> {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 110, b: 85 } },
  });
  if (withExif) {
    image = image.withExif({ IFD0: { Copyright: "somebody's phone", Make: "PhoneCo" } });
  }
  return new Uint8Array(await image.jpeg({ quality: 90 }).toBuffer());
}

describe("a thumbnail uploaded with a cover", () => {
  it("is kept when it is a small WebP", async () => {
    const webp = (await makeCoverThumbnail(await jacket(800, 1200))).bytes;
    const accepted = acceptCoverThumbnail(webp);

    expect(accepted?.mimeType).toBe("image/webp");
    expect(accepted?.byteSize).toBe(accepted?.bytes.byteLength);
    expect(accepted?.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is kept as a JPEG, from a browser that cannot encode WebP, with its metadata stripped", async () => {
    const small = await jacket(200, 300, true);
    expect(small.byteLength).toBeLessThan(COVER_THUMB_MAX_BYTES);

    const accepted = acceptCoverThumbnail(small);

    expect(accepted?.mimeType).toBe("image/jpeg");
    expect((await sharp(Buffer.from(accepted!.bytes)).metadata()).exif).toBeUndefined();
  });

  it("is dropped when it is too big to be a thumbnail", () => {
    const big = new Uint8Array(COVER_THUMB_MAX_BYTES + 1);
    big.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);

    expect(acceptCoverThumbnail(big)).toBeNull();
  });

  it("is dropped when it is a PNG, not a picture, or an executable", () => {
    const png = new Uint8Array(2048);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const elf = new Uint8Array(512);
    elf.set([0x7f, 0x45, 0x4c, 0x46], 0);

    expect(acceptCoverThumbnail(png)).toBeNull();
    expect(acceptCoverThumbnail(new Uint8Array(4096).fill(7))).toBeNull();
    expect(acceptCoverThumbnail(elf)).toBeNull();
    expect(acceptCoverThumbnail(new Uint8Array(0))).toBeNull();
  });

  it("is stored under its own random key, with no part of anybody's filename in it", () => {
    const at = new Date("2026-09-13T10:00:00Z");
    const a = buildCoverThumbnailStorageKey("image/webp", at);
    const b = buildCoverThumbnailStorageKey("image/webp", at);

    expect(a).toMatch(/^book_cover_thumb\/2026\/9\/[A-Za-z0-9_-]+\.webp$/);
    expect(buildCoverThumbnailStorageKey("image/jpeg", at)).toMatch(/\.jpg$/);
    expect(a).not.toBe(b);
  });
});

describe("a thumbnail made by the backfill", () => {
  it("is a WebP no longer than the long-edge limit, in the jacket's own shape", async () => {
    const thumb = await makeCoverThumbnail(await jacket(800, 1200));
    const meta = await sharp(Buffer.from(thumb.bytes)).metadata();

    expect(meta.format).toBe("webp");
    expect(COVER_THUMB_LONG_EDGE).toBeLessThanOrEqual(320);
    expect(meta.height).toBe(COVER_THUMB_LONG_EDGE);
    expect(meta.width).toBe(Math.round((800 / 1200) * COVER_THUMB_LONG_EDGE));
    // What the backfill makes, the server would accept.
    expect(acceptCoverThumbnail(thumb.bytes)).not.toBeNull();
  });

  it("never enlarges a picture that is already small", async () => {
    const thumb = await makeCoverThumbnail(await jacket(100, 150));
    const meta = await sharp(Buffer.from(thumb.bytes)).metadata();

    expect(meta.width).toBe(100);
    expect(meta.height).toBe(150);
  });

  it("carries no metadata, even from a picture that had some", async () => {
    const source = await jacket(640, 960, true);
    const thumb = await makeCoverThumbnail(source);
    const meta = await sharp(Buffer.from(thumb.bytes)).metadata();

    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it("refuses bytes that are not a picture", async () => {
    await expect(makeCoverThumbnail(new Uint8Array(4096).fill(7))).rejects.toThrow();
  });
});
