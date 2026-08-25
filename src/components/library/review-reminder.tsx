import Link from "next/link";

import { CoverThumbnail } from "@/components/library/cover-viewer";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { REMINDER_MAX_SHOWN, reminderHeadline } from "@/lib/reviews";
import type { ReviewPrompt } from "@/server/services/review-service";

/**
 * "You read these — what did you think?"
 *
 * The nudge, and the whole difficulty of it is tone. A list of unfinished tasks
 * on a child's own screen is the fastest way to make them stop opening it, so
 * this one is built to be ignorable:
 *
 *   * **It is an invitation, not a badge.** No red dot, no counter in the
 *     masthead, no "1 overdue task". The heading says books are waiting for
 *     stars, which is a nice thing to be told.
 *   * **It names three at most.** A child who read all summer could come back
 *     to eleven, and a card listing eleven chores is a card nobody starts. The
 *     rest are summed up in a half-sentence.
 *   * **It expires.** Sixty days after a book goes back the prompt is gone for
 *     good — see `REVIEW_REMINDER_DAYS`. A reminder that never leaves is not a
 *     reminder, it is a debt.
 *   * **It renders nothing when there is nothing to ask.** Not an empty state,
 *     not "all caught up!" — a card congratulating a child for having no
 *     homework is still a card about homework.
 *
 * Each book links straight to its own page, where the stars are. There is no
 * rating control on this card on purpose: rating a book from a list, without
 * its cover and its title in front of you, is how you get five stars for a book
 * somebody has half-forgotten.
 */
export function ReviewReminder({
  prompts,
  className,
}: {
  prompts: ReviewPrompt[];
  className?: string;
}) {
  if (prompts.length === 0) return null;

  const shown = prompts.slice(0, REMINDER_MAX_SHOWN);
  const rest = prompts.length - shown.length;

  return (
    <Card tone="primary" className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn"
        >
          <Icon name="star" className="size-6" />
        </span>
        <div className="flex flex-col">
          <h2 className="garden-rule inline-block self-start text-xl">
            {reminderHeadline(prompts.length)}
          </h2>
          <p className="mt-4 text-base text-ink-soft">
            You brought {prompts.length === 1 ? "this one" : "these"} back. Telling everyone what
            you thought helps the next reader choose.
          </p>
        </div>
      </div>

      <ul className="flex list-none flex-col gap-2 p-0">
        {shown.map((prompt) => (
          <li key={prompt.code}>
            <Link
              href={`/books/${encodeURIComponent(prompt.code)}#review-form-heading`}
              className="flex items-center gap-3 rounded-[var(--radius-field)] bg-surface px-3 py-2.5 no-underline transition-colors hover:bg-accent-wash"
            >
              <span className="w-9 shrink-0">
                <CoverThumbnail
                  coverMediaId={prompt.coverMediaId}
                  title={prompt.title}
                  variant="thumb"
                  sizes="36px"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 block text-base font-semibold text-ink">
                  {prompt.title}
                </span>
                <span className="line-clamp-1 block text-sm text-ink-soft">
                  {prompt.authors.join(", ")}
                </span>
              </span>
              {/*
                Five outline stars as the affordance. They say what the link is
                for in the one glyph a child already associates with it, and
                being empty is the point — this is the thing they have not done.
              */}
              <span aria-hidden="true" className="flex shrink-0 gap-0.5 text-ink-faint">
                {[0, 1, 2, 3, 4].map((index) => (
                  <Icon key={index} name="star" className="size-4" />
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {rest > 0 ? (
        <p className="text-sm text-ink-soft">
          {rest === 1 ? "And one more book" : `And ${rest} more books`} you have read.
        </p>
      ) : null}

      <p>
        <ButtonLink href="/my-reviews" variant="secondary" size="sm" icon={<Icon name="quote" />}>
          Everything I have said
        </ButtonLink>
      </p>
    </Card>
  );
}
