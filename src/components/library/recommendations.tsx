"use client";

import Link from "next/link";
import { useActionState } from "react";

import { BookCover } from "@/components/library/book-cover";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import {
  refreshRecommendationsAction,
  type RecommendationFormState,
} from "@/server/actions/recommendation-actions";
import type { RecommendationSet } from "@/server/services/recommendation-service";

/**
 * "Based on your past reading, the AI Librarian recommends…"
 *
 * Three books, each with one sentence about why this reader in particular. The
 * sentence is the whole feature: three covers under a heading is a shelf, and a
 * child already has one of those. "Because you liked the funny animal ones" is
 * a librarian.
 *
 * Two things this card is careful never to become.
 *
 * It is never a **promise**. A suggestion is not a reservation, and a card that
 * reads like one sends a child down to the room for a book somebody else is
 * already reading. Hence the footnote, and hence the honest status on each
 * cover rather than a hidden one.
 *
 * It is never **automatic**. Nothing here calls a model during a page render.
 * The card shows what was suggested last time, instantly, from our own
 * database; asking for new ones is a button a reader presses. A child who never
 * opens this costs the library nothing, and a model having a slow day delays a
 * click rather than the page they came for.
 */

const INITIAL: RecommendationFormState = { status: "idle" };

export function Recommendations({
  set,
  messages,
  className,
}: {
  set: RecommendationSet | null;
  messages: {
    heading: string;
    intro: string;
    tooNew: string;
    refresh: string;
    stale: string;
    footnote: string;
  };
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    async () => refreshRecommendationsAction(),
    INITIAL,
  );

  return (
    <Card as="section" tone="plain" className={cn("border-l-4 border-l-primary", className)}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent-ink"
        >
          <Icon name="sparkle" />
        </span>
        {/*
          The AI is named, not hinted at. A parent reading over a shoulder
          should be able to tell in one glance that a computer chose these and
          a person did not.
        */}
        <h2 className="text-xl leading-tight text-ink">{messages.heading}</h2>
      </div>

      {set ? (
        <>
          {/*
            The model's own sentence about what it noticed, introduced by ours.
            Ours is fixed and says where the suggestion came from; its own is
            the part that makes the card feel read rather than generated.
          */}
          <p className="mt-3 text-base text-ink-soft">
            {messages.intro} — <span className="font-semibold text-ink">{set.basis}</span>
          </p>

          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {set.books.map((book) => (
              <li key={book.code} className="list-none">
                <Link
                  href={`/books/${encodeURIComponent(book.code)}`}
                  className="lift group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface-sunk no-underline"
                >
                  <BookCover
                    coverMediaId={book.coverMediaId}
                    title={book.title}
                    className="rounded-none"
                  />
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <h3 className="line-clamp-2 font-display text-base leading-snug font-bold text-ink group-hover:text-accent-ink">
                      {book.title}
                    </h3>
                    <p className="line-clamp-1 text-sm text-ink-soft">{book.authors.join(", ")}</p>
                    {/*
                      The model's sentence, in the accent ink so it reads as the
                      suggestion rather than as catalogue data. It sits beside
                      our title and our author, never instead of them — the
                      model gets to say why, not what the book is called.
                    */}
                    <p className="mt-1 text-sm text-accent-ink">{book.why}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {set.stale ? <p className="mt-3 text-sm text-ink-faint">{messages.stale}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-base text-ink-soft">{messages.tooNew}</p>
      )}

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-button)] border-2 border-control-border bg-surface px-5 text-base font-semibold text-ink transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-60"
        >
          <Icon name="sparkle" />
          {pending ? "Thinking…" : messages.refresh}
        </button>
        {/*
          `role="status"` rather than an alert: a suggestion that could not be
          fetched is not an emergency, and a child using a screen reader should
          hear it when they get to it rather than have it interrupt them.
        */}
        <span role="status" className="text-sm text-ink-soft">
          {state.status === "error" ? state.message : null}
        </span>
      </form>

      <p className="mt-3 text-sm text-ink-faint">{messages.footnote}</p>
    </Card>
  );
}
