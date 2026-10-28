import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { activeStaffEmail, sendEmailSamples } from "@/server/lib/email";

/**
 * Sends one sample of every email the library sends, to a member of staff
 * (ADR-076). For the operator, from a terminal:
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        -d '{"to":"staff@example.org"}' https://<host>/api/email-samples
 *
 * Guarded like the cron route, by CRON_SECRET. And the recipient must be the
 * address of an ACTIVE staff account in this library — so even a leaked secret
 * cannot point this at a family or at a stranger. Samples carry made-up names
 * and dead links only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

export async function POST(request: NextRequest) {
  const ok = authorised(request);
  if (ok === null) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { to?: unknown; only?: unknown } | null;
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  // Optional: just these templates, e.g. ["registration_received"].
  const only = Array.isArray(body?.only)
    ? body.only.filter((value): value is string => typeof value === "string")
    : undefined;

  const recipient = await activeStaffEmail(to);
  if (!recipient) {
    return NextResponse.json(
      { error: "Samples go only to an active staff account's own address." },
      { status: 400 },
    );
  }

  const results = await sendEmailSamples(recipient, only);
  return NextResponse.json(
    { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
