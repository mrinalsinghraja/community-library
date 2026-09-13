import "server-only";

import { NextResponse } from "next/server";

import { isAppError } from "@/server/lib/errors";
import { MEDIA_MAY_REVALIDATE, mediaCacheControl } from "@/server/lib/uploads";
import type { AuthorizedMedia } from "@/server/services/media-service";

/**
 * The response for bytes that `getAuthorizedMedia` has already agreed to serve.
 *
 * Shared by `/api/media/[id]` and `/api/media/[id]/thumb` so that the two can
 * never disagree about headers. Nothing in here makes an authorization decision:
 * by the time it is called, the decision has been made on this request, for this
 * viewer.
 *
 * How long a response may be kept is `mediaCacheControl(purpose)`, decided in
 * `src/server/lib/uploads.ts` with its reasons. A child's photograph comes out of
 * this function with exactly the headers it had before that table existed, and a
 * database test holds them byte for byte.
 */
export function mediaResponse(request: Request, media: AuthorizedMedia): NextResponse {
  const cacheControl = mediaCacheControl(media.purpose);
  const etag = MEDIA_MAY_REVALIDATE.has(media.purpose) ? `"${media.checksumSha256}"` : null;

  if (etag && request.headers.get("if-none-match") === etag) {
    // Authorization has already been decided, on this request, for this viewer.
    // Only then is the shortcut offered.
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": cacheControl,
      },
    });
  }

  return new NextResponse(Buffer.from(media.bytes) as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.byteSize),
      "Cache-Control": cacheControl,
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
}

/**
 * One response for every refusal, including unexpected errors.
 *
 * A 403 would confirm that an id is real, which turns the media routes into an
 * oracle for enumerating which children have photographs. The reason belongs in
 * the server log, not in a response to whoever is probing.
 */
export function mediaRefusal(id: string, error: unknown): NextResponse {
  if (!isAppError(error)) {
    console.error(`Media request for ${id} failed:`, error);
  }
  return new NextResponse(null, { status: 404 });
}
