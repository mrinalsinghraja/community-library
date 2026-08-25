import "server-only";

import {
  HISTORY_MAX_MESSAGES,
  QUESTIONS_PER_HOUR,
  normaliseQuestion,
  presetById,
  stripMarkdown,
  type BookChatTurn,
} from "@/lib/book-chat";
import {
  GroqUnavailableError,
  INJECTION_THRESHOLD,
  bookHelperEnabled,
  groqAnswer,
  groqInjectionRisk,
  type GroqMessage,
} from "@/server/lib/ai/groq";
import { buildBookHelperPrompt } from "@/server/lib/ai/book-prompt";
import { checkActionThrottle, recordAction } from "@/server/lib/rate-limit";
import { getBranding } from "@/server/lib/settings";
import { getBookByCode } from "@/server/services/catalogue-service";

/**
 * "Tell me more about this book."
 *
 * The one place the library answers a question it was not asked in advance, and
 * therefore the one place that needed its guards written down rather than
 * assumed. In order:
 *
 * 1. **Is the helper switched on at all** — no key, no feature, no chat box.
 * 2. **May this person see this book** — `getBookByCode` enforces
 *    `catalogue_visibility` exactly as the page above it does. If the shelf is
 *    members-only, a signed-out visitor cannot reach the book *or* ask about
 *    it, and the answer to both is the same "no such book".
 * 3. **Has this place asked too much** — twenty questions an hour from one IP.
 * 4. **Does the question look like an attack** — free text only, and only after
 *    the cheap checks above have passed.
 * 5. **The system prompt** does the rest, and is the real boundary.
 *
 * What is deliberately absent: **nothing is written down.** No question, no
 * answer, no audit row, no `email_event`, nothing. The rate-limit counter
 * records that *a* question was asked from a hashed IP and not what it was.
 * These are children typing about books, often clumsily and sometimes about
 * things that are worrying them, and a library that kept a transcript of that
 * would have built a thing it could not justify keeping. See ADR-060.
 *
 * There is also no session requirement, because the catalogue is public: a
 * grandmother deciding whether to walk over may ask what a book is about. What
 * she cannot do is borrow it, and that is enforced somewhere else entirely.
 */

export type BookChatFailure = "unavailable" | "off-topic" | "busy" | "failed";

export type BookChatResult =
  | { ok: true; answer: string }
  | { ok: false; reason: BookChatFailure };

export interface AskAboutBookInput {
  /** The code printed on the book's own label. */
  code: string;
  /** One of `PRESET_QUESTIONS`, when the reader pressed a button. */
  presetId?: string | null;
  /** What the reader typed, when they did not. */
  question?: string | null;
  /** The last few turns, from the browser tab. Never trusted, only trimmed. */
  history?: readonly BookChatTurn[];
  /** For the throttle. Hashed before it is stored, never kept raw. */
  ip: string | null;
}

/**
 * Turns whatever arrived into the single question we will actually ask.
 *
 * A preset wins over typed text, and a preset is looked up by id in our own
 * table — the browser sends `"author"`, not a sentence, so the wording of the
 * five buttons cannot be rewritten by whoever is calling this route.
 */
function resolveQuestion(input: AskAboutBookInput): { text: string; typed: boolean } | null {
  if (input.presetId) {
    const preset = presetById(input.presetId);
    return preset ? { text: preset.question, typed: false } : null;
  }

  const typed = normaliseQuestion(input.question ?? "");
  return typed ? { text: typed, typed: true } : null;
}

/**
 * The conversation so far, as the model will see it.
 *
 * The history comes from the browser and is therefore forged-by-default: it is
 * capped, trimmed, and every entry is re-labelled from our own two roles, so
 * the worst a tampered history can do is put words in the helper's mouth within
 * a conversation only that one tab can see. It can never carry a `system` turn,
 * because this function does not know how to emit one.
 */
function historyMessages(history: readonly BookChatTurn[] | undefined): GroqMessage[] {
  if (!history?.length) return [];

  return history
    .slice(-HISTORY_MAX_MESSAGES)
    .filter((turn) => typeof turn.text === "string" && turn.text.trim().length > 0)
    .map((turn) => ({
      role: turn.role === "helper" ? ("assistant" as const) : ("user" as const),
      content: turn.text.trim().slice(0, 600),
    }));
}

export async function askAboutBook(input: AskAboutBookInput): Promise<BookChatResult> {
  if (!bookHelperEnabled()) return { ok: false, reason: "unavailable" };

  const asked = resolveQuestion(input);
  if (!asked) return { ok: false, reason: "failed" };

  // Throws NOT_FOUND or NOT_AUTHENTICATED for a book this visitor may not see.
  // The route turns that into a 404, which is the same answer a book that never
  // existed gets.
  const book = await getBookByCode(input.code);

  const throttle = await checkActionThrottle({
    bucket: "book-chat",
    subject: input.ip,
    max: QUESTIONS_PER_HOUR,
    windowMinutes: 60,
  });
  if (!throttle.allowed) return { ok: false, reason: "busy" };

  /*
   * Only typed questions are screened, and only after the throttle — a preset
   * is our own sentence, so paying eighty milliseconds to classify text we
   * wrote ourselves would be checking our own handwriting.
   */
  if (asked.typed) {
    const risk = await groqInjectionRisk(asked.text);
    if (risk >= INJECTION_THRESHOLD) {
      // Counted like any other question. A refusal that costs nothing is a
      // refusal worth retrying two hundred times.
      await recordAction("book-chat", input.ip);
      return { ok: false, reason: "off-topic" };
    }
  }

  const branding = await getBranding();

  const messages: GroqMessage[] = [
    {
      role: "system",
      content: buildBookHelperPrompt({
        title: book.title,
        authors: book.authors,
        categoryName: book.categoryName,
        ageGroup: book.ageGroup,
        libraryName: branding.libraryName,
      }),
    },
    ...historyMessages(input.history),
    { role: "user", content: asked.text },
  ];

  try {
    const answer = await groqAnswer(messages);
    await recordAction("book-chat", input.ip);
    // The prompt asks for plain sentences; this makes sure of it. See
    // `stripMarkdown` for why an instruction alone was not enough.
    return { ok: true, answer: stripMarkdown(answer) };
  } catch (error) {
    if (error instanceof GroqUnavailableError) {
      return { ok: false, reason: error.reason === "rate-limited" ? "busy" : "failed" };
    }
    throw error;
  }
}
