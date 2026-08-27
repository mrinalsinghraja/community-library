import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CoverThumbnail } from "@/components/library/cover-viewer";
import { Butterfly } from "@/components/library/library-logo";
import { PageBody, PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StarVerdict } from "@/components/ui/star-rating";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { REVIEW_MESSAGES, ratingLabel } from "@/lib/reviews";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listOwnReviews } from "@/server/services/review-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "What I thought" };

/**
 * Everything a child has ever said about a book.
 *
 * **There is no id in this URL and none in the query behind it.**
 * `listOwnReviews` takes no parameters and reads the session, exactly like
 * `listOwnLoans` — nothing here for a curious nine-year-old to change, and no
 * ownership check for a future edit to forget.
 *
 * It is a reading diary rather than a management screen. Newest first, with the
 * stars and the words as they were written, and every row links back to the
 * book so that changing your mind is one tap away rather than a control that
 * has to be duplicated here.
 *
 * The one thing this page shows that no other does: whether a review is still
 * on the book's page. A librarian who takes something down leaves no mark on
 * the public list — but the child who wrote it is told, here, in the one place
 * that is theirs.
 */
export default async function MyReviewsPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();
  if (!actor) redirect("/login?next=/my-reviews");

  const reviews = await listOwnReviews();
  // Staff have no library card, so "what I thought" is not a question with an
  // answer for them.
  if (!reviews) redirect("/desk");

  const { settings } = await getCurrentLibrary();

  return (
    <PublicShell branding={branding}>
      <PageBody width="wide">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-10 opacity-70 sm:w-12" />

        {/*
          The back link needs a block of its own. The heading is `inline-block`
          — it has to be, or the garden rule under it would stretch the full
          width of the page — and an inline-block heading after an inline link
          shares its line and lands on top of it.
        */}
        <p>
          <Link
            href="/my-books"
            className="inline-flex items-center gap-2 text-lg font-bold text-primary-deep"
          >
            <Icon name="arrowRight" className="rotate-180" />
            My books
          </Link>
        </p>

        <h1 className="garden-rule mt-6 inline-block text-4xl">What I thought</h1>

        <p className="mt-9 text-lg text-ink-soft">
          {reviews.length === 0
            ? "Every book you rate will be kept here."
            : reviews.length === 1
              ? "One book, in your own words."
              : `${reviews.length} books, in your own words.`}
        </p>

        {reviews.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              illustration={<Icon name="star" />}
              title="No stars yet — but there will be"
              action={
                <ButtonLink href="/my-books" size="lg" icon={<Icon name="myBooks" />}>
                  See my books
                </ButtonLink>
              }
            >
              When you bring a book back, you can give it stars and say what you thought. It all
              gathers here.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-8 grid list-none gap-4 p-0 xl:grid-cols-2">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-lift sm:flex-row sm:p-6"
              >
                <span className="w-16 shrink-0 self-start sm:w-20">
                  <CoverThumbnail
                    coverMediaId={review.coverMediaId}
                    title={review.title}
                    sizes="80px"
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-xl leading-snug font-bold text-ink">
                    {review.code ? (
                      <Link
                        href={`/books/${encodeURIComponent(review.code)}#review-form-heading`}
                        className="text-ink no-underline hover:text-primary-deep"
                      >
                        {review.title}
                      </Link>
                    ) : (
                      review.title
                    )}
                  </h2>
                  <p className="mt-1 text-base text-ink-soft">{review.authors.join(", ")}</p>

                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <StarVerdict rating={review.rating} className="text-lg" />
                    <span className="text-base font-semibold text-ink">
                      {ratingLabel(review.rating)}
                    </span>
                  </p>

                  {review.review ? (
                    <p className="mt-3 text-lg leading-relaxed text-ink">{review.review}</p>
                  ) : null}

                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-base text-ink-soft">
                    <span>
                      {formatInTimezone(review.updatedAt, settings.timezone, "d MMM yyyy")}
                    </span>
                    <span aria-hidden="true">·</span>
                    {/*
                      Whether their name is on it. A child who chose to be
                      quiet about one book and named on another should be able
                      to see which is which without opening both.
                    */}
                    <span>
                      {review.attribution === "ANONYMOUS"
                        ? "Signed: no name"
                        : "Signed with your first name"}
                    </span>
                  </p>

                  {/*
                    Where it stands. This is the only screen that tells a reader
                    whether their own review is on the shelf, waiting, or has
                    been sent back — and, when it has, what the librarian asked
                    them to change.
                  */}
                  <p className="mt-3">
                    {review.status === "PUBLISHED" ? (
                      <StatusBadge tone="available">
                        <Icon name="check" /> {REVIEW_MESSAGES.publishedBadge}
                      </StatusBadge>
                    ) : review.status === "REJECTED" ? (
                      <StatusBadge tone="neutral">
                        <Icon name="info" /> {REVIEW_MESSAGES.declinedBadge}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="soon">
                        <Icon name="info" /> {REVIEW_MESSAGES.waitingBadge}
                      </StatusBadge>
                    )}
                  </p>

                  {review.status === "PENDING" ? (
                    <p className="mt-2 text-base text-ink-soft">{REVIEW_MESSAGES.waiting}</p>
                  ) : null}

                  {review.status === "REJECTED" ? (
                    <>
                      <p className="mt-2 text-base text-ink-soft">{REVIEW_MESSAGES.declined}</p>
                      {review.decisionNote ? (
                        <p className="mt-1 text-base text-ink">
                          &ldquo;{review.decisionNote}&rdquo;
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink href="/books" size="lg" icon={<Icon name="search" />}>
            Find another book
          </ButtonLink>
          <ButtonLink href="/my-books" variant="secondary" size="lg" icon={<Icon name="myBooks" />}>
            My books
          </ButtonLink>
        </div>
      </PageBody>
    </PublicShell>
  );
}
