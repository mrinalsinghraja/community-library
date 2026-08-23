import type { Metadata } from "next";

import { PeriodReportDownload } from "@/app/desk/reports/period-download";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { Callout } from "@/components/ui/states";
import {
  dateOnlyInTimezone,
  endOfDayInTimezone,
  formatInTimezone,
  nowInTimezone,
} from "@/lib/dates";
import {
  PERIOD_REPORT_BLURBS,
  PERIOD_REPORT_KEYS,
  REPORT_LABELS,
  rowNoun,
} from "@/lib/reports";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { requirePermissionForPage } from "@/server/page-guards";
import {
  circulationSummary,
  listBookActivity,
  listCirculation,
  listReaderActivity,
  MAX_PERIOD_ROWS,
} from "@/server/services/circulation-reports-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

/** The last thirty days — long enough to show a pattern, short enough to read. */
function defaultRange(timezone: string): { from: string; to: string } {
  const today = nowInTimezone(timezone);
  const iso = (value: Date) => formatInTimezone(value, timezone, "yyyy-MM-dd");
  return {
    from: iso(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)),
    to: iso(today),
  };
}

/** One number and what it means, for the row of totals. */
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-display text-3xl font-bold text-primary">{value}</span>
      <span className="text-sm text-ink-soft">{label}</span>
    </div>
  );
}

/**
 * What the library did, over a stretch of time.
 *
 * Separate from the export toolbars on the desk listings, which answer "give me
 * what I am looking at". These answer a different kind of question — how much
 * was borrowed in August, who is reading, which books never come back — and the
 * period is the whole input, so it is chosen once at the top and every report on
 * the page honours it.
 *
 * The dates live in the query string and the counting happens on the server, so
 * the page works with JavaScript switched off up to the download buttons, and a
 * librarian can bookmark "last month's circulation" and open it again in
 * September.
 */
export default async function DeskReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * `report.view` — held by Librarian and Super Admin both. The services behind
   * each report refuse independently, and the reader report asks for
   * `member.view` on top of the desk permissions, so a role that could somehow
   * reach this page without them still cannot read a child's name off it.
   */
  const actor = await requirePermissionForPage("report.view", {
    signedOutTo: "/login?next=/desk/reports",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const fallback = defaultRange(settings.timezone);
  const fromRaw = read("from") || fallback.from;
  const toRaw = read("to") || fallback.to;

  const fromDay = dateOnlyInTimezone(fromRaw, settings.timezone);
  const toDay = dateOnlyInTimezone(toRaw, settings.timezone);
  const backwards = fromDay && toDay ? fromDay > toDay : false;

  const period = backwards
    ? null
    : {
        from: fromDay ?? undefined,
        to: toDay ? endOfDayInTimezone(toDay, settings.timezone) : undefined,
      };

  const [summary, circulation, readers, books] = period
    ? await Promise.all([
        circulationSummary(period),
        listCirculation(period),
        listReaderActivity(period),
        listBookActivity(period),
      ])
    : [null, [], [], []];

  const counts: Record<string, number> = {
    circulation: circulation.length,
    "reader-activity": readers.length,
    "book-activity": books.length,
  };

  const tooMany = Object.values(counts).some((count) => count > MAX_PERIOD_ROWS);

  const day = (value: string) => {
    const parsed = dateOnlyInTimezone(value, settings.timezone);
    return parsed ? formatInTimezone(parsed, settings.timezone, "d MMM yyyy") : value;
  };

  return (
    <StaffShell branding={branding} actor={actor} title="Reports">
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-lg text-ink-soft">
          What the library did over a stretch of time. Pick the dates once and
          every report below follows them.
        </p>

        <Card>
          <form method="get" className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="from" label="From" hint="The first day to count.">
                <TextInput id="from" name="from" type="date" defaultValue={fromRaw} />
              </Field>

              <Field id="to" label="To" hint="Included, so one day counts that day.">
                <TextInput id="to" name="to" type="date" defaultValue={toRaw} />
              </Field>
            </div>

            <div>
              <button
                type="submit"
                className="rounded-[var(--radius-button)] border border-control-border bg-surface px-5 py-2.5 text-base font-semibold text-ink"
              >
                Show this period
              </button>
            </div>
          </form>
        </Card>

        {backwards ? (
          <Callout tone="warn" title="Those dates are the wrong way round">
            The first date is after the last one. Swap them and try again.
          </Callout>
        ) : null}

        {tooMany ? (
          <Callout tone="warn" title="That is a very long period">
            One of these reports has more than {MAX_PERIOD_ROWS} rows, which is
            more than a single file can hold. Narrow the dates.
          </Callout>
        ) : null}

        {summary ? (
          <Card tone="primary">
            <CardTitle>
              Books borrowed {day(fromRaw)} – {day(toRaw)}
            </CardTitle>

            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Figure value={summary.issued} label="books borrowed" />
              <Figure value={summary.activeReaders} label="readers borrowing" />
              <Figure value={summary.booksMoved} label="different books" />
              <Figure value={summary.renewals} label="times kept longer" />
              <Figure value={summary.returned} label="back on the shelf" />
              <Figure value={summary.stillOut} label="still out today" />
              <Figure value={summary.overdueNow} label="late today" />
            </div>

            {/*
              Two of these seven are about today rather than about the period,
              and saying so is cheaper than a reader working it out from a
              surprising number in December.
            */}
            <p className="mt-4 text-sm text-ink-soft">
              &ldquo;Still out&rdquo; and &ldquo;late&rdquo; describe where those
              books are right now, not where they were during the period.
            </p>
          </Card>
        ) : null}

        {period
          ? PERIOD_REPORT_KEYS.map((key) => {
              const count = counts[key] ?? 0;

              return (
                <Card key={key}>
                  <CardTitle>{REPORT_LABELS[key]}</CardTitle>

                  <p className="mt-1.5 max-w-prose text-base text-ink-soft">
                    {PERIOD_REPORT_BLURBS[key]}
                  </p>

                  <p className="mt-3 text-base text-ink" aria-live="polite">
                    {count === 0
                      ? "Nothing in this period."
                      : `${count} ${rowNoun(key, count)}`}
                  </p>

                  <div className="mt-4">
                    <PeriodReportDownload
                      report={key}
                      from={fromRaw}
                      to={toRaw}
                      rowCount={count}
                    />
                  </div>
                </Card>
              );
            })
          : null}

        <p className="max-w-prose text-sm text-ink-soft">
          The reader report is listed by name rather than by how much anybody
          read. The counts are all there for whoever needs them, but a library is
          not a scoreboard and a child who reads slowly does not belong at the
          bottom of a list that gets forwarded.
        </p>
      </div>
    </StaffShell>
  );
}
