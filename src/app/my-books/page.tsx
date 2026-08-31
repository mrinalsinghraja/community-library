import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ReturnAnnouncement } from "@/app/my-books/return-announcement";
import { RenewalRequest } from "@/app/my-books/renewal-request";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { DueCountdownPanel } from "@/components/library/due-countdown";
import { MessageBoard } from "@/components/library/message-board";
import { ReadersBoard } from "@/components/library/readers-board";
import { Recommendations } from "@/components/library/recommendations";
import { VisitTimes } from "@/components/library/visit-times";
import { ReviewReminder } from "@/components/library/review-reminder";
import { PageBody, PublicShell } from "@/components/layout/site-shell";
import { Butterfly } from "@/components/library/library-logo";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { BORROW_REQUEST_MESSAGES, readerDueSentence, readerLoanBadge } from "@/lib/circulation";
import { formatInTimezone } from "@/lib/dates";
import { loanCountdown } from "@/lib/due-countdown";
import { currentMonthWindow, previousMonthWindow } from "@/lib/readers-board";
import { currentNotice } from "@/server/services/announcement-service";
import { readersOfLastMonth, readersOfTheMonth } from "@/server/services/readers-board-service";
import {
  RECOMMENDATION_MESSAGES,
  canRecommend,
  getStoredRecommendations,
} from "@/server/services/recommendation-service";
import { listVisitWeek } from "@/server/services/visit-service";
import { pendingReviewPrompts } from "@/server/services/review-service";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import {
  listOwnBorrowRequests,
  listOwnLoans,
  type ReaderLoanCard,
} from "@/server/services/circulation-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My books" };

/**
 * A child's own books.
 *
 * **There is no id in this URL, and there is no id in the query behind it.**
 * `listOwnLoans` takes no parameters at all and reads the session — so there is
 * nothing here for a curious nine-year-old to change, no ownership check to
 * forget, and no way for this page to render somebody else's books even if
 * every other guard failed.
 *
 * The wording is the point of this screen as much as the data. This library
 * never threatens a consequence, and a child who is late is not in trouble.
 * "Ready to come home 🏠" instead of "OVERDUE", a date instead of a count of
 * days, one polite sentence instead of a warning. All of it lives in
 * `src/lib/circulation.ts` so that no template can invent a harsher version.
 *
 * Nothing on this page mentions another child. There is no "borrowed by", no
 * queue position, no "back on Tuesday" for a book somebody else has — the
 * catalogue says a book is being read and stops there.
 */
