import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RenewalRequest } from "@/app/my-books/renewal-request";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { PublicShell } from "@/components/layout/site-shell";
import { Butterfly } from "@/components/library/library-logo";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { BORROW_REQUEST_MESSAGES, readerDueSentence, readerLoanBadge } from "@/lib/circulation";
import { formatInTimezone } from "@/lib/dates";
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
 * charges no fines and never will, and a child who is late is not in trouble.
 * "Ready to come home 🏠" instead of "OVERDUE", a date instead of a count of
 * days, one polite sentence instead of a warning. All of it lives in
 * `src/lib/circulation.ts` so that no template can invent a harsher version.
 *
 * Nothing on this page mentions another child. There is no "borrowed by", no
 * queue position, no "back on Tuesday" for a book somebody else has — the
 * catalogue says a book is being read and stops there.
 */
export default async function MyBooksPage() {
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

  return (
    <PublicShell branding={branding} signedIn>
      <div className="relative mx-auto w-full max-w-5xl px-5 py-12 sm:px-8">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-10 opacity-70 sm:w-12" />
        <h1 className="garden-rule inline-block text-4xl">My books</h1>
        <p className="mt-8 text-lg text-ink-soft">
          {active.length === 0
            ? "You have nothing borrowed right now."
            : active.length === 1
              ? "You have one book at home."
              : `You have ${active.length} books at home.`}{" "}
          {/* The limit comes from library settings, never a literal. */}
          You can have {limit === 1 ? "one book" : `${limit} books`} at a time.
        </p>

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
            <ul className="mt-8 grid gap-5 sm:grid-cols-2">
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

            <ul className="mt-6 flex flex-col gap-3">
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
                    <span className="font-display text-lg font-bold text-ink">{loan.title}</span>
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

  return (
    <Card as="li" tone="shelf" className="lift flex gap-5">
      <span className="w-24 shrink-0 sm:w-28">
        <CoverThumbnail
          coverMediaId={loan.coverMediaId}
          title={loan.title}
          sizes="(min-width: 640px) 112px, 96px"
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
          <p className="mt-1 flex items-center gap-2">
            <Icon name="calendar" className="text-ink-faint" />
            Due back{" "}
            <strong className="text-ink">{formatInTimezone(loan.dueAt, timezone, "d MMM")}</strong>
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
      </div>
    </Card>
  );
}
