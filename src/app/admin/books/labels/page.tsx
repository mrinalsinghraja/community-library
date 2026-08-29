import type { Metadata } from "next";
import Link from "next/link";

import { PrintLabelsButton } from "@/app/admin/books/labels/print-button";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Callout } from "@/components/ui/states";
import { dateOnlyInTimezone, endOfDayInTimezone, formatInTimezone, nowInTimezone } from "@/lib/dates";
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
import { countBookLabels } from "@/server/services/label-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print shelf labels" };

/** The last seven days, which is the run this screen was built for. */
function defaultRange(timezone: string): { from: string; to: string } {
  const today = nowInTimezone(timezone);
  const iso = (value: Date) => formatInTimezone(value, timezone, "yyyy-MM-dd");
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { from: iso(weekAgo), to: iso(today) };
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

  const fallback = defaultRange(settings.timezone);
  // A date is only accepted once it parses as a real day in the library's
  // timezone; "2026-02-31" falls back rather than becoming an Invalid Date.
  const fromRaw = read("from") || fallback.from;
  const toRaw = read("to") || fallback.to;

  const fromDay = dateOnlyInTimezone(fromRaw, settings.timezone);
  const toDay = dateOnlyInTimezone(toRaw, settings.timezone);
  const backwards = fromDay && toDay ? fromDay > toDay : false;

  const sizeRaw = read("size");
  const size: LabelSize = isLabelSize(sizeRaw) ? sizeRaw : "standard";
  // Absent means on. The box is ticked by default because the sheets are meant
  // for plain paper, and plain paper needs a line to cut along.
  const cutGuides = read("guides") !== "0";

  const labelCount = backwards
    ? 0
    : await countBookLabels(
        fromDay ?? undefined,
        toDay ? endOfDayInTimezone(toDay, settings.timezone) : undefined,
      );

  const perSheet = labelsPerSheet(size);
  const sheetCount = Math.max(1, Math.ceil(labelCount / perSheet));
  const tooMany = labelCount > MAX_LABELS;

  return (
    <StaffShell branding={branding} actor={actor} title="Print shelf labels">
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-lg text-ink-soft">
          A sheet of stickers for the books that came in — the book number in
          large type, the title underneath, then the shelf and the reading age,
          so a book can be found on the shelf and put back on the right one. A
          book that was given carries its donor&rsquo;s credit and the month it
          arrived, in whichever form that family agreed to.
        </p>

        <Card>
          <form method="get" className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="from" label="Added from" hint="The first day to include.">
                <TextInput id="from" name="from" type="date" defaultValue={fromRaw} />
              </Field>

              <Field id="to" label="Added up to" hint="Included, so one day prints that day.">
                <TextInput id="to" name="to" type="date" defaultValue={toRaw} />
              </Field>
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

            <div>
              <button
                type="submit"
                className="rounded-[var(--radius-button)] border border-control-border bg-surface px-5 py-2.5 text-base font-semibold text-ink"
              >
                Count these
              </button>
            </div>
          </form>
        </Card>

        {backwards ? (
          <Callout tone="warn" title="Those dates are the wrong way round">
            The first date is after the last one. Swap them and count again.
          </Callout>
        ) : null}

        {tooMany ? (
          <Callout tone="warn" title="That is a lot of labels">
            {labelCount} labels is more than the {MAX_LABELS} this can make in
            one go. Narrow the dates and print in batches.
          </Callout>
        ) : null}

        {!backwards && !tooMany ? (
          <Card tone="primary">
            <div className="flex flex-col gap-3">
              <p className="text-lg text-ink" aria-live="polite">
                {labelCount === 0
                  ? "No books were added between those dates."
                  : `${labelCount} ${labelCount === 1 ? "book" : "books"} — ${sheetCount} ${sheetCount === 1 ? "sheet" : "sheets"} of A4, ${perSheet} to a sheet.`}
              </p>

              <PrintLabelsButton
                from={fromRaw}
                to={toRaw}
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
