import { NextResponse } from "next/server";

import { isReportFormat, isReportKey } from "@/lib/reports";
import { isAppError } from "@/server/lib/errors";
import { exportReport } from "@/server/services/report-service";

/**
 * The only way a report leaves the building.
 *
 * A route handler rather than a server action because a download needs to set
 * `Content-Disposition` on a real HTTP response, which an action cannot do.
 * That costs the CSRF protection actions get for free, so it is bought back
 * explicitly below.
 *
 * Authorization is not here. It is in `exportReport`, which asks for
 * `report.view`, and in the list service behind each report, which asks for
 * whatever that screen already demands. This file's job is to parse a request,
 * hand it over, and turn an error into a status code.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rejects a request this application did not make.
 *
 * Server actions carry an origin check of their own; a route handler does not,
 * and a form on someone else's site can POST to this one with the reader's
 * cookies attached. Cross-origin rules stop the attacker *reading* the reply,
 * so a stolen spreadsheet is not the risk — but a page that can make a
 * librarian's browser silently emit "a list of children was exported" into the
 * audit log has made the audit log lie, and that is worth a header check.
 *
 * `Sec-Fetch-Site` is sent by every browser that matters and cannot be set by
 * script. `Origin` is the fallback for anything that does not send it.
 */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

interface ExportBody {
  format?: unknown;
  selectedIds?: unknown;
  filter?: unknown;
}

/** Query-string filters are strings; anything else in the body is discarded. */
function readFilter(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const filter: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.length <= 200) filter[key] = entry;
  }
  return filter;
}

function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    // An id is a cuid or a uuid. A cap keeps a hostile body from becoming a
    // very large `Set` before anything has checked who is asking.
    .filter((entry) => entry.length > 0 && entry.length <= 64)
    .slice(0, 5000);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Bad request" }, { status: 403 });
  }

  const { report } = await params;
  if (!isReportKey(report)) {
    return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  }

  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const format = typeof body.format === "string" ? body.format : "";
  if (!isReportFormat(format)) {
    return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  }

  try {
    const file = await exportReport({
      report,
      format,
      selectedIds: readIds(body.selectedIds),
      filter: readFilter(body.filter),
    });

    return new NextResponse(file.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.length),
        // The filename is already reduced to letters, digits, hyphens and one
        // dot before it gets here, so it cannot break out of the quoting.
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        // A list of children must not sit in a shared cache, a proxy, or the
        // back/forward cache of a shared family device.
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(
        { error: error.friendlyMessage },
        { status: error.httpStatus },
      );
    }
    throw error;
  }
}
