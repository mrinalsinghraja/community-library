"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  BOOK_CHAT_MESSAGES,
  HISTORY_MAX_MESSAGES,
  PRESET_QUESTIONS,
  QUESTION_MAX_CHARS,
  normaliseQuestion,
  type BookChatTurn,
} from "@/lib/book-chat";

/**
 * The book helper, on the page of the book it is talking about.
 *
 * Inline rather than a floating bubble in a corner, for three reasons. A panel
 * hovering over a children's page covers the thing the child came to look at;
 * on a phone it covers most of it. It reads as an advertisement, which is the
 * one thing this must never look like. And placed here — after the book's
 * facts, before what other readers thought — it sits exactly where the
 * question actually occurs to somebody: *is this book for me?*
 *
 * The conversation lives in this component and nowhere else. Nothing is saved,
 * nothing is sent anywhere on unmount, and closing the tab ends it. The last
 * few turns travel with each new question only so that "and what else did they
 * write?" knows who "they" is.
 *
 * Presets are pressed far more often than the box is typed in, so they are
 * whole questions on real buttons rather than a row of topic words, and each
 * one leaves the row once it has been asked — a child should not have to
 * remember which of five they have already pressed.
 */

interface Exchange extends BookChatTurn {
  id: number;
}

export function BookHelper({ code, title }: { code: string; title: string }) {
  const [thread, setThread] = useState<Exchange[]>([]);
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "alert" | "quiet" } | null>(null);
  const [usedPresets, setUsedPresets] = useState<string[]>([]);

  const nextId = useRef(0);
  const threadEnd = useRef<HTMLDivElement>(null);

  // Keep the newest answer in view without stealing the whole page: this scrolls
  // the thread's own end marker, not the document, so a reader who has scrolled
  // up to the cover is not yanked back down.
  useEffect(() => {
    if (thread.length > 0) {
      threadEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [thread]);

  const remainingPresets = PRESET_QUESTIONS.filter(
    (preset) => !usedPresets.includes(preset.id),
  );

  async function ask(payload: { presetId?: string; question?: string; shown: string }) {
    if (asking) return;

    setNotice(null);
    setAsking(true);

    const question: Exchange = { id: nextId.current++, role: "reader", text: payload.shown };
    // The child's own words go up immediately. Waiting for the server to echo
    // them back makes a fast thing feel slow.
    const history = thread.slice(-HISTORY_MAX_MESSAGES).map(({ role, text }) => ({ role, text }));
    setThread((current) => [...current, question]);

    try {
      const response = await fetch(`/api/books/${encodeURIComponent(code)}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: payload.presetId ?? null,
          question: payload.question ?? null,
          history,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string; tone?: "alert" | "quiet" }
        | null;

      if (data?.answer) {
        setThread((current) => [
          ...current,
          { id: nextId.current++, role: "helper", text: data.answer as string },
        ]);
      } else {
        setNotice({
          text: data?.error ?? BOOK_CHAT_MESSAGES.failed,
          tone: data?.tone ?? "alert",
        });
      }
    } catch {
      setNotice({ text: BOOK_CHAT_MESSAGES.failed, tone: "alert" });
    } finally {
      setAsking(false);
    }
  }

  function askPreset(id: string, label: string, sentence: string) {
    setUsedPresets((current) => [...current, id]);
    void ask({ presetId: id, shown: label || sentence });
  }

  function askTyped(event: React.FormEvent) {
    event.preventDefault();

    const question = normaliseQuestion(typed);
    if (!question) {
      setNotice({ text: BOOK_CHAT_MESSAGES.emptyQuestion, tone: "quiet" });
      return;
    }

    setTyped("");
    void ask({ question, shown: question });
  }

  function startAgain() {
    setThread([]);
    setUsedPresets([]);
    setNotice(null);
    setTyped("");
  }

  return (
    <section
      aria-labelledby="book-helper-heading"
      className="mt-12 overflow-hidden rounded-[var(--radius-card)] bg-sky-wash"
    >
      <div className="px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary-deep shadow-lift"
          >
            <Icon name="sparkle" />
          </span>
          <div className="min-w-0">
            <h2 id="book-helper-heading" className="text-2xl leading-tight">
              {BOOK_CHAT_MESSAGES.heading}
            </h2>
            <p className="mt-1 text-base text-ink-soft">{BOOK_CHAT_MESSAGES.intro}</p>
          </div>
        </div>

        {/*
          The thread. `aria-live="polite"` rather than "assertive": an answer
          arriving should be read out when the reader pauses, not cut across
          whatever they are already listening to.
        */}
        {thread.length > 0 ? (
          <div
            aria-live="polite"
            aria-atomic="false"
            className="mt-6 flex flex-col gap-4 border-t border-hairline pt-6"
          >
            {thread.map((turn) =>
              turn.role === "reader" ? (
                <p
                  key={turn.id}
                  className="self-end max-w-[85%] rounded-[var(--radius-card)] bg-primary px-4 py-2.5 text-base text-white"
                >
                  {turn.text}
                </p>
              ) : (
                <div
                  key={turn.id}
                  className="max-w-[92%] rounded-[var(--radius-card)] bg-surface px-4 py-3 shadow-lift"
                >
                  <p className="whitespace-pre-line text-lg leading-relaxed text-ink">
                    {turn.text}
                  </p>
                  {/*
                    Under every single answer, never once at the top. A reader
                    who scrolls straight to the third reply must still be told
                    that a computer wrote it.
                  */}
                  <p className="mt-2.5 flex items-start gap-1.5 text-sm text-ink-soft">
                    <Icon name="info" className="mt-0.5 shrink-0" />
                    {BOOK_CHAT_MESSAGES.disclaimer}
                  </p>
                </div>
              ),
            )}

            {asking ? (
              <p role="status" className="text-base italic text-ink-soft">
                {BOOK_CHAT_MESSAGES.sending}
              </p>
            ) : null}

            <div ref={threadEnd} />
          </div>
        ) : null}

        {remainingPresets.length > 0 ? (
          <div className={thread.length > 0 ? "mt-5" : "mt-5 border-t border-hairline pt-5"}>
            <ul className="flex flex-wrap gap-2.5">
              {remainingPresets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    disabled={asking}
                    onClick={() => askPreset(preset.id, preset.label, preset.question)}
                    className="rounded-[var(--radius-field)] border border-control-border bg-surface px-3.5 py-2 text-left text-base text-ink transition hover:border-primary hover:bg-primary-wash disabled:opacity-50"
                  >
                    {preset.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form onSubmit={askTyped} className="mt-5 flex flex-wrap items-end gap-2.5">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Ask your own question about {title}</span>
            <input
              type="text"
              value={typed}
              maxLength={QUESTION_MAX_CHARS}
              disabled={asking}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={BOOK_CHAT_MESSAGES.placeholder}
              className="min-h-12 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-4 text-base text-ink placeholder:text-ink-faint disabled:opacity-60"
            />
          </label>
          <Button type="submit" disabled={asking} icon={<Icon name="search" />}>
            {asking ? BOOK_CHAT_MESSAGES.sending : BOOK_CHAT_MESSAGES.send}
          </Button>
        </form>

        {/*
          Red is reserved for something actually going wrong. Running out of the
          day's fuel is a state, not a fault — nobody did anything, least of all
          the child — and a warning box tells a nine-year-old they broke it. So
          those arrive as a calm note, announced politely rather than asserted.
        */}
        {notice ? (
          notice.tone === "alert" ? (
            <p role="alert" className="mt-3 text-base font-semibold text-danger">
              {notice.text}
            </p>
          ) : (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 rounded-[var(--radius-field)] bg-surface px-4 py-3 text-base text-ink"
            >
              <Icon name="info" className="mt-1 shrink-0 text-ink-soft" />
              {notice.text}
            </p>
          )
        ) : null}

        {thread.length > 0 ? (
          <Button variant="quiet" size="sm" className="mt-4" onClick={startAgain}>
            {BOOK_CHAT_MESSAGES.clear}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
