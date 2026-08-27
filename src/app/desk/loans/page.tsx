import type { Metadata } from "next";
import Link from "next/link";

import { LoanActions } from "@/app/desk/loans/loan-actions";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { DueCountdownInline } from "@/components/library/due-countdown";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { DeskSelection, SelectionCheckbox } from "@/components/desk/selection-toolbar";
import { bulkReturnLoansAction } from "@/server/actions/circulation-actions";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  isLoanFilter,
  loanCondition,
  loanStatusDefinition,
  LOAN_PAGE_SIZES,
  type LoanFilter,
} from "@/lib/circulation";
import { formatInTimezone } from "@/lib/dates";
import { loanCountdown } from "@/lib/due-countdown";
import { requireAnyPermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listLoansForStaff } from "@/server/services/circulation-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Books out" };

/**
 * Every book the library has lent, filtered and paged in PostgreSQL.
 *
 * Guarded by the operational circulation permissions, NOT by `loan.view`. Every
 * reader holds `loan.view` — it is what lets a child see their own books — so
 * guarding this page with it would hand any nine-year-old the whole library's
 * loan list with every borrower's name on it. Same lesson as `book.view` in
 * Phase 2, and worth repeating in the place where it would bite.
 *
 * `Overdue` is a filter, not a stored status. The SQL behind it is
 * `status = 'ACTIVE' AND due_at < now()`, the same derivation the child's own
 * screen uses — so nothing here can be stale, and no nightly job needs to have
 * succeeded for this list to be right.
 */

const FILTER_LABELS: Record<LoanFilter, string> = {
  active: "Out now",
  overdue: "Late",
  returned: "Brought back",
};

const CONDITION_TONE: Record<string, StatusTone> = {
  active: "available",
  dueSoon: "soon",
  overdue: "late",
  returned: "out",
  cancelled: "neutral",
};

