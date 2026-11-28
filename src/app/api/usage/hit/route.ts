import { NextResponse, type NextRequest } from "next/server";

import { getCurrentLibrary } from "@/server/lib/settings";
import { recordUsage } from "@/server/services/usage-service";

/**
 * Receives one anonymous page-view beacon (ADR-077).
 *
 * The browser sends only the path. The place comes from the host's own request
 * headers, never from anything the page says, and the address and browser are
 * scrambled before anything is stored. A broken or refused count must never
 * show anyone an error, so every outcome is the same empty 204.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CONTENT = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    if (text.length > 1000) return NO_CONTENT();
    const body = JSON.parse(text) as { path?: unknown };

    const { library, settings } = await getCurrentLibrary();
    await recordUsage({
      libraryId: library.id,
      timezone: settings.timezone,
      path: body.path,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      country: request.headers.get("x-vercel-ip-country"),
      region: request.headers.get("x-vercel-ip-country-region"),
      city: request.headers.get("x-vercel-ip-city"),
    });
  } catch {
    // A missed count is not worth a visitor's attention.
  }
  return NO_CONTENT();
}
