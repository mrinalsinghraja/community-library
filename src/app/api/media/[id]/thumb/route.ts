import { mediaRefusal, mediaResponse } from "@/server/lib/media-response";
import { MEDIA_THUMB_FALLBACK_CACHE_CONTROL, UPLOAD_PURPOSES } from "@/server/lib/uploads";
import { getAuthorizedMedia } from "@/server/services/media-service";

/**
 * A book cover's small copy (ADR-072).
 *
 * The same authorization as `/api/media/[id]`, asked about the same id: the
 * thumbnail is served only when the original would be. Every refusal is the
 * same bare 404 as the original route's, so this path reveals nothing the
 * other one does not.
 *
 * - A cover with no thumbnail yet gets its original, from this same URL, and
 *   that answer is NOT cached for good: the bytes here change once a thumbnail
 *   exists. See MEDIA_THUMB_FALLBACK_CACHE_CONTROL.
 * - Anything that is not a book cover is refused here, after the authorization
 *   decision and with the same 404. There is no such thing as a thumbnail of a
 *   child's photograph, and this route will not pretend to serve one.
 */

export const dynamic = "force-dynamic";
/** Node, not edge: the storage drivers and Prisma both need it. */
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const media = await getAuthorizedMedia(id, { variant: "thumb" });
    if (media.purpose !== UPLOAD_PURPOSES.BOOK_COVER) {
      return mediaRefusal(id, null);
    }
    return media.variant === "thumb"
      ? mediaResponse(request, media)
      : mediaResponse(request, media, { cacheControl: MEDIA_THUMB_FALLBACK_CACHE_CONTROL });
  } catch (error) {
    return mediaRefusal(id, error);
  }
}
