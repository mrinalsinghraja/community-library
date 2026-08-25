import type { Metadata } from "next";
import Link from "next/link";

import { ModerationActions } from "@/app/desk/reviews/moderation-actions";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/icon";
import { StarVerdict } from "@/components/ui/star-rating";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listReviewsForStaff } from "@/server/services/review-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reviews" };

/**
 * What the children wrote, and the one control that takes a review down.
 *
 * This screen exists because reviews are published the moment they are written.
 * That was a deliberate choice — a pre-approval queue nobody works is a feature
 * that silently never ships — and the price of it is that somebody has to be
 * able to look at the list. This is that list, newest first, with the words in
 * full rather than truncated: a review you cannot read is a review you cannot
 * judge.
 *
 * Guarded by `book.edit`. Somebody who may change what a book's page says is the
 * same person who decides what stays on it.
 *
 * The author's name is here and is not a leak: a librarian already holds
 * `member.view` and can open that child's page. It is here because moderating
 * anonymous text is how a librarian ends up unable to have a quiet word with
 * the child who wrote it — and a quiet word is almost always the right response
 * to something a nine-year-old typed.
 *
 * "Signed: no name" describes the byline on the public page, not this screen.
 * A child choosing not to be named in front of other readers is not asking to
 * be anonymous to the librarian who knows them.
 */
export default async function DeskReviewsPage() {
  const actor = await requirePermissionForPage("book.edit", {
    signedOutTo: "/login?next=/desk/reviews",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const reviews = await listReviewsForStaff();
  const withWords = reviews.filter((review) => review.review !== null);
  const hidden = reviews.filter((review) => review.hiddenAt !== null);

  return (
    <StaffShell branding={branding} actor={actor} title="Reviews">
      <p className="text-base text-ink-soft">
        {reviews.length === 0
          ? "No one has rated a book yet."
          : `${reviews.length === 1 ? "1 rating" : `${reviews.length} ratings`}, ${
              withWords.length === 1 ? "1 with words" : `${withWords.length} with words`
            }${hidden.length > 0 ? `, ${hidden.length} taken down` : ""}.`}
      </p>

      {/*
        Said once, at the top, every time. A librarian opening this screen for
        the first time in a month needs to know that nothing here is waiting for
        their approval — the words are already on the shelf.
      */}
      {reviews.length > 0 ? (
        <Callout tone="info" title="These are already on the books' pages" className="mt-5">
          Reviews go up as soon as a reader writes them. Have a read through now and then, and take
          down anything that names a person, gives away where somebody lives, or is unkind. Taking
          one down removes it from the book&rsquo;s page and from its stars — the reader is told it
          is no longer showing, and is never told why.
        </Callout>
      ) : null}

      <div className="mt-6">
        {reviews.length === 0 ? (
          <EmptyState
            illustration={<Icon name="star" />}
            title="Nothing rated yet"
            action={
              <ButtonLink href="/admin/books" variant="secondary" icon={<Icon name="book" />}>
                The book list
              </ButtonLink>
            }
          >
            When a reader gives a book stars, it appears here — with whatever they wrote about it.
          </EmptyState>
        ) : (
          <DataTable headers={["Book", "Stars", "What they wrote", "Reader", "When", ""]}>
            {reviews.map((review) => (
              <tr key={review.id} className="border-t-2 border-hairline align-top">
                <td className="px-3.5 py-2.5 align-top">
                  {review.code ? (
                    <Link
                      href={`/books/${encodeURIComponent(review.code)}`}
                      className="font-bold text-primary-deep"
                    >
                      {review.title}
                    </Link>
                  ) : (
                    <span className="font-bold text-ink">{review.title}</span>
                  )}
                  {review.hiddenAt ? (
                    <p className="mt-1.5">
                      <StatusBadge tone="neutral">
                        <Icon name="hide" /> Taken down
                      </StatusBadge>
                    </p>
                  ) : null}
                  {review.hiddenReason ? (
                    <p className="mt-1 text-sm text-ink-soft">{review.hiddenReason}</p>
                  ) : null}
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <StarVerdict rating={review.rating} />
                  <span className="sr-only">{review.rating} out of 5</span>
                </td>

                {/*
                  In full, never clipped. A review shortened to two lines with an
                  ellipsis is a review a librarian has to click into to judge,
                  and a moderation screen that needs a click per row is one
                  nobody finishes.
                */}
                <td className="max-w-md px-3.5 py-2.5 align-top">
                  {review.review ? (
                    <p className="whitespace-pre-line text-base text-ink">{review.review}</p>
                  ) : (
                    <p className="text-base text-ink-faint">Stars only</p>
                  )}
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <p className="font-bold text-ink">{review.authorName}</p>
                  {review.authorMemberCode ? (
                    <p className="code text-base text-ink-soft">{review.authorMemberCode}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-ink-soft">
                    {review.attribution === "ANONYMOUS"
                      ? "Signed: no name"
                      : "Signed with first name"}
                  </p>
                </td>

                <td className="whitespace-nowrap px-3.5 py-2.5 align-top text-base text-ink-soft">
                  {formatInTimezone(review.createdAt, settings.timezone, "d MMM yyyy")}
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <ModerationActions
                    reviewId={review.id}
                    hidden={review.hiddenAt !== null}
                    title={review.title}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </StaffShell>
  );
}
