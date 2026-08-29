import type { Metadata } from "next";
import Link from "next/link";

import { ArchiveActions } from "@/app/admin/books/archive-actions";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { DeskSelection, SelectionCheckbox } from "@/components/desk/selection-toolbar";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { BookFilterFields, FilterSelect } from "@/components/desk/book-filter-fields";
import {
  bookFilterParams,
  bookFilterProblems,
  isFilteringBooks,
  parseBookFilter,
} from "@/lib/book-filter";
import { PAGE_SIZES, ageGroupLabel, conditionLabel, statusDefinition } from "@/lib/catalogue";
import { formatInTimezone } from "@/lib/dates";
import { bookListUrl, noticeCode } from "@/lib/return-to";
import { requireAnyPermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import {
  bookFilterToQuery,
  listBooksForStaff,
  listCategories,
  type CatalogueSort,
} from "@/server/services/catalogue-service";
import { Icon } from "@/components/ui/icon";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Books" };

/**
 * The librarian's book list.
 *
 * Filtering, searching, sorting and paging all live in the query string and are
 * executed in PostgreSQL. That buys three things at once: the browser is never
 * handed the whole catalogue to sort, the filter form works with JavaScript
 * switched off, and a librarian can bookmark or send "all the damaged comics".
 *
 * The filter form is a plain `<form method="get">` — no client component, no
 * state, no hydration. There is nothing here that a form element does not
 * already do.
 */
export default async function AdminBooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * NOT `book.view`. Every reader holds that — it is what lets a child browse
   * the shelf — so guarding this page with it would send any nine-year-old
   * straight to the librarian's list, donor names and all. The desk needs a
   * permission that only somebody managing the collection has.
   *
   * A courtesy redirect either way; `listBooksForStaff` refuses independently.
   */
  const actor = await requireAnyPermissionForPage(["book.create", "book.edit", "book.archive"], {
    signedOutTo: "/login?next=/admin/books",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const categories = await listCategories(actor.libraryId);

  /*
   * One filter, parsed once, shared with the label sheet and the export.
   *
   * Anything unrecognised in the query string is dropped rather than passed on,
   * and every value is checked against a vocabulary this application defined. A
   * hand-edited URL narrows the list or does nothing; it never reaches SQL as
   * something the code did not expect.
   */
  const parsed = parseBookFilter(params);
  // The shelf is the one value only this page can check: a filter carries an
  // id, and an id for another library's shelf is not a shelf.
  const category = categories.find((entry) => entry.id === parsed.categoryId);
  const filter = { ...parsed, categoryId: category?.id ?? "" };
  const problems = bookFilterProblems(filter);

  const sortRaw = read("sort");
  const page = Number.parseInt(read("page"), 10) || 1;

  // Anything unrecognised is dropped rather than passed on.
  const sort: CatalogueSort =
    sortRaw === "title" || sortRaw === "author" || sortRaw === "code" ? sortRaw : "newest";

  const result = await listBooksForStaff({
    ...bookFilterToQuery(filter, settings.timezone),
    sort,
    page,
    pageSize: PAGE_SIZES.desk,
  });

  const filtering = isFilteringBooks(filter);

  /*
   * This list, as a link the book form can hold and come back to.
   *
   * Built from the query string rather than from a header, because a librarian
   * on page three of the damaged comics should land back on page three of the
   * damaged comics — and because `Referer` is not sent on every navigation and
   * is not something to build a screen on.
   */
  const listUrl = bookListUrl(params);
  const openFrom = (href: string) => `${href}?from=${encodeURIComponent(listUrl)}`;

  // Set by the redirect after a save. Read back as a book code or as nothing,
  // never as whatever somebody typed after `?added=`.
  const added = noticeCode(read("added"));
  const saved = noticeCode(read("saved"));

  /*
   * The filters, as the export route and the label sheet read them back.
   *
   * Built from the filter this page already validated rather than from the raw
   * query string, so "export everything" and "print labels for this" both mean
   * the list on the screen and not whatever a hand-edited URL asked for. Each
   * of them validates again on arrival — a filter that travels through a
   * browser is an input, not a fact.
   */
  const exportFilter: Record<string, string> = { ...bookFilterParams(filter), sort };
  const labelsHref = `/admin/books/labels?${new URLSearchParams(bookFilterParams(filter)).toString()}`;

  return (
    <StaffShell branding={branding} actor={actor} title="Books">
      {added || saved ? (
        <Callout
          tone="success"
          title={added ? "Added 🎉" : "Saved"}
          className="mb-5"
        >
          {added
            ? `${added} is on the shelf list. Print its label when you are ready.`
            : `${saved} has been updated.`}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-base text-ink-soft">
          {result.total === 1 ? "1 book" : `${result.total} books`}
          {filter.includeArchived ? " (including archived)" : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/*
            Labels sit next to "Add a book" because they are the second half of
            the same job: a book arrives, it is entered, and then it needs its
            number on the cover before it can go on a shelf.
          */}
          {actor.permissions.has("report.view") ? (
            <ButtonLink href={labelsHref} variant="secondary" icon={<Icon name="card" />}>
              Print labels
            </ButtonLink>
          ) : null}
          {actor.permissions.has("book.create") ? (
            <ButtonLink href={openFrom("/admin/books/new")} icon={<Icon name="plus" />}>
              Add a book
            </ButtonLink>
          ) : null}
        </div>
      </div>

      <form
        method="get"
        /*
          A filter bar, not a filter page. Six controls used to sit two-per-row
          in a well the height of a small screen, each stretched to 600px to
          hold the word "Any"; now they line up across the top and the results
          start where the eye already is.
        */
        className="mt-5 grid gap-x-4 gap-y-3 rounded-[var(--radius-card)] bg-surface-sunk px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6"
      >
        <BookFilterFields filter={filter} categories={categories} />

        <FilterSelect label="Sort by" name="sort" value={sort} includeAny={false}>
          <option value="newest">Newest first</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="code">Book ID</option>
        </FilterSelect>

        <div className="flex items-center gap-3 self-end pb-0.5 sm:col-span-2 lg:col-span-1">
          <button
            type="submit"
            className="min-h-10 rounded-[var(--radius-button)] bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-deep"
          >
            Apply
          </button>
          {filtering ? (
            <Link href="/admin/books" className="text-sm font-semibold text-primary-deep">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {problems.length > 0 ? (
        <Callout tone="warn" title="Check those boxes" className="mt-5">
          <ul className="flex flex-col gap-1">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="mt-6">
        {result.items.length === 0 ? (
          filtering ? (
            <EmptyState illustration={<Icon name="search" />} title="Oops! We couldn't find that book.">
              Nothing matches those filters. Try a different shelf, or clear them and start again.
            </EmptyState>
          ) : (
            <EmptyState
              illustration={<Icon name="book" />}
              title="Our shelves are waiting for more adventures!"
              action={
                actor.permissions.has("book.create") ? (
                  <ButtonLink href={openFrom("/admin/books/new")} icon={<Icon name="plus" />}>
                    Add the first book
                  </ButtonLink>
                ) : null
              }
            >
              No books have been catalogued yet.
            </EmptyState>
          )
        ) : (
          <DeskSelection
            report="books"
            canExport={actor.permissions.has("report.view")}
            ids={result.items.map((book) => book.copyId)}
            totalAvailable={result.total}
            filter={exportFilter}
          >
            <DataTable
              headers={["", "Book ID", "Title", "Shelf", "Age", "Condition", "Status", "Donated", ""]}
            >
            {result.items.map((book) => {
              const status = statusDefinition(book.status);
              return (
                <tr key={book.copyId} className="border-t-2 border-hairline align-top">
                  <td className="px-3.5 py-2.5 align-top">
                    <SelectionCheckbox id={book.copyId} label={`${book.copyCode} ${book.title}`} />
                  </td>
                  <td className="px-3.5 py-2.5 align-top code">{book.copyCode}</td>
                  <td className="px-3.5 py-2.5 align-top">
                    <span className="flex items-start gap-3">
                      <span className="w-11 shrink-0">
                        <CoverThumbnail
                          coverMediaId={book.coverMediaId}
                          title={book.title}
                          variant="thumb"
                          sizes="44px"
                        />
                      </span>
                      <span className="min-w-0">
                        <Link
                          href={openFrom(`/admin/books/${book.copyId}`)}
                          className="font-bold text-primary-deep"
                        >
                          {book.title}
                        </Link>
                        <br />
                        <span className="text-ink-soft">{book.authors.join(", ")}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 align-top text-ink-soft">{book.categoryName}</td>
                  <td className="px-3.5 py-2.5 align-top text-ink-soft">{ageGroupLabel(book.ageGroup)}</td>
                  <td className="px-3.5 py-2.5 align-top text-ink-soft">{conditionLabel(book.condition)}</td>
                  <td className="px-3.5 py-2.5 align-top">
                    <StatusBadge tone={status.tone}>{status.staffLabel}</StatusBadge>
                  </td>
                  <td className="px-3.5 py-2.5 align-top text-ink-soft">
                    {book.donorName ? (
                      <>
                        {book.donorName}
                        {book.donorApartment ? ` · ${book.donorApartment}` : ""}
                        <br />
                        <span className="text-base">
                          {book.donatedAt
                            ? formatInTimezone(book.donatedAt, settings.timezone)
                            : ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 align-top">
                    <ArchiveActions
                      copyId={book.copyId}
                      copyCode={book.copyCode}
                      archived={book.status === "ARCHIVED"}
                      canArchive={actor.permissions.has("book.archive")}
                      canDelete={actor.permissions.has("book.delete")}
                    />
                  </td>
                </tr>
              );
            })}
            </DataTable>
          </DeskSelection>
        )}
      </div>

      {result.pageCount > 1 ? (
        <nav aria-label="More books" className="mt-6 flex flex-wrap items-center gap-2">
          {Array.from({ length: result.pageCount }, (_, index) => index + 1).map((number) => {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              const single = Array.isArray(value) ? value[0] : value;
              // The save banner belongs to the page that was saved from, not to
              // every page the librarian walks to afterwards.
              if (single && key !== "page" && key !== "added" && key !== "saved") {
                query.set(key, single);
              }
            }
            query.set("page", String(number));

            return (
              <Link
                key={number}
                href={`/admin/books?${query.toString()}`}
                aria-current={number === result.page ? "page" : undefined}
                className={
                  number === result.page
                    ? "rounded-lg bg-primary px-4 py-2 font-bold text-white no-underline"
                    : "rounded-lg border border-control-border px-4 py-2 font-bold text-ink-soft no-underline hover:bg-surface-sunk"
                }
              >
                {number}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </StaffShell>
  );
}
