import { NextResponse } from "next/server";

import { getHealthReport } from "@/server/lib/health";

/**
 * Liveness probe for uptime monitoring.
 *
 * Reveals only whether the process is up and whether the database answers.
 * No version numbers, no configuration, no counts — an unauthenticated endpoint
 * should tell an outsider nothing they could use.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, databaseReachable } = await getHealthReport();

  return NextResponse.json(
    { status },
    {
      status: databaseReachable ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
