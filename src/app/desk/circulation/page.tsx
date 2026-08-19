import type { Metadata } from "next";
import Link from "next/link";

import { IssueConfirm } from "@/app/desk/circulation/issue-confirm";
import { MemberAvatar } from "@/components/library/avatar";
import { BookCover } from "@/components/library/book-cover";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { conditionLabel, statusDefinition } from "@/lib/catalogue";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import {
  getIssuePreview,
  searchCopies,
  searchReaders,
  type CopyPick,
  type ReaderPick,
} from "@/server/services/circulation-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Issue a book" };

/**
 * The circulation desk: find the child, find the book, confirm, issue.
 *
 * Four steps and no page reloads between them beyond the ones a plain form
 * causes. Everything lives in the query string — `reader`/`book` are what was
 * typed, `readerId`/`copyId` are what was picked — which buys three things at
 * once: the whole flow works with JavaScript switched off, a librarian can go
 * back a step with the browser's own back button, and a half-finished issue can
 * be handed to a colleague as a link.
 *
 * Two search boxes side by side rather than a wizard. A librarian at a busy
 * desk often already knows both, and forcing them through "step 1 of 4" when
 * the child is standing there with the book in their hand is slower than the
 * paper ledger this replaces.
 *
 * Guarded by `loan.issue`. Note it is NOT `loan.view` — every reader holds
 * that, and it would open this page to the whole library.
 */