export default async function MyBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const branding = await getBrandingSafe();
  const actor = await getActor();
  if (!actor) redirect("/login?next=/my-books");

  const { settings } = await getCurrentLibrary();
  const loans = await listOwnLoans();

  // Staff have no library card, so "your books" is not a question with an
  // answer for them. Send them where their books actually are.
  if (!loans) redirect("/desk/loans");

  const { active, history, limit, renewalPeriodDays } = loans;

  // Books this child has asked for and not got yet. Kept separate from the
  // shelf on purpose: a book they have asked for is not a book they have.
  const asked = await listOwnBorrowRequests();

  // Two boards, in no order either of them: the month being written, and the
  // one that finished. The running card can be filled on the second of the
  // month by whoever borrowed on the first, and empties as the month turns
  // over; the finished card is what stops that reset from erasing a whole
  // month of somebody's reading.
  const [boardReaders, lastMonthReaders] = await Promise.all([
    readersOfTheMonth(),
    readersOfLastMonth(),
  ]);
  const now = new Date();
  const boardMonth = currentMonthWindow(now).label;
  const lastBoardMonth = previousMonthWindow(now).label;

  // Books brought back inside the last two months that this child has not rated
  // yet. Empty is the normal state and renders nothing at all.
  const reviewPrompts = await pendingReviewPrompts();

  // The notice board and the week's opening times. Both are about the library
  // rather than about this child, which is why they sit above the shelf and not
  // inside it — and why the week travels in the URL: "next week" has to be a
  // page a parent can be sent, not a piece of state that dies on refresh.
  const notice = await currentNotice();

  /*
   * What the AI Librarian last suggested, read from our own database.
   *
   * Deliberately NOT a call to a model. This runs on every render of the page,
   * and a page that waited on a network round trip to a third party before it
   * could show a child their own books would be a page that sometimes does not
   * load. Asking for new suggestions is a button; see `Recommendations`.
   *
   * `eligible` is separate from `recommendations` because they answer different
   * questions: a reader with two loans and no suggestions yet should see the
   * card with its invitation, and a reader with no loans at all should not see
   * the card at all.
   */
  const eligible = await canRecommend();
  const recommendations = eligible ? await getStoredRecommendations() : null;

  const { week: weekParam } = await searchParams;
  const week = await listVisitWeek(Number.parseInt(weekParam ?? "0", 10) || 0);

  return (
    <PublicShell branding={branding}>
      <PageBody width="wide">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-10 opacity-70 sm:w-12" />
        <h1 className="garden-rule inline-block text-4xl">My books</h1>

        {/*
          The board first, because a notice is only worth posting if it is read
          before the thing the reader came for.
        */}
        <MessageBoard notice={notice} className="mt-8" />

        {/*
          The board sits beside the greeting on a wide screen and beneath it on
          a narrow one. Beside, because it is the first thing worth noticing on
          the page; beneath rather than above on a phone, because a child opened
          this screen to find their own books and somebody else's month should
          never be what greets them.
        */}
        {/* ---------------------------------------------------------------- */}
        {/* Two columns from xl up: the child's own books on the left, what    */}
        {/* the library has to say on the right.                              */}
        {/*                                                                   */}
        {/* It used to be two columns for the greeting alone. The sidebar sat  */}
        {/* in the top right and every section after it ran the full width     */}
        {/* underneath, so on a wide screen this page was a narrow ribbon with */}
        {/* a third of the window empty either side — and it was long because  */}
        {/* it was narrow. The shelf, the asks, the suggestions and the        */}
        {/* history now share the left column with the sidebar beside all of   */}
        {/* them, which is most of the scrolling gone without cutting a card.  */}
        {/*                                                                   */}
        {/* Three grid children, not two, and each placed explicitly from xl   */}
        {/* up. The sidebar has to sit BETWEEN the greeting and the shelf on a */}
        {/* phone and BESIDE both on a wide screen, and one main column cannot */}
        {/* do that: whatever the sidebar follows in the source is where it    */}
        {/* lands when the columns collapse. Placed like this, a phone still   */}
        {/* reads greeting, then the library's news, then your own books.      */}
        {/* ---------------------------------------------------------------- */}
        <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-12">
          <p className="text-lg text-ink-soft xl:col-start-1 xl:row-start-1">
            {active.length === 0
              ? "You have nothing borrowed right now."
              : active.length === 1
                ? "You have one book at home."
                : `You have ${active.length} books at home.`}{" "}
            {/* The limit comes from library settings, never a literal. */}
            You can have {limit === 1 ? "one book" : `${limit} books`} at a time.
          </p>

          <aside
            aria-label="From the library"
            className="flex w-full flex-col gap-6 xl:col-start-2 xl:row-span-2 xl:row-start-1"
          >
            {/*
              The nudge above the board. A child's own unfinished business
              outranks somebody else's month; neither outranks the sentence
              telling them how many books they have at home, which is what they
              opened this page to read.
            */}
            <ReviewReminder prompts={reviewPrompts} />
            {/*
              Anchored, because the week links jump back to this card rather
              than to the top of a page the reader has already scrolled past.
            */}
            <div id="visit-times" className="scroll-mt-6">
              <VisitTimes week={week} venueName={settings.venueName} />
            </div>
            <ReadersBoard
              readers={boardReaders}
              title="Readers of the month"
              monthLabel={boardMonth}
              running
            />
            {/*
              Directly under the running one, because the two are read as a
              pair: this is who is reading now, and this is who was reading
              before the board reset. Without the second card a child's month
              vanishes at midnight on the last day of it.
            */}
            <ReadersBoard
              readers={lastMonthReaders}
              title="Readers of last month"
              monthLabel={lastBoardMonth}
              running={false}
            />
          </aside>

          <div className="flex min-w-0 flex-col xl:col-start-1 xl:row-start-2">

        {active.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              illustration={<Icon name="sparkle" />}
              title="Your shelf is empty — for now!"
              action={
                <ButtonLink href="/books" size="lg" icon={<Icon name="search" />}>
                  Find something to read
                </ButtonLink>
              }
            >
              Find a book in the catalogue and ask for it — the librarian will get it ready for
              you in the library room.
            </EmptyState>
          </div>
        ) : (
          <section aria-labelledby="shelf" className="mt-12">
            {/*
              The active books get a heading of their own. The history below
              always had one, so the books a child actually holds were the only
              unnamed section on the page — and "your reading shelf" is what
              this screen is for.
            */}
            <h2 id="shelf" className="garden-rule inline-block text-2xl">
              Your reading shelf
            </h2>
            {/*
              One card per row, not two.
              
              The shelf was a two-column grid until the countdown arrived, and
              three columns of content — jacket, title, days left — inside half
              a page left every one of them too narrow to breathe. A child has
              two or three books out, so a single column costs nothing in
              scrolling and gives the number the room that makes it readable
              from across a table.
            */}
            <ul className="mt-8 grid gap-5">
            {active.map((loan) => (
              <ActiveBookCard
                key={loan.code}
                loan={loan}
                timezone={settings.timezone}
                renewalPeriodDays={renewalPeriodDays}
              />
            ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Books asked for, not yet in a bag                                 */}
        {/*                                                                   */}
        {/* Deliberately its own section, below the shelf. A book a child has  */}
        {/* asked for is not a book they have, and putting the two in one list */}
        {/* would let a child believe the library had promised them something  */}
        {/* it has not. Approved requests never appear here — an approved      */}
        {/* request became a loan, and shows up on the shelf above.            */}
        {/* ---------------------------------------------------------------- */}
        {asked.length > 0 ? (
          <section aria-labelledby="asked" className="mt-14">
            <h2 id="asked" className="garden-rule inline-block text-2xl">
              Books you have asked for
            </h2>
            <p className="mt-8 text-ink-soft">{BORROW_REQUEST_MESSAGES.collectionNote}</p>

            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {asked.map((request) => (
                <li
                  key={request.copyCode}
                  className="flex items-start gap-4 rounded-[var(--radius-card)] bg-surface-sunk px-5 py-4"
                >
                  <span className="w-12 shrink-0">
                    <CoverThumbnail
                      coverMediaId={request.coverMediaId}
                      title={request.title}
                      variant="thumb"
                      sizes="48px"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-ink">
                      <Link href={`/books/${encodeURIComponent(request.copyCode)}`}>
                        {request.title}
                      </Link>
                    </p>
                    <p className="mt-1 text-base text-ink-soft">
                      {request.state === "pending"
                        ? BORROW_REQUEST_MESSAGES.pending
                        : BORROW_REQUEST_MESSAGES.declined}
                    </p>
                    {/*
                      The librarian's own words, when they said no. A child who
                      is told "not this one" and nothing else has been refused
                      by a machine; a child who is told why has been answered by
                      a person.
                    */}
                    {request.decisionNote ? (
                      <p className="mt-1 text-base text-ink">
                        &ldquo;{request.decisionNote}&rdquo;
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* What to read next                                                 */}
        {/*                                                                   */}
        {/* Below the shelf and above the history, which is where the question */}
        {/* actually arrives: a child reads what they have, then wonders what   */}
        {/* comes after it. Hidden entirely for a reader with almost no         */}
        {/* borrowing behind them — a suggestion drawn from one book is a guess */}
        {/* dressed up as a recommendation, and children notice.                */}
        {/* ---------------------------------------------------------------- */}
        {eligible ? (
          <Recommendations
            set={recommendations}
            messages={RECOMMENDATION_MESSAGES}
            className="mt-14"
          />
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Books already brought back                                        */}
        {/* ---------------------------------------------------------------- */}
        {history.length > 0 ? (
          <section aria-labelledby="history" className="mt-14">
            <h2 id="history" className="garden-rule inline-block text-2xl">
              Books you have read
            </h2>
            <p className="mt-8 text-ink-soft">
              Everything you have borrowed and brought back. Borrowing the same book again
              starts a new line here.
            </p>

            <p className="mt-3">
              <ButtonLink
                href="/my-reviews"
                variant="secondary"
                size="sm"
                icon={<Icon name="quote" />}
              >
                What I thought of them
              </ButtonLink>
            </p>

            {/*
              Two columns once there is room. A history row is a thumbnail and
              three short lines — at full width each was a stripe of mostly
              empty paper, and twenty finished books were twenty screens of it.
            */}
            <ul className="mt-6 grid gap-3 lg:grid-cols-2">
              {history.map((loan, index) => (
                // Keyed by code AND position: the same physical copy can appear
                // more than once, because borrowing it again is a new loan and
                // never a rewrite of the old one.
                <li
                  key={`${loan.code}-${index}`}
                  className="flex items-center gap-4 rounded-[var(--radius-field)] bg-surface-sunk p-4"
                >
                  <span className="w-12 shrink-0">
                    <CoverThumbnail
                      coverMediaId={loan.coverMediaId}
                      title={loan.title}
                      variant="thumb"
                      sizes="48px"
                    />
                  </span>
                  <span className="flex flex-1 flex-col">
                    {/*
                      A link now, not plain text. A book on this list is the one
                      a child is most likely to want to say something about, and
                      before this the only route back to it was searching the
                      catalogue for a book they had already read.
                    */}
                    <Link
                      href={`/books/${encodeURIComponent(loan.code)}`}
                      className="text-base font-semibold text-ink no-underline hover:text-primary-deep"
                    >
                      {loan.title}
                    </Link>
                    <span className="text-base text-ink-soft">{loan.authors.join(", ")}</span>
                    <span className="text-base text-ink-soft">
                      Borrowed {formatInTimezone(loan.issuedAt, settings.timezone, "d MMM yyyy")}
                      {loan.returnedAt
                        ? ` · Brought back ${formatInTimezone(loan.returnedAt, settings.timezone, "d MMM yyyy")}`
                        : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink href="/books" size="lg" icon={<Icon name="search" />}>
            Find another book
          </ButtonLink>
          <ButtonLink href="/account" variant="secondary" size="lg" icon={<Icon name="reader" />}>
            My library card
          </ButtonLink>
        </div>
          </div>
        </div>
      </PageBody>
    </PublicShell>
  );
}

function ActiveBookCard({
  loan,
  timezone,
  renewalPeriodDays,
}: {
  loan: ReaderLoanCard;
  timezone: string;
  renewalPeriodDays: number;
}) {
  const badge = readerLoanBadge(loan, timezone);
  const sentence = readerDueSentence(loan, timezone);
  const countdown = loanCountdown({ status: "ACTIVE", dueAt: loan.dueAt }, timezone);

  return (
    <Card as="li" tone="shelf" className="lift flex flex-col gap-5 sm:flex-row">
      <span className="w-28 shrink-0 self-start sm:w-36">
        <CoverThumbnail
          coverMediaId={loan.coverMediaId}
          title={loan.title}
          sizes="(min-width: 640px) 144px, 112px"
        />
      </span>

      <div className="flex flex-1 flex-col gap-2">
        <CardTitle as="h3">
          <Link href={`/books/${encodeURIComponent(loan.code)}`} className="text-ink no-underline hover:text-primary-deep">
            {loan.title}
          </Link>
        </CardTitle>
        <p className="text-ink-soft">{loan.authors.join(", ")}</p>

        <CardBody className="mt-1">
          <p className="flex items-center gap-2">
            <Icon name="book" className="text-ink-faint" />
            Borrowed{" "}
            <strong className="text-ink">{formatInTimezone(loan.issuedAt, timezone, "d MMM")}</strong>
          </p>
        </CardBody>

        <p className="mt-2">
          {/*
            The emoji is decorative and hidden from screen readers; the word
            never is. Status is never carried by colour alone.
          */}
          <StatusBadge tone={badge.tone}>
            <span aria-hidden="true">{badge.mark}</span> {badge.label}
          </StatusBadge>
        </p>

        <p className="text-base text-ink-soft">{sentence}</p>

        {/*
          The countdown sits after the kind sentence, not instead of it. The
          number answers "how long have I got"; the sentence is still the one
          that says please, and on an overdue book it is the sentence that
          carries the tone rather than the colour.
        */}
        {countdown ? (
          <DueCountdownPanel countdown={countdown} className="mt-3 self-start sm:hidden" />
        ) : null}

        {loan.donorAcknowledgement ? (
          <p className="mt-1 text-base text-ink-soft">{loan.donorAcknowledgement}</p>
        ) : null}

        {/*
          Asking to keep it. The child can ask; the librarian decides — nothing
          on this screen changes a due date, and the card goes on saying the
          date the library actually holds until somebody at the desk agrees.
        */}
        <RenewalRequest
          code={loan.code}
          title={loan.title}
          state={loan.renewalState}
          canAsk={loan.canAskToKeep}
          blockedReason={loan.askBlockedReason}
          renewalPeriodDays={renewalPeriodDays}
        />

        {/*
          Telling the library it is coming back. Deliberately below the ask, and
          deliberately not a "Return" button: this writes a note and nothing
          else. The book is still theirs, still due on the same day, and still
          BORROWED until a librarian takes it in at the desk.
        */}
        <ReturnAnnouncement
          code={loan.code}
          title={loan.title}
          announced={loan.returnAnnouncedAt !== null}
          canAnnounce={loan.canAnnounceReturn}
        />
      </div>

      {countdown ? (
        <DueCountdownPanel
          countdown={countdown}
          className="hidden w-44 shrink-0 self-start sm:flex"
        />
      ) : null}
    </Card>
  );
}