export default async function DeskLoansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAnyPermissionForPage(["loan.issue", "loan.return", "loan.renew"], {
    signedOutTo: "/login?next=/desk/loans",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const filterRaw = read("filter");
  // Anything unrecognised in the query string is dropped rather than passed on.
  const filter: LoanFilter = isLoanFilter(filterRaw) ? filterRaw : "active";
  const search = read("q");
  const page = Number.parseInt(read("page"), 10) || 1;

  const result = await listLoansForStaff({
    filter,
    search,
    page,
    pageSize: LOAN_PAGE_SIZES.desk,
  });

  const canReturn = actor.permissions.has("loan.return");
  const canRenew = actor.permissions.has("loan.renew");
  const canCancel = actor.permissions.has("loan.correct");
  const canIssue = actor.permissions.has("loan.issue");

  const linkFor = (changes: Record<string, string | null>): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...changes })) {
      const single = Array.isArray(value) ? value[0] : value;
      if (single) query.set(key, single);
    }
    const qs = query.toString();
    return qs ? `/desk/loans?${qs}` : "/desk/loans";
  };

  return (
    <StaffShell branding={branding} actor={actor} title="Books out">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-base text-ink-soft">
          {result.total === 1 ? "1 loan" : `${result.total} loans`}
        </p>
        {canIssue ? (
          <ButtonLink href="/desk/circulation" icon={<Icon name="shelf" />}>
            Issue a book
          </ButtonLink>
        ) : null}
      </div>

      {/*
        Filters as links, not a select. Three of them, always visible, each one
        bookmarkable — a librarian can keep "Late" open in a tab all afternoon.
      */}
      <nav aria-label="Filter loans" className="mt-5 flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as LoanFilter[]).map((key) => (
          <Link
            key={key}
            href={linkFor({ filter: key, page: null })}
            aria-current={key === filter ? "page" : undefined}
            className={
              key === filter
                ? "rounded-[var(--radius-button)] bg-primary px-5 py-2.5 text-base font-bold text-white no-underline"
                : "rounded-[var(--radius-button)] border border-control-border px-5 py-2.5 text-base font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
            }
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="filter" value={filter} />
        <div className="min-w-64 flex-1">
          <label htmlFor="q" className="text-base font-semibold text-ink">
            Find a loan
          </label>
          <p id="q-hint" className="mt-1 text-base text-ink-soft">
            By reader name or card, or by book title, author or ID.
          </p>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            autoComplete="off"
            aria-describedby="q-hint"
            className="mt-2 min-h-14 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-4 text-lg"
          />
        </div>
        <button
          type="submit"
          className="min-h-14 rounded-[var(--radius-button)] bg-primary px-6 text-lg font-bold text-white hover:bg-primary-deep"
        >
          Search
        </button>
        {search ? (
          <Link href={linkFor({ q: null, page: null })} className="pb-4 text-base font-bold text-primary-deep">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-6">
        {result.items.length === 0 ? (
          <EmptyState
            illustration={<Icon name={filter === "overdue" ? "check" : "book"} />}
            title={
              search
                ? "Nothing matches that"
                : filter === "overdue"
                  ? "Nothing is late"
                  : filter === "returned"
                    ? "Nothing has been brought back yet"
                    : "No books are out right now"
            }
            action={
              canIssue && !search ? (
                <ButtonLink href="/desk/circulation" icon={<Icon name="shelf" />}>
                  Issue a book
                </ButtonLink>
              ) : null
            }
          >
            {search
              ? "Try a name, a card number, or part of a title."
              : filter === "overdue"
                ? "Every book is back or still within its date."
                : "Books appear here as soon as they are issued."}
          </EmptyState>
        ) : (
          <DeskSelection
            report="loans"
            canExport={actor.permissions.has("report.view")}
            ids={result.items.map((loan) => loan.loanId)}
            totalAvailable={result.total}
            filter={{ filter, ...(search ? { search } : {}) }}
            bulk={
              /*
               * Only where a returnable book can actually be on screen. On the
               * "returned" filter every row is already back, so a Take back
               * button would be an offer to do nothing.
               */
              canReturn && filter !== "returned"
                ? {
                    noun: "book",
                    nounPlural: "books",
                    run: bulkReturnLoansAction,
                    actions: [
                      {
                        value: "RETURN",
                        label: "Accept these returns",
                        tone: "primary",
                        notePrompt: null,
                        confirm:
                          "Take {count} {book|books} back? Each one goes straight onto the shelf, with nothing said about what shape it is in. A book that came back damaged should go back on its own row instead.",
                      },
                    ],
                  }
                : undefined
            }
          >
          <DataTable
            headers={["", "Reader", "Book", "Book ID", "Issued", "Time left", "Status", "Actions"]}
          >
            {result.items.map((loan) => {
              const condition = loanCondition(loan, settings.timezone);
              const countdown = loanCountdown(loan, settings.timezone);
              const renewalsLeft = settings.maxRenewals - loan.renewalCount;

              return (
                <tr key={loan.loanId} className="border-t-2 border-hairline align-top">
                  <td className="px-3.5 py-2.5 align-top">
                    <SelectionCheckbox
                      id={loan.loanId}
                      label={`${loan.title} — ${loan.readerName}`}
                    />
                  </td>
                  <td className="px-3.5 py-2.5 align-top">
                    <p className="font-bold text-ink">{loan.readerName}</p>
                    <p className="code text-base text-ink-soft">{loan.memberCode}</p>
                  </td>

                  <td className="px-3.5 py-2.5 align-top">
                    {/*
                      Jacket first. A librarian scanning thirty rows for the
                      book a child is holding recognises the cover well before
                      they finish reading the title.
                    */}
                    <span className="flex items-start gap-3">
                      <span className="w-11 shrink-0">
                        <CoverThumbnail
                          coverMediaId={loan.coverMediaId}
                          title={loan.title}
                          variant="thumb"
                          sizes="44px"
                        />
                      </span>
                      <span className="min-w-0">
                        <Link
                          href={`/admin/books/${loan.copyId}`}
                          className="font-bold text-primary-deep"
                        >
                          {loan.title}
                        </Link>
                        <br />
                        <span className="text-ink-soft">{loan.authors.join(", ")}</span>
                      </span>
                    </span>
                  </td>

                  <td className="px-3.5 py-2.5 align-top code">{loan.copyCode}</td>

                  <td className="px-3.5 py-2.5 align-top text-ink-soft">
                    {formatInTimezone(loan.issuedAt, settings.timezone)}
                  </td>

                  <td className="px-3.5 py-2.5 align-top">
                    {/*
                      How long is left, before the date it is left until. A
                      librarian works this column by exception — the late ones
                      and the nearly-late ones — and a row of identical grey
                      dates makes them do the arithmetic thirty times.
                    */}
                    {countdown ? (
                      <>
                        <DueCountdownInline countdown={countdown} />
                        <br />
                      </>
                    ) : null}
                    <span className="text-base text-ink-soft">
                      {formatInTimezone(loan.dueAt, settings.timezone)}
                    </span>
                    {loan.renewalCount > 0 ? (
                      <>
                        <br />
                        <span className="text-base text-ink-soft">
                          {loan.renewalCount === 1
                            ? "kept longer once"
                            : `kept longer ${loan.renewalCount} times`}
                        </span>
                      </>
                    ) : null}
                  </td>

                  <td className="px-3.5 py-2.5 align-top">
                    {/*
                      Word first. The badge carries a colour AND a shape mark AND
                      the word, because colour alone fails a child — or a
                      volunteer — with a colour vision deficiency, and this is
                      the column somebody scans fastest.
                    */}
                    <StatusBadge tone={CONDITION_TONE[condition] ?? "neutral"}>
                      {loan.status === "ACTIVE"
                        ? condition === "overdue"
                          ? "Late"
                          : condition === "dueSoon"
                            ? "Back soon"
                            : "Out"
                        : loanStatusDefinition(loan.status).staffLabel}
                    </StatusBadge>
                    {loan.returnedAt ? (
                      <p className="mt-1 text-base text-ink-soft">
                        {formatInTimezone(loan.returnedAt, settings.timezone)}
                      </p>
                    ) : null}
                    {/*
                      The reader has said this one is on its way. It changes
                      nothing about the loan — the row still reads "Out" above,
                      because the book is still out. It is here so a librarian
                      knows what to expect through the door, and so a book
                      promised a fortnight ago and never brought is visible.
                    */}
                    {loan.status === "ACTIVE" && loan.returnAnnouncedAt ? (
                      <p className="mt-1 flex items-start gap-1.5 text-base text-accent-ink">
                        <Icon name="returnBook" className="mt-1 shrink-0" />
                        <span>
                          Reader is returning this &mdash; told us{" "}
                          {formatInTimezone(loan.returnAnnouncedAt, settings.timezone)}
                        </span>
                      </p>
                    ) : null}
                  </td>

                  <td className="px-3.5 py-2.5 align-top">
                    {loan.status === "ACTIVE" ? (
                      <LoanActions
                        loanId={loan.loanId}
                        copyCode={loan.copyCode}
                        canReturn={canReturn}
                        canRenew={canRenew}
                        canCancel={canCancel}
                        renewalsLeft={renewalsLeft}
                        // The overdue-renewal policy is a setting, so the
                        // button's label is decided by the same row the
                        // service reads — never by a constant in the browser.
                        renewalBlockedByOverdue={
                          condition === "overdue" && !settings.allowRenewalWhenOverdue
                        }
                      />
                    ) : (
                      <span className="text-base text-ink-soft">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
          </DeskSelection>
        )}
      </div>

      {result.pageCount > 1 ? (
        <nav aria-label="More loans" className="mt-6 flex flex-wrap items-center gap-2">
          {Array.from({ length: result.pageCount }, (_, index) => index + 1).map((number) => (
            <Link
              key={number}
              href={linkFor({ page: String(number) })}
              aria-current={number === result.page ? "page" : undefined}
              className={
                number === result.page
                  ? "rounded-lg bg-primary px-4 py-2 font-bold text-white no-underline"
                  : "rounded-lg border border-control-border px-4 py-2 font-bold text-ink-soft no-underline hover:bg-surface-sunk"
              }
            >
              {number}
            </Link>
          ))}
        </nav>
      ) : null}
    </StaffShell>
  );
}
