import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RenewalRequest } from "@/app/my-books/renewal-request";
import { BookCover } from "@/components/library/book-cover";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { readerDueSentence, readerLoanBadge } from "@/lib/circulation";
import { formatInTimezone } from "@/lib/dates";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listOwnLoans, type ReaderLoanCard } from "@/server/services/circulation-service";

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

  return (
    <PublicShell branding={branding} signedIn>
      <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8">
        <h1 className="text-4xl">My books 📚</h1>
        <p className="mt-3 text-lg text-ink-soft">
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
              illustration="🌱"
              title="Your shelf is empty — for now!"
              action={
                <ButtonLink href="/books" size="lg" icon="🔍">
                  Find something to read
                </ButtonLink>
              }
            >
              Choose a book from the library and ask a librarian to lend it to you.
            </EmptyState>
          </div>
        ) : (
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
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Books already brought back                                        */}
        {/* ---------------------------------------------------------------- */}
        {history.length > 0 ? (
          <section aria-labelledby="history" className="mt-14">
            <h2 id="history" className="text-2xl">
              Books you have read 🌟
            </h2>
            <p className="mt-2 text-ink-soft">
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
                    <BookCover coverMediaId={loan.coverMediaId} title={loan.title} sizes="48px" />
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
          <ButtonLink href="/books" size="lg" icon="🔍">
            Find another book
          </ButtonLink>
          <ButtonLink href="/account" variant="secondary" size="lg" icon="🪪">
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
    <Card as="li" tone="shelf" className="flex gap-5">
      <span className="w-24 shrink-0 sm:w-28">
        <BookCover
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
          <p>
            Borrowed on{" "}
            <strong className="text-ink">{formatInTimezone(loan.issuedAt, timezone, "d MMM")}</strong>
          </p>
          <p className="mt-1">
            Back by{" "}
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
