import "server-only";

import { env } from "@/server/env";

/**
 * The only place this application speaks to Groq.
 *
 * `server-only` is the whole security model in one import: this module cannot
 * be pulled into a client component, so `env.GROQ_API_KEY` cannot reach a
 * browser bundle by accident. The build fails rather than shipping the key.
 *
 * Deliberately hand-rolled over `fetch` rather than an SDK. This makes two
 * requests to one documented endpoint; an SDK would add a dependency, a
 * transitive tree and an upgrade treadmill to a community library in order to
 * save about forty lines.
 *
 * Nothing here logs a prompt, a question or an answer. The questions are typed
 * by children about books they are holding, and there is no version of "let us
 * keep them for debugging" that is worth the file it would sit in. Failures log
 * a status code and a model name, never a body.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Twelve seconds. Past that a child has stopped waiting and so should we. */
const TIMEOUT_MS = 12_000;

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Distinguishable from a bug so the route can answer "busy" rather than "broken". */
export class GroqUnavailableError extends Error {
  constructor(
    readonly reason: "not-configured" | "rate-limited" | "failed",
    /**
     * From `Retry-After` on a 429, in seconds. Zero when the upstream did not
     * say. This is the only thing separating "everyone try again in a minute"
     * from "the day's allowance is gone", and those two need different
     * sentences on a child's screen.
     */
    readonly retryAfterSeconds = 0,
  ) {
    super(`Groq unavailable: ${reason}`);
    this.name = "GroqUnavailableError";
  }
}

/**
 * Past this, a 429 is the daily allowance rather than a burst.
 *
 * Groq caps requests and tokens both per minute and per day, and answers every
 * one of them with 429. A minute-limit clears while a child is still on the
 * page; a day-limit does not clear until tomorrow, and telling a nine-year-old
 * to "try again shortly" when the true answer is "tomorrow" is a small lie they
 * will discover by pressing the button eleven more times.
 *
 * An hour is the dividing line because no per-minute window can exceed it.
 */
export const DAILY_LIMIT_THRESHOLD_SECONDS = 3600;

/**
 * Whether the helper exists at all.
 *
 * With no key the chat box never renders. That is the off switch: remove
 * `GROQ_API_KEY` from the deployment and the feature disappears from every book
 * page on the next request, with no migration, no setting and no deploy.
 */
export function bookHelperEnabled(): boolean {
  return Boolean(env.GROQ_API_KEY);
}

interface GroqChoice {
  message?: { content?: unknown };
}

async function callGroq(body: Record<string, unknown>): Promise<string> {
  if (!env.GROQ_API_KEY) throw new GroqUnavailableError("not-configured");

  let response: Response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never cached: a shared cache holding one child's question and its
      // answer is a small archive nobody asked for.
      cache: "no-store",
    });
  } catch {
    // Timeout or network. The reason is not interesting and the request body
    // must not be logged, so this says nothing more than that it did not work.
    throw new GroqUnavailableError("failed");
  }

  if (response.status === 429) {
    // `Retry-After` is seconds or an HTTP date; Groq sends seconds, sometimes
    // fractional. Anything unparseable is treated as a short wait, because
    // "try tomorrow" is the more annoying thing to be wrong about.
    const header = response.headers.get("retry-after");
    const seconds = header ? Number.parseFloat(header) : 0;
    throw new GroqUnavailableError(
      "rate-limited",
      Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    );
  }

  if (!response.ok) {
    // Status and model only. An error body from an upstream can echo the
    // request back, and the request contains a child's words.
    console.error(`[book-helper] Groq returned ${response.status} for ${String(body.model)}`);
    throw new GroqUnavailableError("failed");
  }

  const payload = (await response.json()) as { choices?: GroqChoice[] };
  const content = payload.choices?.[0]?.message?.content;

  /*
   * `content` only. The gpt-oss models also return a `reasoning` field — the
   * model's private working out — and it is never read, never returned and
   * never rendered. It is not written for a child and it is not the answer.
   */
  if (typeof content !== "string" || !content.trim()) {
    throw new GroqUnavailableError("failed");
  }

  return content.trim();
}

/** One answer, in a child's reading age, from a system prompt and a short history. */
export async function groqAnswer(messages: readonly GroqMessage[]): Promise<string> {
  return callGroq({
    model: env.GROQ_MODEL,
    messages,
    // Warm enough to sound like a person, cold enough not to invent a
    // publication year it has no business being confident about.
    temperature: 0.4,
    // Roughly a spoken paragraph. The system prompt asks for brevity; this
    // enforces it against a model having an expansive day.
    max_completion_tokens: 320,
    reasoning_effort: "low",
  });
}

/**
 * How much a typed question looks like an attempt to talk the helper out of
 * being a librarian.
 *
 * `llama-prompt-guard-2-86m` answers with a bare probability as text — "0.0005"
 * for an ordinary question, "0.9995" for "ignore all previous instructions".
 * It is 86 million parameters and returns in well under a second, which is why
 * it can sit in front of every free-typed question without being felt.
 *
 * **Fails open, and that is deliberate.** This is the second lock, not the
 * first: the system prompt is what keeps the helper on topic, and a classifier
 * outage must not turn every child's question into a refusal. A guard that
 * breaks the feature when it breaks is a guard nobody keeps switched on.
 */
export async function groqInjectionRisk(question: string): Promise<number> {
  try {
    const verdict = await callGroq({
      model: env.GROQ_GUARD_MODEL,
      messages: [{ role: "user", content: question }],
    });
    const score = Number.parseFloat(verdict);
    return Number.isFinite(score) ? score : 0;
  } catch {
    return 0;
  }
}

/** Above this, the question is answered by the library rather than by the model. */
export const INJECTION_THRESHOLD = 0.8;
