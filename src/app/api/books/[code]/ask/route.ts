import { NextResponse } from "next/server";

import { BOOK_CHAT_MESSAGES, type BookChatTurn } from "@/lib/book-chat";
import { isAppError } from "@/server/lib/errors";
import { askAboutBook, type BookChatFailure } from "@/server/services/book-chat-service";

/**
 * Where a child's question goes.
 *
 * A route handler rather than a server action because this is a conversation:
 * the browser holds the thread, posts one question at a time and renders the
 * answer without a navigation. Server actions revalidate a page, and there is
 * no page here to revalidate.
 *
 * That costs the CSRF protection actions get for free, so it is bought back
 * with the same origin check `/api/labels` and `/api/reports` use. It matters
 * less here — the endpoint reads nothing and writes nothing a person can see —
 * but an endpoint that spends somebody else's API allowance should not be
 * callable from another site's page.
 *
 * Authorization is not in this file. `askAboutBook` calls `getBookByCode`,
 * which enforces `catalogue_visibility`, and this file turns a thrown error
 * into a status code.
 *
 * **The Groq key never appears in this file or anywhere downstream of the
 * response.** It is read inside `server-only` code, used server-side, and the
 * browser receives one string of English.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rejects a request this application did not make. Same rule as `/api/labels`. */
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

/**
 * Who is asking, for the throttle only.
 *
 * Never stored raw — `recordAction` hashes it — and never attached to a
 * question, an answer or a person. On Vercel `x-forwarded-for` is a list; the
 * first entry is the client.
 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

/** The browser's history array, trusted for nothing beyond its shape. */
function readHistory(value: unknown): BookChatTurn[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { role, text } = entry as { role?: unknown; text?: unknown };
    if (role !== "reader" && role !== "helper") return [];
    if (typeof text !== "string") return [];
    return [{ role, text }];
  });
}

const STATUS: Record<BookChatFailure, number> = {
  // 503, not 500: the helper being switched off is a configuration state, not a
  // fault, and the page should say so gently rather than look broken.
  unavailable: 503,
  "off-topic": 200,
  busy: 429,
  failed: 502,
};

const MESSAGE: Record<BookChatFailure, string> = {
  unavailable: BOOK_CHAT_MESSAGES.unavailable,
  "off-topic": BOOK_CHAT_MESSAGES.offTopic,
  busy: BOOK_CHAT_MESSAGES.busy,
  failed: BOOK_CHAT_MESSAGES.failed,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: BOOK_CHAT_MESSAGES.failed }, { status: 403 });
  }

  const { code } = await params;

  let body: { presetId?: unknown; question?: unknown; history?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: BOOK_CHAT_MESSAGES.failed }, { status: 400 });
  }

  try {
    const result = await askAboutBook({
      code: decodeURIComponent(code),
      presetId: typeof body.presetId === "string" ? body.presetId : null,
      question: typeof body.question === "string" ? body.question : null,
      history: readHistory(body.history),
      ip: clientIp(request),
    });

    if (result.ok) {
      return NextResponse.json({ answer: result.answer });
    }

    /*
     * An off-topic refusal is a 200 carrying an `answer`, not an error. The
     * helper *did* reply — it said it only knows about books — and a child
     * should see that sentence in the conversation like any other, rather than
     * a red box telling them something went wrong.
     */
    if (result.reason === "off-topic") {
      return NextResponse.json({ answer: MESSAGE["off-topic"] });
    }

    return NextResponse.json(
      { error: MESSAGE[result.reason] },
      { status: STATUS[result.reason] },
    );
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "NOT_AUTHENTICATED")) {
      // The same answer for a book that does not exist and a book this visitor
      // may not see. Asking the helper must not become a way to find out which.
      return NextResponse.json({ error: BOOK_CHAT_MESSAGES.failed }, { status: 404 });
    }
    throw error;
  }
}
