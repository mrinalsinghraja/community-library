import "server-only";

import {
  COVER_THUMB_LONG_EDGE,
  COVER_THUMB_MAX_BYTES,
  COVER_THUMB_QUALITY,
} from "@/lib/cover-image";
import { generateToken } from "@/server/lib/crypto";
import { UPLOAD_PURPOSES, validateUpload } from "@/server/lib/uploads";

/**
 * The small copy of a book cover that lists and cards draw (ADR-072).
 *
 * A cover is kept at 100 KB to 1 MB because a book's own page shows it half a
 * screen wide. Everywhere else it is a 36 to 220 pixel tile, and sending the
 * whole jacket into a 44x66 desk row is what made covers most of this
 * deployment's Fast Origin Transfer.
 *
 * **The thumbnail is made in the librarian's browser, not here.** The cover
 * picker already re-encodes every cover on the device (`image-downscale.ts`), so
 * it makes the 320 px copy too and uploads it alongside. That keeps two things
 * true that a server-side encoder broke:
 *
 * - the server never decodes attacker-controlled pixels, which has been this
 *   application's posture from the start (see `stripImageMetadata`);
 * - no native image library ships in the deployed functions. `sharp` added
 *   16.5 MB to every deployment's bundle (36.3 MB -> 52.8 MB, measured), on a
 *   Hobby team whose Functions Storage was at 9.74 GB of 10.
 *
 * Here, the uploaded thumbnail is treated like any other upload: same magic-byte
 * check, same executable refusal, same metadata strip, plus a size cap of its
 * own. Anything it does not like is dropped, never an error -- the cover is what
 * the librarian asked to save.
 *
 * **Book covers only.** The database refuses a thumbnail on any row that is not
 * a `book_cover` (`media_object_thumb_only_for_covers`).
 *
 * `sharp` lives in `cover-thumbnail-sharp.ts`, used only by the backfill script
 * and tests. A unit test fails if anything deployable imports it.
 */

export { COVER_THUMB_LONG_EDGE, COVER_THUMB_MAX_BYTES, COVER_THUMB_QUALITY };

/** What a thumbnail may be. WebP, or JPEG from a browser that cannot encode WebP. */
export const COVER_THUMB_MIME_TYPES: readonly string[] = ["image/webp", "image/jpeg"];

/**
 * What one thumbnail is assumed to weigh when nothing has been generated yet.
 *
 * Used only by the backfill's dry run, which must not download a single cover
 * to answer "how much will this write". Rounded up from a real 1,038,600 B cover
 * whose 218x320 WebP was 14,338 B.
 */
export const COVER_THUMB_ESTIMATED_BYTES = 16 * 1024;

export interface CoverThumbnail {
  bytes: Uint8Array;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
}

/**
 * Checks a thumbnail uploaded with a cover, and returns what to store -- or null
 * to store the cover without one.
 *
 * Never throws: a thumbnail that is too big, not a picture, or a disguised
 * executable is simply not kept.
 */
export function acceptCoverThumbnail(bytes: Uint8Array): CoverThumbnail | null {
  if (bytes.byteLength === 0 || bytes.byteLength > COVER_THUMB_MAX_BYTES) return null;

  try {
    const validated = validateUpload({ bytes, purpose: UPLOAD_PURPOSES.BOOK_COVER });
    if (!COVER_THUMB_MIME_TYPES.includes(validated.mimeType)) return null;
    if (validated.byteSize > COVER_THUMB_MAX_BYTES) return null;

    return {
      // The stripped bytes, not the uploaded ones.
      bytes: validated.bytes,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      checksumSha256: validated.checksumSha256,
    };
  } catch {
    return null;
  }
}

/** `book_cover_thumb/2026/9/<random>.webp` -- no user-supplied component anywhere. */
export function buildCoverThumbnailStorageKey(
  mimeType: string = "image/webp",
  now = new Date(),
): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : "webp";
  return `book_cover_thumb/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${generateToken(16)}.${extension}`;
}
