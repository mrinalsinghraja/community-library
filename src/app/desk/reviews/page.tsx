import type { Metadata } from "next";
import Link from "next/link";

import { ModerationActions } from "@/app/desk/reviews/moderation-actions";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/icon";
import { DeskSelection, SelectionCheckbox } from "@/components/desk/selection-toolbar";
import { bulkDecideReviewsAction } from "@/server/actions/review-actions";
import { StarVerdict } from "@/components/ui/star-rating";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listReviewsForStaff, type StaffReview } from "@/server/services/review-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reviews" };

/**
 * The queue: what children have written and nobody has answered yet.
 *
 * This screen changed shape with ADR-058. It used to be an archive with a
 * take-down button, because reviews published themselves; now nothing reaches a
 * book's page without passing through here, which makes it the one desk screen
 * where a delay is visible to a child. Waiting sorts first for that reason, and
 * the count is on the desk navigation beside the borrow requests.
 *
 * Guarded by `review.moderate` — the authority to decide is exactly the
 * authority to read what is waiting. **Delete forever is not on that key.** It
 * needs `review.delete`, which only the Super Admin holds, and the button is not
 * rendered without it; the service checks again regardless.
 *
 * The author's name is here and is not a leak: a librarian already holds
 * `member.view` and can open that child's page. It is here because moderating
 * anonymous text is how a librarian ends up unable to have a quiet word with the
 * child who wrote it — and a quiet word is almost always the right response to
 * something a nine-year-old typed.
 *
 * "Signed: no name" describes the byline on the public page, not this screen. A
 * child choosing not to be named in front of other readers is not asking to be
 * anonymous to the librarian who knows them.
 */
export default async function DeskReviewsPage() {
  const actor = await requirePermissionForPage("review.moderate", {
    signedOutTo: "/login?next=/desk/reviews",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const reviews = await listReviewsForStaff();
  const waiting = reviews.filter((review) => review.status === "PENDING");
  const published = reviews.filter((review) => review.status === "PUBLISHED");

  const canDelete = actor.permissions.has("review.delete");

  return (
    <StaffShell branding={branding} actor={actor} title="Reviews" pendingReviews={waiting.length}>
      <p className="text-base text-ink-soft">
        {reviews.length === 0
          ? "No one has rated a book yet."
          : waiting.length === 0
            ? `Nothing waiting. ${published.length === 1 ? "1 review is" : `${published.length} reviews are`} on the books' pages.`
            : `${waiting.length === 1 ? "1 review is" : `${waiting.length} reviews are`} waiting for you.`}
      </p>

      {/*
        Said once, at the top, every time. A librarian opening this screen needs
        to know that the queue is the whole gate — a review nobody answers is a
        review no child ever sees appear, which is the failure mode this design
        trades for its safety.
      */}
      {reviews.length > 0 ? (
        <Callout tone="info" title="Nothing goes up until you say so" className="mt-5">
          A reader sees their own review straight away and is told it is waiting for you. Publish it
          and it appears on the book&rsquo;s page and counts towards its stars — permanently, so
          please read it first. Send it back instead and the reader is shown your note and can
          rewrite it.
          {canDelete ? (
            <>
              {" "}
              A published review can only be deleted by you, and deleting is forever.
            </>
          ) : null}
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
            When a reader gives a book stars, it appears here — with whatever they wrote about it —
            and waits for you.
          </EmptyState>
        ) : (
          <DeskSelection
            ids={reviews.filter((review) => review.status === "PENDING").map((review) => review.id)}
            bulk={
              actor.permissions.has("review.moderate")
                ? {
                    noun: "review",
                    nounPlural: "reviews",
                    run: bulkDecideReviewsAction,
                    actions: [
                      {
                        value: "APPROVE",
                        label: "Put them all up",
                        tone: "primary",
                        notePrompt: null,
                        confirm:
                          "Put {count} {review|reviews} on the shelf? Each one goes up under the reader's own first name and stays up — putting a review back is a Super Admin's job. Every word is on this page above; please make sure you have read them.",
                      },
                      {
                        value: "REJECT",
                        label: "Send them all back",
                        tone: "secondary",
                        notePrompt: "One short note for every reader you are sending back to:",
                        confirm:
                          "Send {count} {review|reviews} back? Every one of these readers gets the same note, so write one that makes sense to all of them.",
                      },
                    ],
                  }
                : undefined
            }
          >
          <DataTable headers={["", "Book", "Stars", "What they wrote", "Reader", "When", "", ""]}>
            {reviews.map((review) => (
              <tr key={review.id} className="border-t-2 border-hairline align-top">
                <td className="px-3.5 py-2.5 align-top">
                  {/*
                    Only a review still waiting can be acted on, so only one has
                    a tick box. An already-published review with a checkbox
                    beside it would invite a press that could do nothing.
                  */}
                  {review.status === "PENDING" ? (
                    <SelectionCheckbox
                      id={review.id}
                      label={`${review.title} — ${review.authorName}`}
                    />
                  ) : null}
                </td>

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
                  {review.decisionNote ? (
                    <p className="mt-1.5 text-sm text-ink-soft">
                      Sent back: &ldquo;{review.decisionNote}&rdquo;
                    </p>
                  ) : null}
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
                  <ReviewStatusBadge status={review.status} />
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <ModerationActions
                    reviewId={review.id}
                    status={review.status}
                    title={review.title}
                    canDelete={canDelete}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
          </DeskSelection>
        )}
      </div>
    </StaffShell>
  );
}

/** Where a review stands, in a word and never in a colour alone. */
function ReviewStatusBadge({ status }: { status: StaffReview["status"] }) {
  if (status === "PUBLISHED") {
    return (
      <StatusBadge tone="available">
        <Icon name="check" /> On the page
      </StatusBadge>
    );
  }
  if (status === "REJECTED") {
    return (
      <StatusBadge tone="neutral">
        <Icon name="cross" /> Sent back
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="soon">
      <Icon name="info" /> Waiting
    </StatusBadge>
  );
}