export default async function CirculationDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermissionForPage("loan.issue", {
    signedOutTo: "/login?next=/desk/circulation",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const readerQuery = read("reader");
  const bookQuery = read("book");
  const readerId = read("readerId");
  const copyId = read("copyId");

  const [readerResults, bookResults] = await Promise.all([
    readerId ? Promise.resolve<ReaderPick[]>([]) : searchReaders(readerQuery),
    copyId ? Promise.resolve<CopyPick[]>([]) : searchCopies(bookQuery),
  ]);

  // Only once both are chosen. The preview is the thing that computes the due
  // date — on the server, in the library's timezone — and re-runs every rule.
  const preview = readerId && copyId ? await getIssuePreview(readerId, copyId) : null;

  /** Rebuilds the URL with one parameter changed, so each step is a plain link. */
  const withParams = (changes: Record<string, string | null>): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...changes })) {
      const single = Array.isArray(value) ? value[0] : value;
      if (single) query.set(key, single);
    }
    const search = query.toString();
    return search ? `/desk/circulation?${search}` : "/desk/circulation";
  };

  return (
    <StaffShell branding={branding} actor={actor} title="Issue a book">
      <p className="text-base text-ink-soft">
        Find the reader, find the book, check the card, hand it over.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ---------------------------------------------------------------- */}
        {/* 1. The reader                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="reader-step" className="flex flex-col gap-4">
          <h2 id="reader-step" className="text-2xl">
            1. Who is borrowing?
          </h2>

          {preview ? (
            <ChosenReader reader={preview.reader} changeHref={withParams({ readerId: null })} />
          ) : readerId ? (
            <Callout tone="info">
              Reader chosen.{" "}
              <Link href={withParams({ readerId: null })} className="font-bold text-primary-deep">
                Change
              </Link>
            </Callout>
          ) : (
            <>
              <form method="get" className="flex flex-wrap items-end gap-3">
                {/* Carries the book half of the flow through the search. */}
                {bookQuery ? <input type="hidden" name="book" value={bookQuery} /> : null}
                {copyId ? <input type="hidden" name="copyId" value={copyId} /> : null}
                <div className="min-w-56 flex-1">
                  <label
                    htmlFor="reader"
                    className="font-display text-lg font-bold text-ink"
                  >
                    Reader&rsquo;s name or card number
                  </label>
                  <input
                    id="reader"
                    name="reader"
                    type="search"
                    defaultValue={readerQuery}
                    autoComplete="off"
                    placeholder="e.g. Aarav, or a card number"
                    className="mt-2 min-h-14 w-full rounded-[var(--radius-field)] border-2 border-control-border bg-surface px-4 text-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-14 rounded-full bg-primary px-6 text-lg font-bold text-white hover:bg-primary-deep"
                >
                  Find
                </button>
              </form>

              {readerQuery && readerResults.length === 0 ? (
                <EmptyState illustration={<Icon name="search" />} title="No reader matches that">
                  Try part of a name, or the number on their card.
                </EmptyState>
              ) : (
                <ul className="flex flex-col gap-2">
                  {readerResults.map((reader) => (
                    <li key={reader.memberUserId} className="list-none">
                      <Link
                        href={withParams({ readerId: reader.memberUserId })}
                        className="flex items-center gap-3 rounded-[var(--radius-field)] border-2 border-hairline bg-surface p-3 no-underline hover:border-primary"
                      >
                        <MemberAvatar
                          avatarKey={reader.avatarKey}
                          photoUrl={
                            reader.photoMediaId ? `/api/media/${reader.photoMediaId}` : null
                          }
                          name={reader.displayName}
                          size={44}
                        />
                        <span className="flex flex-1 flex-col">
                          <span className="font-display font-bold text-ink">
                            {reader.displayName}
                          </span>
                          {/*
                            The card number and how many books they already
                            have. Nothing else: no guardian, no phone, no flat,
                            no date of birth. This is the minimum needed to pick
                            the right child out of two called Aarav.
                          */}
                          <span className="font-mono text-base text-ink-soft">
                            {reader.memberCode}
                          </span>
                        </span>
                        {reader.canBorrow ? (
                          <StatusBadge tone={reader.activeLoanCount > 0 ? "soon" : "available"}>
                            {reader.activeLoanCount === 0
                              ? "No books out"
                              : reader.activeLoanCount === 1
                                ? "1 book out"
                                : `${reader.activeLoanCount} books out`}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="late">Not borrowing</StatusBadge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 2. The book                                                       */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="book-step" className="flex flex-col gap-4">
          <h2 id="book-step" className="text-2xl">
            2. Which book?
          </h2>

          {preview ? (
            <ChosenBook book={preview.book} changeHref={withParams({ copyId: null })} />
          ) : copyId ? (
            <Callout tone="info">
              Book chosen.{" "}
              <Link href={withParams({ copyId: null })} className="font-bold text-primary-deep">
                Change
              </Link>
            </Callout>
          ) : (
            <>
              <form method="get" className="flex flex-wrap items-end gap-3">
                {readerQuery ? <input type="hidden" name="reader" value={readerQuery} /> : null}
                {readerId ? <input type="hidden" name="readerId" value={readerId} /> : null}
                <div className="min-w-56 flex-1">
                  <label htmlFor="book" className="font-display text-lg font-bold text-ink">
                    Book ID, title or author
                  </label>
                  <input
                    id="book"
                    name="book"
                    type="search"
                    defaultValue={bookQuery}
                    autoComplete="off"
                    placeholder="e.g. Jungle, Kipling, or a book ID"
                    className="mt-2 min-h-14 w-full rounded-[var(--radius-field)] border-2 border-control-border bg-surface px-4 text-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-14 rounded-full bg-primary px-6 text-lg font-bold text-white hover:bg-primary-deep"
                >
                  Find
                </button>
              </form>

              {bookQuery && bookResults.length === 0 ? (
                <EmptyState illustration={<Icon name="search" />} title="No book matches that">
                  Try part of the title, the author, or the ID on the label.
                </EmptyState>
              ) : (
                <ul className="flex flex-col gap-2">
                  {bookResults.map((book) => {
                    const status = statusDefinition(book.status);
                    const row = (
                      <>
                        <span className="w-11 shrink-0">
                          {/*
                            A plain picture, not the tap-to-enlarge control:
                            this whole row is already a link that picks the
                            book, and a button inside a link is invalid HTML
                            that no browser agrees on.
                          */}
                          <BookCover
                            coverMediaId={book.coverMediaId}
                            title={book.title}
                            variant="thumb"
                            sizes="44px"
                          />
                        </span>
                        <span className="flex flex-1 flex-col">
                          <span className="font-display font-bold text-ink">{book.title}</span>
                          <span className="text-base text-ink-soft">
                            {book.authors.join(", ")}
                          </span>
                          {/*
                            Two copies of the same title differ only by their
                            code, so the code is what distinguishes the rows and
                            it is never abbreviated away.
                          */}
                          <span className="font-mono text-base text-ink-soft">
                            {book.copyCode}
                          </span>
                        </span>
                        <StatusBadge tone={status.tone}>{status.staffLabel}</StatusBadge>
                      </>
                    );

                    return (
                      <li key={book.copyId} className="list-none">
                        {book.blockedReason ? (
                          // Shown, not hidden. A librarian holding a book needs
                          // to be told what the library thinks of it, and the
                          // sentence here is the same one the server would
                          // refuse with.
                          <div className="flex flex-col gap-2 rounded-[var(--radius-field)] border-2 border-hairline bg-surface-sunk p-3">
                            <div className="flex items-center gap-3">{row}</div>
                            <p className="text-base text-ink-soft">{book.blockedReason}</p>
                          </div>
                        ) : (
                          <Link
                            href={withParams({ copyId: book.copyId })}
                            className="flex items-center gap-3 rounded-[var(--radius-field)] border-2 border-hairline bg-surface p-3 no-underline hover:border-primary"
                          >
                            {row}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Confirm                                                          */}
      {/* ------------------------------------------------------------------ */}
      {preview ? (
        <Card tone="shelf" className="mt-8">
          <CardTitle icon={<Icon name="check" />} as="h2">
            3. Check, then hand it over
          </CardTitle>
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_1fr]">
              <dt className="font-display font-bold text-ink">Reader</dt>
              <dd className="text-ink">
                {preview.reader.displayName}{" "}
                <span className="font-mono text-ink-soft">{preview.reader.memberCode}</span>
              </dd>

              <dt className="font-display font-bold text-ink">Book</dt>
              <dd className="text-ink">
                {preview.book.title}
                <br />
                <span className="text-ink-soft">{preview.book.authors.join(", ")}</span>
              </dd>

              <dt className="font-display font-bold text-ink">Book ID</dt>
              <dd className="font-mono text-ink">{preview.book.copyCode}</dd>

              <dt className="font-display font-bold text-ink">Condition</dt>
              {/* The label, not the enum. "GOOD" is a database value. */}
              <dd className="text-ink-soft">{conditionLabel(preview.book.condition)}</dd>

              <dt className="font-display font-bold text-ink">Due back</dt>
              {/*
                Computed by the server from library settings, in the library's
                own timezone. The browser never calculates this: a laptop with
                the wrong clock, or a family reading the app from another
                country, must not be able to produce a different answer from the
                book on the shelf.
              */}
              <dd className="font-display text-xl font-bold text-ink">
                {formatInTimezone(preview.dueAt, settings.timezone, "EEEE d MMMM yyyy")}{" "}
                <span className="text-base font-normal text-ink-soft">
                  ({preview.loanPeriodDays} days)
                </span>
              </dd>
            </dl>

            <div className="mt-6">
              {/*
                The blockers are handed to the client component rather than
                rendered here, so that a successful issue clears them along with
                the button. Rendered on the server they would reappear the
                moment the issue succeeded — the book IS out now — leaving a
                librarian reading "cannot go out yet" above "is now with Aarav".
              */}
              <IssueConfirm
                memberUserId={preview.reader.memberUserId}
                copyId={preview.book.copyId}
                readerName={preview.reader.displayName}
                blockers={preview.blockers}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}
    </StaffShell>
  );
}

function ChosenReader({ reader, changeHref }: { reader: ReaderPick; changeHref: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-field)] border-2 border-primary bg-surface p-3">
      <MemberAvatar
        avatarKey={reader.avatarKey}
        photoUrl={reader.photoMediaId ? `/api/media/${reader.photoMediaId}` : null}
        name={reader.displayName}
        size={48}
      />
      <div className="flex-1">
        <p className="font-display text-lg font-bold text-ink">{reader.displayName}</p>
        <p className="font-mono text-base text-ink-soft">{reader.memberCode}</p>
      </div>
      <Link href={changeHref} className="text-base font-bold text-primary-deep">
        Change
      </Link>
    </div>
  );
}

function ChosenBook({ book, changeHref }: { book: CopyPick; changeHref: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-field)] border-2 border-primary bg-surface p-3">
      <span className="w-12 shrink-0">
        <CoverThumbnail coverMediaId={book.coverMediaId} title={book.title} variant="thumb" sizes="48px" />
      </span>
      <div className="flex-1">
        <p className="font-display text-lg font-bold text-ink">{book.title}</p>
        <p className="text-base text-ink-soft">{book.authors.join(", ")}</p>
        <p className="font-mono text-base text-ink-soft">{book.copyCode}</p>
      </div>
      <Link href={changeHref} className="text-base font-bold text-primary-deep">
        Change
      </Link>
    </div>
  );
}
