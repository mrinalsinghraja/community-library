import "server-only";

import sharp from "sharp";

import { generateToken, sha256Bytes } from "@/server/lib/crypto";

/**
 * The small copy of a book cover that lists and cards draw (ADR-072).
 *
 * A cover is kept at 100 KB to 1 MB because a book's own page shows it half a
 * screen wide and the enlarge dialog shows it bigger still. Everywhere else it
 * is a 36 to 220 pixel tile, and sending the whole jacket into a 44x66 desk row
 * is what made covers most of this deployment's Fast Origin Transfer.
 *
 * Measured on a real 1,038,600 B cover from production: 218x320 WebP at q72 is
 * 14,338 B and takes about 12 ms. At 480 px it would be 26,982 B.
 *
 * **Book covers only.** Nothing in this module knows about any other purpose,
 * and the database refuses a thumbnail on any row that is not a `book_cover`
 * (`media_object_thumb_only_for_covers`). A derived copy of a child's
 * photograph is new personal data, and this is not where that decision gets
 * made.
 */

/** Longest side of a thumbnail, in pixels. */
export const COVER_THUMB_LONG_EDGE = 320;

/** WebP quality. Covers are flat artwork and type; 72 keeps both clean. */
export const COVER_THUMB_QUALITY = 72;

export const COVER_THUMB_MIME_TYPE = "image/webp";

/**
 * What one thumbnail is assumed to weigh when nothing has been generated yet.
 *
 * Used only by the backfill's dry run, which must not download a single cover
 * to answer "how much will this write". Rounded up from the measurement above.
 */
export const COVER_THUMB_ESTIMATED_BYTES = 16 * 1024;

export interface CoverThumbnail {
  bytes: Uint8Array;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  width: number;
  height: number;
}

/**
 * Makes a thumbnail from a cover's STORED bytes.
 *
 * Always call it with what was stored -- already stripped of EXIF by
 * `validateUpload` -- never with what the browser sent. sharp writes no
 * metadata unless asked to, so the output carries none either way.
 *
 * Throws when the bytes are not an image sharp can decode.
 */
export async function makeCoverThumbnail(source: Uint8Array): Promise<CoverThumbnail> {
  const { data, info } = await sharp(source, {
    // A jacket is a few megapixels at most. Refusing anything absurd keeps a
    // hostile "image" from being a memory bomb in a serverless function.
    limitInputPixels: 50_000_000,
    failOn: "error",
  })
    .resize({
      width: COVER_THUMB_LONG_EDGE,
      height: COVER_THUMB_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COVER_THUMB_QUALITY })
    .toBuffer({ resolveWithObject: true });

  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  return {
    bytes,
    mimeType: COVER_THUMB_MIME_TYPE,
    byteSize: bytes.byteLength,
    checksumSha256: sha256Bytes(bytes),
    width: info.width,
    height: info.height,
  };
}

/**
 * The same, but a cover that cannot be thumbnailed is not an upload failure.
 *
 * The original is what the library asked for; the thumbnail is an optimisation
 * on top of it. A picture sharp will not decode still gets stored, and every
 * list simply falls back to the original for that one book.
 */
export async function tryMakeCoverThumbnail(source: Uint8Array): Promise<CoverThumbnail | null> {
  try {
    return await makeCoverThumbnail(source);
  } catch (error) {
    console.warn("Could not make a cover thumbnail; the original will be served instead:", error);
    return null;
  }
}

/** `book_cover_thumb/2026/9/<random>.webp` -- no user-supplied component anywhere. */
export function buildCoverThumbnailStorageKey(now = new Date()): string {
  return `book_cover_thumb/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${generateToken(16)}.webp`;
}
