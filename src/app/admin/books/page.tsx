import type { Metadata } from "next";
import Link from "next/link";

import { ArchiveActions } from "@/app/admin/books/archive-actions";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { ReportExport, ReportRowCheckbox } from "@/components/reports/export-panel";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AGE_GROUPS,
  CONDITIONS,
  PAGE_SIZES,
  STATUSES,
  ageGroupLabel,
  conditionLabel,
  isAgeGroup,
  isCondition,
  statusDefinition,
} from "@/lib/catalogue";
import { formatInTimezone } from "@/lib/dates";
import { requireAnyPermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import {
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

  const search = read("q");
  const categoryId = read("category");
  const ageGroupRaw = read("age");
  const conditionRaw = read("condition");
  const statusRaw = read("status");
  const sortRaw = read("sort");
  const includeArchived = read("archived") === "1";
  const page = Number.parseInt(read("page"), 10) || 1;

  const categories = await listCategories(actor.libraryId);

  // Anything unrecognised in the query string is dropped rather than passed on.
  // A hand-edited URL narrows the list or does nothing; it never reaches SQL.
  const sort: CatalogueSort =
    sortRaw === "title" || sortRaw === "author" || sortRaw === "code" ? sortRaw : "newest";
  // Looked up rather than cast: the value that reaches the service is one this
  // application defined, not a string that arrived in a URL.
  const status = STATUSES.find((entry) => entry.value === statusRaw)?.value;

  const result = await listBooksForStaff({
    search,
    categoryId: categories.some((category) => category.id === categoryId) ? categoryId : undefined,
    ageGroup: isAgeGroup(ageGroupRaw) ? ageGroupRaw : undefined,
    condition: isCondition(conditionRaw) ? conditionRaw : undefined,
    status,
    includeArchived,
    sort,
    page,
    pageSize: PAGE_SIZES.desk,
  });

  const filtering = Boolean(search || categoryId || ageGroupRaw || conditionRaw || statusRaw);

  /*
   * The filters, as the export route will read them back.
   *
   * Built from the values this page already validated rather than from the raw
   * query string, so "export everything" means the list on the screen and not
   * whatever a hand-edited URL asked for. The route validates them again on
   * arrival — a filter that travels through a browser is an input, not a fact.
   */
  const exportFilter: Record<string, string> = {
    ...(search ? { search } : {}),
    ...(categoryId ? { category: categoryId } : {}),
    ...(isAgeGroup(ageGroupRaw) ? { age: ageGroupRaw } : {}),
    ...(isCondition(conditionRaw) ? { condition: conditionRaw } : {}),
    ...(status ? { status } : {}),
    ...(includeArchived ? { archived: "1" } : {}),
    sort,
  };

  return (
    <StaffShell branding={branding} actor={actor} title="Books">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-base text-ink-soft">
          {result.total === 1 ? "1 book" : `${result.total} books`}
          {includeArchived ? " (including archived)" : ""}
        </p>
        {actor.permissions.has("book.create") ? (
          <ButtonLink href="/admin/books/new" icon={<Icon name="plus" />}>
            Add a book
          </ButtonLink>
        ) : null}
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
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-sm font-semibold text-ink-soft">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Title, author or book ID"
            className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
          />
        </label>

        <FilterSelect label="Shelf" name="category" value={categoryId}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect label="Age" name="age" value={ageGroupRaw}>
          {AGE_GROUPS.map((group) => (
            <option key={group.value} value={group.value}>
              {group.label}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect label="Condition" name="condition" value={conditionRaw}>
          {CONDITIONS.map((condition) => (
            <option key={condition.value} value={condition.value}>
              {condition.label}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect label="Status" name="status" value={statusRaw}>
          {STATUSES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.staffLabel}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect label="Sort by" name="sort" value={sort} includeAny={false}>
          <option value="newest">Newest first</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="code">Book ID</option>
        </FilterSelect>

        <label className="flex items-center gap-2.5 self-end pb-1.5">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={includeArchived}
            className="size-6 rounded border-2 border-control-border"
          />
          <span className="text-sm font-semibold text-ink">Include archived</span>
        </label>

        <div className="flex items-center gap-3 self-end pb-0.5 sm:col-span-2 lg:col-span-1">
          <button
            type="submit"
            className="min-h-10 rounded-[var(--radius-button)] bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-deep"
          >
            Apply
          </button>
          {filtering || includeArchived ? (
            <Link href="/admin/books" className="text-sm font-semibold text-primary-deep">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

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
                  <ButtonLink href="/admin/books/new" icon={<Icon name="plus" />}>
                    Add the first book
                  </ButtonLink>
                ) : null
              }
            >
              No books have been catalogued yet.
            </EmptyState>
          )
        ) : (
          <ReportExport
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
                    <ReportRowCheckbox id={book.copyId} label={`${book.copyCode} ${book.title}`} />
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
                          href={`/admin/books/${book.copyId}`}
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
          </ReportExport>
        )}
      </div>

      {result.pageCount > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center gap-2">
          {Array.from({ length: result.pageCount }, (_, index) => index + 1).map((number) => {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              const single = Array.isArray(value) ? value[0] : value;
              if (single && key !== "page") query.set(key, single);
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

/** A labelled filter dropdown with an "any" option, unless it is the sort control. */
function FilterSelect({
  label,
  name,
  value,
  includeAny = true,
  children,
}: {
  label: string;
  name: string;
  value: string;
  includeAny?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-2.5 text-base"
      >
        {includeAny ? <option value="">Any</option> : null}
        {children}
      </select>
    </label>
  );
}
