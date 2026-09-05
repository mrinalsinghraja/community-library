import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BookHelper } from "@/app/books/[code]/book-helper";
import { BorrowRequest } from "@/app/books/[code]/borrow-request";
import { ReviewForm } from "@/app/books/[code]/review-form";
import { BookReviews } from "@/components/library/book-reviews";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { Butterfly, LeafSprig } from "@/components/library/library-logo";
import { PageBody, PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { RatingSummaryLine } from "@/components/ui/star-rating";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AGE_BAND_NOTE,
  ageGroupSuggestion,
  borrowCountLabel,
  statusDefinition,
} from "@/lib/catalogue";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { bookHelperEnabled } from "@/server/lib/ai/groq";
import { getBookByCode } from "@/server/services/catalogue-service";
import { getOwnBorrowStateForCode } from "@/server/services/circulation-service";
import {
  getOwnReviewStateForCode,
  reviewsForTitle,
} from "@/server/services/review-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A book" };

/**
 * One book's page.
 *
 * The URL carries the code printed on the book's own label — the thing a child
 * can read off the object in their hand — and not a database id.
 *
 * What is deliberately absent: internal ids, audit information, storage paths,
 * staff notes, the book's condition, and anything at all about who has borrowed
 * it. A child's *loans* are still invisible here — nothing says who has this
 * book or who had it last.
 *
 * What is new is a first name on a review, and only where that reader chose to
 * publish it. That is the one place a name appears in this catalogue, it is
 * never more than a first name, it is attached to an opinion about a book
 * rather than to a borrowing record, and every review carries its own answer to
 * the question. See ADR-057.
 *
 * The cover is given real size and a shadow, because this is the one screen
 * where a child is deciding whether they want the book.
 */
