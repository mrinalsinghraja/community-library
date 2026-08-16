import { NextResponse, type NextRequest } from "next/server";

import { runDailyMaintenance } from "@/server/lib/maintenance";

/**
 * Daily scheduled job. Triggered by Vercel Cron at 03:00 UTC (08:30 in
 * Asia/Kolkata) — see vercel.json.
 *
 * Guarded by CRON_SECRET: without it, anyone who guessed the path could run
 * housekeeping at will. When the secret is not configured the route refuses
 * outright rather than running unauthenticated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    // No detail: an unauthorised caller learns nothing about why.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await runDailyMaintenance();

  return NextResponse.json(
    { status: "ok", ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
