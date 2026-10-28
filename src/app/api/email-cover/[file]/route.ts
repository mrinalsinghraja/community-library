import { NextResponse } from "next/server";

import { catalogueIsPubliclyVisible, getCurrentLibrary } from "@/server/lib/settings";
import { readBookCoverForEmail } from "@/server/services/media-service";

/**
 * A book cover for an email, at a plain URL an inbox can fetch (ADR-076).
 *
 * Used when the mail transport cannot carry the cover inside the message
 * (Brevo). Mail clients, and Gmail's image proxy above all, fetch images with
 * no cookie, so this route cannot rely on a session the way `/api/media` does.
 * It is safe without one for two reasons:
 *
 *   • it serves BOOK_COVER objects only — `readBookCoverForEmail` refuses any
 *     other purpose, so no child's photograph can ever come out of it;
 *   • it answers only while the catalogue is public, which is the same switch
 *     that already lets anybody see these covers on /books.
 *
 * The path ends in the file extension (`<id>.webp`) so the page middleware's
 * matcher skips it, and the response is publicly cacheable for a day: Gmail's
 * proxy wants a response it may cache, and a cover changes rarely.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^([0-9a-f-]{36})\.(?:webp|jpg|jpeg|png)$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = ID.exec(file);
  if (!match || !(await catalogueIsPubliclyVisible())) {
    return new NextResponse(null, { status: 404 });
  }

  const { library } = await getCurrentLibrary();
  const cover = await readBookCoverForEmail(match[1]!, library.id);
  if (!cover) return new NextResponse(null, { status: 404 });

  return new NextResponse(Buffer.from(cover.bytes), {
    headers: {
      "Content-Type": cover.mimeType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
