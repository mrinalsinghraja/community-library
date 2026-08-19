import { NextResponse } from "next/server";

import { isAppError } from "@/server/lib/errors";
import { MEDIA_MAY_REVALIDATE } from "@/server/lib/uploads";
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
 * Which objects may be revalidated rather than re-sent is decided in
 * `src/server/lib/uploads.ts`, alongside the rest of the upload rules and the
 * reason a child's photograph is not on that list. It is unit-tested there.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const media = await getAuthorizedMedia(id);

    const cacheable = MEDIA_MAY_REVALIDATE.has(media.purpose);
    const etag = cacheable ? `"${media.checksumSha256}"` : null;

    if (etag && request.headers.get("if-none-match") === etag) {
      // Authorization has already been decided above, on this request, for this
      // viewer. Only then is the shortcut offered.
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "private, no-cache, must-revalidate",
        },
      });
    }

    return new NextResponse(Buffer.from(media.bytes) as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.byteSize),
        // Never a shared cache. `private` keeps it out of any proxy; a child's
        // photograph additionally gets `no-store`, which keeps it off a shared
        // family device's disk cache after they sign out.
        "Cache-Control": cacheable
          ? "private, no-cache, must-revalidate"
          : "private, no-store, max-age=0, must-revalidate",
        ...(etag ? { ETag: etag } : {}),
        // The bytes were sniffed on upload; this stops a browser second-guessing
        // the declared type and executing something.
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        // Defence in depth: even if a non-image ever reached storage, it is
        // served with no privileges at all.
        "Content-Security-Policy": "default-src 'none'; sandbox; base-uri 'none'",
        /*
         * next.config.ts already sets strict-origin-when-cross-origin globally
         * and that wins, so this is not repeated here. It is the right value
         * anyway: the id in the path is an opaque uuid, not a credential, and
         * authorization is decided per request rather than by knowing the URL.
         */
      },
    });
  } catch (error) {
    // One response for every refusal, including unexpected errors — the reason
    // belongs in the server log, not in a response to whoever is probing.
    if (!isAppError(error)) {
      console.error(`Media request for ${id} failed:`, error);
    }
    return new NextResponse(null, { status: 404 });
  }
}
