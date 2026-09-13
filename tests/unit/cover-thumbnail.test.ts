import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  COVER_THUMB_LONG_EDGE,
  buildCoverThumbnailStorageKey,
  makeCoverThumbnail,
  tryMakeCoverThumbnail,
} from "@/server/lib/cover-thumbnail";

/**
 * The small copy of a book cover (ADR-072).
 *
 * What matters: it is WebP, it is small enough to be worth having, it keeps the
 * jacket's shape, it never invents pixels, and it carries no metadata even when
 * the picture it was made from did.
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

describe("a cover's thumbnail", () => {
  it("is a WebP no longer than the long-edge limit, in the jacket's own shape", async () => {
    const thumb = await makeCoverThumbnail(await jacket(800, 1200));
    const meta = await sharp(Buffer.from(thumb.bytes)).metadata();

    expect(thumb.mimeType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(COVER_THUMB_LONG_EDGE);
    expect(COVER_THUMB_LONG_EDGE).toBeLessThanOrEqual(320);
    // 800x1200 is 2:3; the thumbnail must be too, not a squashed square.
    expect(meta.height).toBe(COVER_THUMB_LONG_EDGE);
    expect(meta.width).toBe(Math.round((800 / 1200) * COVER_THUMB_LONG_EDGE));
    expect(thumb.width).toBe(meta.width);
    expect(thumb.height).toBe(meta.height);
  });

  it("describes the bytes it returns", async () => {
    const thumb = await makeCoverThumbnail(await jacket(600, 900));

    expect(thumb.byteSize).toBe(thumb.bytes.byteLength);
    expect(thumb.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never enlarges a picture that is already small", async () => {
    const thumb = await makeCoverThumbnail(await jacket(100, 150));
    const meta = await sharp(Buffer.from(thumb.bytes)).metadata();

    expect(meta.width).toBe(100);
    expect(meta.height).toBe(150);
  });

  it("carries no metadata, even from a picture that had some", async () => {
    const source = await jacket(640, 960, true);
    expect((await sharp(Buffer.from(source)).metadata()).exif).toBeDefined();

    const thumb = await makeCoverThumbnail(source);
    const meta = await sharp(Buffer.from(thumb.bytes)).metadata();

    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it("refuses bytes that are not a picture, and the tolerant form says so with null", async () => {
    const garbage = new Uint8Array(4096).fill(7);

    await expect(makeCoverThumbnail(garbage)).rejects.toThrow();
    expect(await tryMakeCoverThumbnail(garbage)).toBeNull();
  });

  it("is stored under its own random key with no part of anybody's filename in it", () => {
    const a = buildCoverThumbnailStorageKey(new Date("2026-09-13T10:00:00Z"));
    const b = buildCoverThumbnailStorageKey(new Date("2026-09-13T10:00:00Z"));

    expect(a).toMatch(/^book_cover_thumb\/2026\/9\/[A-Za-z0-9_-]+\.webp$/);
    expect(a).not.toBe(b);
  });
});