export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const branding = await getBrandingSafe();
  const actor = await getActor();
  const { code } = await params;

  let book;
  try {
    book = await getBookByCode(decodeURIComponent(code));
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_AUTHENTICATED") {
      redirect(`/login?next=/books/${encodeURIComponent(code)}`);
    }
    if (isAppError(error) && error.code === "NOT_FOUND") {
      // A signed-out visitor to a member-only catalogue lands here too, and
      // gets the same answer as somebody asking for a book that never existed.
      if (!actor) redirect(`/login?next=/books/${encodeURIComponent(code)}`);
      notFound();
    }
    throw error;
  }

  const status = statusDefinition(book.status);
  const borrowed = borrowCountLabel(book.borrowCount);
  const { settings } = await getCurrentLibrary();

  /*
   * Three questions about the same book, asked at once because none of them
   * depends on another: may this reader take it home, what did everyone think
   * of it, and what did *they* think of it.
   *
   * Only a reader gets an answer to the first and third; a signed-out visitor
   * and a librarian both get "none", and the controls render nothing at all
   * rather than a disabled button.
   */
  const [borrow, reviews, ownReview] = await Promise.all([
    getOwnBorrowStateForCode(decodeURIComponent(code)),
    reviewsForTitle(book.titleId),
    getOwnReviewStateForCode(decodeURIComponent(code)),
  ]);

  return (
    <PublicShell branding={branding}>
      <PageBody width="detail">
        <Butterfly className="drift pointer-events-none absolute right-4 top-6 w-9 opacity-60 sm:w-12" />

        <Link
          href="/books"
          className="inline-flex items-center gap-2 text-lg font-bold text-primary-deep"
        >
          <Icon name="arrowRight" className="rotate-180" />
          All the books
        </Link>

        <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-10">
          {/*
            Wider than it was. This screen is where a child decides whether they
            want the book, and the jacket is most of that decision — 288px on a
            desktop rather than 240, and the full column width on a phone rather
            than a stamp floating in the middle of it.
          */}
          <div className="w-56 shrink-0 self-center sm:w-72 sm:self-start">
            <div className="overflow-hidden rounded-[var(--radius-card)] shadow-raise">
              {/*
                Tap it to see it properly. Nothing new is fetched and nowhere is
                navigated to — it is the same picture from the same authorised
                route, shown at a size a child can actually look at.
              */}
              <CoverThumbnail
                coverMediaId={book.coverMediaId}
                title={book.title}
                sizes="(min-width: 640px) 288px, 224px"
                className="rounded-none"
              />
            </div>
            {book.coverMediaId ? (
              <p className="mt-2 text-center text-base text-ink-soft">Tap the cover to see it bigger</p>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            {/*
              The shelf, in the small capitals every other page uses for its
              section. Here it is not decoration: it is the one fact that tells
              a child where in the room to walk, and it is said again on a badge
              below because the badge is a filter and this is a location.
            */}
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-ink">
              {book.categoryName}
            </p>
            <h1 className="mt-2 text-4xl leading-tight">{book.title}</h1>
            <p className="mt-2 text-xl text-ink-soft">{book.authors.join(", ")}</p>

            {/*
              Directly under the author, above every badge. It is the first
              thing anyone looks for on a page like this, and it links to the
              reviews below rather than repeating them here.
            */}
            <p className="mt-4">
              <a
                href="#reviews-heading"
                className="inline-flex no-underline hover:opacity-80"
                aria-label={`Read what readers thought of ${book.title}`}
              >
                <RatingSummaryLine summary={book.rating} />
              </a>
            </p>

            {/*
              Under the rating, because it is the other half of the same
              question. A rating says how much the children who read it liked
              it; this says how many there were. On a shelf this size that is
              often the more useful of the two.

              Nothing here identifies a reader: it is a count of loans across
              every copy of this work, with cancelled issues left out. Silent
              until a book has actually gone home once.
            */}
            {borrowed ? <p className="mt-2 text-lg text-ink-soft">{borrowed}</p> : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <StatusBadge tone="neutral">
                <span aria-hidden="true">{book.categoryIcon ?? "📚"}</span> {book.categoryName}
              </StatusBadge>
              {/*
                "Best for 8–10 years", not "8–10 years". The bare label sat
                beside the status badge and read as a condition of borrowing,
                which it has never been — see AGE_BAND_NOTE below and
                `ageGroupSuggestion`.
              */}
              <StatusBadge tone="neutral">{ageGroupSuggestion(book.ageGroup)}</StatusBadge>
              <StatusBadge tone={status.tone}>
                <span aria-hidden="true">{status.mark}</span> {status.readerLabel}
              </StatusBadge>
            </div>

            {/*
              Said in print, not only in a tooltip. A child reading above or
              below their years is exactly the child who would otherwise put a
              book back, and a title attribute does not exist on a phone.
            */}
            <p className="mt-2 text-base text-ink-faint">{AGE_BAND_NOTE}</p>

            {/*
              What to do next, in one sentence, in a panel that changes colour
              with the answer — but never *only* colour: the sentence itself
              says whether the book can be taken home today.
            */}
            <div
              className={`mt-8 flex items-start gap-3 rounded-[var(--radius-card)] px-5 py-4 text-lg ${
                status.onShelf ? "bg-success-wash text-ink" : "bg-surface-sunk text-ink"
              }`}
            >
              <Icon
                name={status.onShelf ? "check" : "info"}
                className={`mt-1 ${status.onShelf ? "text-success" : "text-ink-soft"}`}
              />
              <p>
                {status.onShelf
                  ? "On the shelf in the library room. Ask the librarian and they will get it ready for you."
                  : "This one is not on the shelf right now. Have a look at what else is waiting."}
              </p>
            </div>

            <BorrowRequest
              code={book.code}
              title={book.title}
              state={borrow.state}
              canAsk={borrow.canAsk}
              alreadyBorrowed={borrow.alreadyBorrowed}
              spokenFor={borrow.spokenFor}
              onShelf={status.onShelf}
            />

            {/*
              The visitor's door.
              
              Anybody may read this page and nobody may borrow from it without a
              library card, and the difference has to be said in a sentence
              rather than shown as a missing button. It renders only for the
              signed-out — a librarian is not offered a way to borrow, because
              they are not who this control is for.
            */}
            {!actor ? (
              <div className="mt-6 rounded-[var(--radius-card)] border-l-4 border-l-primary bg-surface-sunk px-5 py-4">
                <p className="text-lg text-ink">
                  Books go home with our readers. If you have a library card, sign in to ask for
                  this one.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <ButtonLink
                    href={`/login?next=/books/${encodeURIComponent(book.code)}`}
                    icon={<Icon name="key" />}
                  >
                    Sign in
                  </ButtonLink>
                  <ButtonLink href="/how-to-join" variant="secondary" icon={<Icon name="reader" />}>
                    How to join
                  </ButtonLink>
                </div>
              </div>
            ) : null}

            {/*
              The thank-you, rendered by the service exactly as the donor chose
              to be credited — named, flat only, or simply "a neighbour". The
              template never sees the raw donation, so it cannot say more than
              the donor agreed to.
            */}
            {book.donorAcknowledgement ? (
              <div className="relative mt-6 overflow-hidden rounded-[var(--radius-card)] bg-accent-wash px-5 py-4">
                <LeafSprig className="pointer-events-none absolute -bottom-2 right-2 w-12 opacity-30" />
                {/*
                  No drawn icon here. The sentence the service returns already
                  opens with a symbol of its own — adding a second one put two
                  marks in front of four words.
                */}
                <p className="relative text-lg text-ink">{book.donorAcknowledgement}</p>
              </div>
            ) : null}

          </div>
        </div>

        {/*
          The book helper.

          Between the book's facts and what other readers made of it, because
          that is where the question occurs: a child has read the title, seen
          the cover, and wants to know whether this one is for them.

          It renders only when a key is configured — no key, no chat box, and
          the rest of the page is unchanged. That is also the off switch.
        */}
        {bookHelperEnabled() ? <BookHelper code={book.code} title={book.title} /> : null}

        {/* ------------------------------------------------------------- */}
        {/* What readers thought                                           */}
        {/*                                                                */}
        {/* Full width, below both columns rather than inside the right    */}
        {/* one. A review is prose and prose needs a measure; squeezed      */}
        {/* beside a 288px jacket it would set at about forty characters a  */}
        {/* line, which is a newspaper column, not a page a child reads.    */}
        {/* ------------------------------------------------------------- */}
        <BookReviews reviews={reviews} summary={book.rating} timezone={settings.timezone} />

        {/*
          The composer, for the one person who has earned it. `canReview` is
          answered from the loan table on the server — a visitor, a librarian
          and a reader who has never borrowed this book all get nothing here,
          and a hand-written POST is refused by the same check.
        */}
        {ownReview.canReview ? (
          <ReviewForm code={book.code} title={book.title} mine={ownReview.mine} />
        ) : null}

        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink href="/books" size="lg" icon={<Icon name="shelf" />}>
            Find another book
          </ButtonLink>
        </div>
      </PageBody>
    </PublicShell>
  );
}
