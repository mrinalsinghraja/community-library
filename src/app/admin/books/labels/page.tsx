import type { Metadata } from "next";
import Link from "next/link";

import { PrintLabelsButton } from "@/app/admin/books/labels/print-button";
import { BookFilterFields } from "@/components/desk/book-filter-fields";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Callout } from "@/components/ui/states";
import {
  bookFilterProblems,
  bookFilterParams,
  describeBookFilter,
  isFilteringBooks,
  parseBookFilter,
} from "@/lib/book-filter";
import { dateOnlyInTimezone, formatInTimezone, nowInTimezone } from "@/lib/dates";
import {
  LABEL_SIZES,
  LABEL_SIZE_LABELS,
  MAX_LABELS,
  describeLabelSize,
  isLabelSize,
  labelsPerSheet,
  type LabelSize,
} from "@/lib/labels";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { requirePermissionForPage } from "@/server/page-guards";
import { listCategories } from "@/server/services/catalogue-service";
import { countBookLabels } from "@/server/services/label-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print shelf labels" };

/** The last seven days, which is the run this screen was built for. */
function defaultRange(timezone: string): { addedFrom: string; addedTo: string } {
  const today = nowInTimezone(timezone);
  const iso = (value: Date) => formatInTimezone(value, timezone, "yyyy-MM-dd");
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { addedFrom: iso(weekAgo), addedTo: iso(today) };
}

/**
 * Labels for the spines and covers.
 *
 * The job this screen exists for is a weekly one: a handful of books came in,
 * they need codes on them before they go on the shelf, and nobody wants to
 * write forty stickers by hand. So the dates default to the last seven days
 * rather than to nothing — the common case should need no typing at all.
 *
 * Everything except the download is a plain `<form method="get">`. The dates
 * and the size live in the query string, which means the count updates on the
 * server, the screen works without JavaScript, and a librarian can bookmark
 * "last week's labels, standard size" and come back to it every Saturday.
 */
export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * `report.view`, which is what `printBookLabels` will ask for. A courtesy
   * redirect: the route refuses independently, and the books list behind it
   * refuses again on its own permissions.
   */
  const actor = await requirePermissionForPage("report.view", {
    signedOutTo: "/login?next=/admin/books/labels",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  /*
   * The same filter the book list uses, so "Print labels" from that screen
   * lands here already narrowed to what was on it.
   *
   * The seven-day default only applies to a bare visit. Somebody who arrived
   * with a filter asked a question, and answering a different one because this
   * screen has a favourite week would be worse than useless — it would print
   * the wrong stickers.
   */
  const parsed = parseBookFilter(params);
  const categories = await listCategories(actor.libraryId);
  const category = categories.find((entry) => entry.id === parsed.categoryId);
  const filter = isFilteringBooks(parsed)
    ? { ...parsed, categoryId: category?.id ?? "" }
    : { ...parsed, ...defaultRange(settings.timezone) };

  const problems = bookFilterProblems(filter);

  const sizeRaw = read("size");
  const size: LabelSize = isLabelSize(sizeRaw) ? sizeRaw : "standard";
  // Absent means on. The box is ticked by default because the sheets are meant
  // for plain paper, and plain paper needs a line to cut along.
  const cutGuides = read("guides") !== "0";

  const labelCount = problems.length > 0 ? 0 : await countBookLabels(filter);

  const scope = describeBookFilter(filter, {
    categoryName: category?.name,
    formatDay: (day) => {
      const parsedDay = dateOnlyInTimezone(day, settings.timezone);
      return parsedDay ? formatInTimezone(parsedDay, settings.timezone, "d MMM yyyy") : day;
    },
  });

  const perSheet = labelsPerSheet(size);
  const sheetCount = Math.max(1, Math.ceil(labelCount / perSheet));
  const tooMany = labelCount > MAX_LABELS;

  return (
    <StaffShell branding={branding} actor={actor} title="Print shelf labels">
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-lg text-ink-soft">
          A sheet of stickers for any set of books you can describe — the whole
          shelf, one category, an age band, a run of book IDs, or everything one
          family gave. The book number goes on in
          large type, the title underneath, then the shelf and the reading age,
          so a book can be found on the shelf and put back on the right one. A
          book that was given carries its donor&rsquo;s credit and the month it
          arrived, in whichever form that family agreed to.
        </p>

        <Card>
          <form method="get" className="flex flex-col gap-5">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <BookFilterFields filter={filter} categories={categories} />
            </div>

            <Field id="size" label="Label size" hint={describeLabelSize(size)}>
              <Select id="size" name="size" defaultValue={size}>
                {LABEL_SIZES.map((option) => (
                  <option key={option} value={option}>
                    {LABEL_SIZE_LABELS[option]} — {describeLabelSize(option)}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex cursor-pointer items-start gap-2.5 text-base text-ink">
              <input
                type="checkbox"
                name="guides"
                value="1"
                defaultChecked={cutGuides}
                className="mt-1 size-4.5 shrink-0 cursor-pointer accent-primary"
              />
              <span>
                Print cut lines
                <span className="block text-sm text-ink-soft">
                  Leave this on for ordinary paper. Turn it off only if you are
                  printing onto sheets that are already cut.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-[var(--radius-button)] border border-control-border bg-surface px-5 py-2.5 text-base font-semibold text-ink"
              >
                Count these
              </button>
              {isFilteringBooks(filter) ? (
                <Link href="/admin/books/labels?codeFrom=1" className="text-sm font-semibold text-primary-deep">
                  Every book
                </Link>
              ) : null}
            </div>
          </form>
        </Card>

        {problems.length > 0 ? (
          <Callout tone="warn" title="Check those boxes">
            <ul className="flex flex-col gap-1">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        {tooMany ? (
          <Callout tone="warn" title="That is a lot of labels">
            {labelCount} labels is more than the {MAX_LABELS} this can make in
            one go. Narrow it down and print in batches.
          </Callout>
        ) : null}

        {problems.length === 0 && !tooMany ? (
          <Card tone="primary">
            <div className="flex flex-col gap-3">
              <p className="text-lg text-ink" aria-live="polite">
                {labelCount === 0
                  ? "No books match that. Try widening it."
                  : `${labelCount} ${labelCount === 1 ? "book" : "books"} — ${sheetCount} ${sheetCount === 1 ? "sheet" : "sheets"} of A4, ${perSheet} to a sheet.`}
              </p>

              {/* What is about to be printed, in words, so the sheet is not a
                  surprise and the same sentence ends up in its footer. */}
              <p className="text-base text-ink-soft">{scope}</p>

              <PrintLabelsButton
                filter={bookFilterParams(filter)}
                size={size}
                cutGuides={cutGuides}
                labelCount={labelCount}
                sheetCount={sheetCount}
              />
            </div>
          </Card>
        ) : null}

        <p className="max-w-prose text-sm text-ink-soft">
          These sheets are made for ordinary paper and a pair of scissors, not
          for sheets of ready-cut stickers. Every brand places its cuts a
          little differently, and a millimetre out at the top of a page is most
          of a centimetre by the bottom — so a printed grid you cut yourself
          wastes a sheet of paper when it goes wrong, rather than a sheet of
          labels. A glue stick finishes the job.
        </p>

        <p>
          <Link href="/admin/books">Back to the books</Link>
        </p>
      </div>
    </StaffShell>
  );
}
