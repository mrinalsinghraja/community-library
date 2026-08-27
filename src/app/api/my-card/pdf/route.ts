import { NextResponse } from "next/server";

import { cardFileName } from "@/lib/library-card";
import { isAppError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import { resolveCardMark } from "@/server/reports/card-mark";
import { renderLibraryCardPdf } from "@/server/reports/library-card-pdf";
import { getOwnLibraryCard } from "@/server/services/card-service";

/**
 * Your own card, as a PDF.
 *
 * A route handler rather than a server action because a download needs
 * `Content-Disposition` on a real HTTP response, which an action cannot set —
 * the same reason `/api/labels` and `/api/reports/[report]` are routes.
 *
 * There is no id in this URL and none in the service behind it. The card that
 * comes back is the card belonging to whoever holds the session, so there is
 * nothing here to tamper with and no member enumeration to guard against.
 *
 * `no-store` matters more than usual: the response contains a child's name,
 * their code and their flat, and a shared cache holding it keyed only by URL —
 * a URL identical for every reader — would hand one child's card to the next.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const facts = await getOwnLibraryCard();

    // Staff, or a member row that does not exist. Not an error worth a stack.
    if (!facts) {
      return NextResponse.json({ error: "No library card for this account." }, { status: 404 });
    }

    const { settings } = await getCurrentLibrary();
    // The library's own mark, so the file a family keeps is the card they were
    // shown rather than a plainer relative of it.
    const mark = await resolveCardMark(facts.logoUrl);
    const pdf = await renderLibraryCardPdf(facts, settings.timezone, mark);

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${cardFileName(facts.memberCode, "pdf")}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_AUTHENTICATED") {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }
    throw error;
  }
}
