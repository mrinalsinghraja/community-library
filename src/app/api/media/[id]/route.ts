import { mediaRefusal, mediaResponse } from "@/server/lib/media-response";
import { getAuthorizedMedia } from "@/server/services/media-service";

/**
 * The only way a stored object is ever read.
 *
 * There is no public path, no CDN URL and no signed URL for a child's
 * photograph. Every byte served goes through the authorization decision in
 * `getAuthorizedMedia`, on this request, for this viewer.
 *
 * Every failure — signed out, wrong child, unknown id, object pending deletion —
 * returns the same bare 404. A 403 would confirm that an id is real, which turns
 * this route into an oracle for enumerating which children have photographs.
 */

export const dynamic = "force-dynamic";
/** Node, not edge: the storage drivers and Prisma both need it. */
export const runtime = "nodejs";

/*
 * How a response may be cached is decided per purpose in
 * `src/server/lib/uploads.ts` (`MEDIA_CACHE_CONTROL`, `MEDIA_MAY_REVALIDATE`),
 * alongside the reason a child's photograph keeps `no-store`. The headers
 * themselves are built in `src/server/lib/media-response.ts`, shared with the
 * thumbnail route so the two can never drift apart. See ADR-072.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    return mediaResponse(request, await getAuthorizedMedia(id));
  } catch (error) {
    return mediaRefusal(id, error);
  }
}
