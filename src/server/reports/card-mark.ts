import "server-only";

import { packagedMarkPng } from "@/server/reports/packaged-mark";
import { getAuthorizedMedia } from "@/server/services/media-service";

/**
 * The mark that goes on a downloaded card.
 *
 * The card on screen shows whatever logo the library is using — an uploaded one
 * when there is one, the packaged mark otherwise — and the downloads have to
 * show the same thing, or the file a family keeps is a different object from
 * the card they were shown.
 *
 * Reading an uploaded logo goes through `getAuthorizedMedia` like every other
 * byte in this system, rather than around it. A branding image is public by
 * definition and that function says so in one place; a second path that read
 * the store directly would be a second place for that decision to live.
 *
 * `pdf-lib` embeds PNG and JPEG and nothing else, so a library whose logo is a
 * WebP gets the packaged mark on the PDF. That is a quiet downgrade rather than
 * a failed download, which is the right way round for a card.
 */

export interface CardMark {
  bytes: Uint8Array;
  format: "png" | "jpg";
}

const PACKAGED: CardMark = { bytes: packagedMarkPng, format: "png" };

/** `/api/media/<uuid>` is the only shape an uploaded logo ever takes. */
function mediaIdFrom(logoUrl: string | null): string | null {
  const match = /^\/api\/media\/([0-9a-fA-F-]{36})$/.exec(logoUrl ?? "");
  return match ? match[1] : null;
}

export async function resolveCardMark(logoUrl: string | null): Promise<CardMark> {
  const mediaId = mediaIdFrom(logoUrl);
  if (!mediaId) return PACKAGED;

  try {
    const media = await getAuthorizedMedia(mediaId);
    if (media.mimeType === "image/png") return { bytes: media.bytes, format: "png" };
    if (media.mimeType === "image/jpeg") return { bytes: media.bytes, format: "jpg" };
    return PACKAGED;
  } catch {
    // A card with the packaged mark beats a download that 500s because a logo
    // row was mid-deletion.
    return PACKAGED;
  }
}
