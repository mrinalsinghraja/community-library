import { Icon } from "@/components/ui/icon";
import { StarVerdict } from "@/components/ui/star-rating";
import { RatingSummaryLine } from "@/components/ui/star-rating";
import { formatInTimezone } from "@/lib/dates";
import { ratingLabel, type RatingSummary } from "@/lib/reviews";
import type { PublicReview } from "@/server/services/review-service";

/**
 * What readers said, on the book's own page.
 *
 * The byline arrives already resolved — a first name the reader chose to
 * publish, or "A reader at the library". This component has no access to a
 * display name, a member code or an id, so no edit to it can leak one.
 *
 * Two things are deliberately missing, and both would be in the Amazon version:
 *
 *   * **No "was this helpful?", no votes, no replies.** Children rating each
 *     other's opinions is a different feature with a much worse failure mode,
 *     and it is not this one.
 *   * **No sort control and no "most critical" tab.** Newest first, always.
 *     Every ordering other than time is a way of promoting one child's writing
 *     over another's.
 *
 * A review that a librarian has taken down is not here and leaves no gap: a
 * space marked "removed" tells every other reader something happened and invites
 * them to guess what.
 */
export function BookReviews({
  reviews,
  summary,
  timezone,
}: {
  reviews: PublicReview[];
  summary: RatingSummary;
  timezone: string;
}) {
  return (
    <section aria-labelledby="reviews-heading" className="mt-14">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="reviews-heading" className="garden-rule inline-block text-2xl sm:text-3xl">
          What readers thought
        </h2>
      </div>

      <div className="mt-9">
        <RatingSummaryLine summary={summary} size="lg" emptyLabel="Nobody has rated this one yet" />
      </div>

      {reviews.length === 0 ? (
        /*
         * Not an EmptyState illustration. A book with no reviews is the normal
         * state of most of this shelf on most days, and drawing a big empty
         * panel for it would make every quiet book look broken.
         */
        <p className="mt-6 text-lg text-ink-soft">
          {summary.count === 0
            ? "Be the first — borrow it, then come back and tell everyone what you thought."
            : "No one has written about this one yet, but some readers have given it stars."}
        </p>
      ) : (
        <ul className="mt-8 flex list-none flex-col gap-4 p-0">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="rounded-[var(--radius-card)] bg-surface p-5 shadow-lift sm:p-6"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StarVerdict rating={review.rating} className="text-lg" />
                <span className="text-base font-semibold text-ink">
                  {ratingLabel(review.rating)}
                </span>
              </div>

              {review.review ? (
                <p className="mt-3 text-lg leading-relaxed text-ink">{review.review}</p>
              ) : null}

              {/*
                The byline is under the words, not over them — what somebody
                thought of the book is the thing worth reading, and whose
                opinion it was is the footnote. A first name at most, ever.
              */}
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-ink-soft">
                <Icon name="reader" className="text-ink-faint" />
                <span className="font-semibold text-ink">{review.byline}</span>
                <span aria-hidden="true">·</span>
                <span>{formatInTimezone(review.createdAt, timezone, "d MMM yyyy")}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
