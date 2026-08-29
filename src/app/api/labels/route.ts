import { NextResponse } from "next/server";

import { bookFilterProblems, parseBookFilter } from "@/lib/book-filter";
import { MAX_LABELS, isLabelSize } from "@/lib/labels";
import { isAppError } from "@/server/lib/errors";
import { printBookLabels } from "@/server/services/label-service";

/**
 * The only way a sheet of labels leaves the building.
 *
 * A route handler rather than a server action for the same reason the report
 * exports are one: a download needs `Content-Disposition` on a real HTTP
 * response, which an action cannot set. That costs the CSRF protection actions
 * get for free, so it is bought back with the origin check below.
 *
 * Authorization is not here. It is in `printBookLabels`, which asks for
 * `report.view`, and in `listBooksForStaff` behind it, which asks for the
 * catalogue permissions. This file parses a request and turns an error into a
 * status code.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rejects a request this application did not make.
 *
 * `Sec-Fetch-Site` is sent by every browser that matters and cannot be set by
 * script. `Origin` is the fallback for anything that does not send it. Same
 * rule, same reasoning, as `/api/reports/[report]`.
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

interface LabelBody {
  filter?: unknown;
  size?: unknown;
  cutGuides?: unknown;
  selectedIds?: unknown;
}

function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry.length > 0 && entry.length <= 64)
    .slice(0, MAX_LABELS);
}

/**
 * The filter, read the same way the screens read it.
 *
 * The body is JSON rather than a query string, so it is reduced to the shape
 * `parseBookFilter` takes and handed to the same validator the book list uses.
 * One definition of what a filter may say, whichever door the request came in
 * through — an alternative parser here is how a screen and an endpoint start
 * disagreeing about what "archived" means.
 */
function readFilter(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const params: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === "string") params[key] = entry;
  }
  return parseBookFilter(params);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Bad request" }, { status: 403 });
  }

  let body: LabelBody;
  try {
    body = (await request.json()) as LabelBody;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const size = typeof body.size === "string" && isLabelSize(body.size) ? body.size : "standard";

  /*
   * A day the librarian typed is a day in the library's own timezone, not an
   * instant in UTC — but that resolution happens inside the service, which is
   * the layer that reads the setting. This route only refuses a filter that
   * cannot mean anything, so the person gets a sentence rather than an empty
   * sheet.
   */
  const filter = readFilter(body.filter);
  const [problem] = bookFilterProblems(filter);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const file = await printBookLabels({
      filter,
      size,
      cutGuides: body.cutGuides !== false,
      selectedIds: readIds(body.selectedIds),
    });

    return new NextResponse(file.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.length),
        // The filename is already reduced to letters, digits, hyphens and one
        // dot before it gets here, so it cannot break out of the quoting.
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.friendlyMessage }, { status: error.httpStatus });
    }
    throw error;
  }
}
