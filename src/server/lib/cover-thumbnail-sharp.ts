import "server-only";

import sharp from "sharp";

import {
  COVER_THUMB_LONG_EDGE,
  COVER_THUMB_QUALITY,
  type CoverThumbnail,
} from "@/server/lib/cover-thumbnail";
import { sha256Bytes } from "@/server/lib/crypto";

/**
 * Makes a cover thumbnail with `sharp`, for covers uploaded before the cover
 * picker made them (ADR-072).
 *
 * **Never import this from anything that deploys.** It exists for
 * `npm run thumbnails:backfill`, which runs on a person's machine, and for
 * tests. Imported from a route, a page or a server action it would put a native
 * image library back into every function bundle (+16.5 MB a deployment) and
 * have the server decode uploaded pixels again. `sharp` is a devDependency for
 * that reason, and `tests/unit/runtime-imports.test.ts` fails if anything under
 * `src/` other than the backfill imports this file.
 */

export interface MadeCoverThumbnail extends CoverThumbnail {
  width: number;
  height: number;
}

/** Throws when the bytes are not an image sharp can decode. */
export async function makeCoverThumbnail(source: Uint8Array): Promise<MadeCoverThumbnail> {
  const { data, info } = await sharp(source, {
    limitInputPixels: 50_000_000,
    failOn: "error",
  })
    .resize({
      width: COVER_THUMB_LONG_EDGE,
      height: COVER_THUMB_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: Math.round(COVER_THUMB_QUALITY * 100) })
    .toBuffer({ resolveWithObject: true });

  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  return {
    bytes,
    mimeType: "image/webp",
    byteSize: bytes.byteLength,
    checksumSha256: sha256Bytes(bytes),
    width: info.width,
    height: info.height,
  };
}
