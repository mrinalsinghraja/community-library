"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  FORMAT_LABELS,
  REPORT_FORMATS,
  type ReportFormat,
  type ReportKey,
  rowNoun,
} from "@/lib/reports";
import { cn } from "@/lib/cn";

/**
 * Choosing rows, and taking them away.
 *
 * One component pair for every desk listing: a provider that owns the ticked
 * set and a toolbar that turns it into a download. The checkboxes themselves
 * are rendered inside the server-rendered rows and read the selection from
 * context, so a screen adopts this by wrapping its table and adding one cell —
 * not by becoming a client component.
 *
 * The toolbar states what will happen before it happens. With nothing ticked it
 * offers everything the current filter matches and says how many that is; with
 * rows ticked it offers exactly those. There is no third state where the button
 * says "Download" and the person finds out afterwards.
 */

interface SelectionContextValue {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  busy: boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useReportSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("A report checkbox must be rendered inside <ReportExport>.");
  }
  return context;
}

/** The checkbox on one row. */
export function ReportRowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle, busy } = useReportSelection();

  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      disabled={busy}
      // The row's own words, so a screen reader announces "Tinkle Double
      // Digest No.71, tick box" rather than "tick box, tick box, tick box".
      aria-label={`Include ${label} in the export`}
      className="mt-0.5 size-4.5 shrink-0 cursor-pointer accent-primary disabled:cursor-wait"
    />
  );
}

/** The header cell that ticks and unticks the whole visible list. */
function SelectAllCheckbox({
  ids,
  selected,
  onChange,
  busy,
}: {
  ids: string[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  busy: boolean;
}) {
  const allTicked = ids.length > 0 && ids.every((id) => selected.has(id));

  return (
    <input
      type="checkbox"
      checked={allTicked}
      // Indeterminate is a property, not an attribute, so it is set through the
      // node. Without it, ticking three of twenty rows leaves the header box
      // looking empty, which reads as "nothing is selected".
      ref={(node) => {
        if (node) node.indeterminate = !allTicked && ids.some((id) => selected.has(id));
      }}
      onChange={() => onChange(allTicked ? new Set() : new Set(ids))}
      disabled={busy || ids.length === 0}
      aria-label={allTicked ? "Clear the selection" : "Select everything on this page"}
      className="size-4.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
    />
  );
}

export interface ReportExportProps {
  report: ReportKey;
  /**
   * Whether this viewer holds `report.view`.
   *
   * The server refuses the request either way — this only decides whether a
   * person is shown a control that would refuse them. Hiding a button is a
   * courtesy on top of a refusal, never instead of one.
   */
  canExport: boolean;
  /** Every row id currently on the screen, in display order. */
  ids: string[];
  /** How many rows the filter matches in total, when the screen is paged. */
  totalAvailable?: number;
  /** The filters the screen is showing, so "everything" means the same thing. */
  filter?: Record<string, string>;
  children: ReactNode;
}

export function ReportExport({
  report,
  canExport,
  ids,
  totalAvailable,
  filter,
  children,
}: ReportExportProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ReportFormat>("xlsx");
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const context = useMemo<SelectionContextValue>(
    () => ({ selected, toggle, busy }),
    [selected, toggle, busy],
  );

  const total = totalAvailable ?? ids.length;
  const count = selected.size === 0 ? total : selected.size;

  async function download() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/reports/${report}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          selectedIds: [...selected],
          filter: filter ?? {},
        }),
      });

      if (!response.ok) {
        const message = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => null);
        setProblem(message ?? "The report could not be made. Please try again.");
        return;
      }

      /*
       * The filename comes from the server's `Content-Disposition`, so the name
       * in the download folder matches the name in the audit log. Falling back
       * to a guess would let the two drift apart the day the format changes.
       */
      const disposition = response.headers.get("content-disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = named?.[1] ?? `${report}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setProblem("The report could not be downloaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canExport) return <>{children}</>;

  return (
    <SelectionContext.Provider value={context}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--radius-card)] border border-hairline bg-surface-sunk px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink">
          <SelectAllCheckbox
            ids={ids}
            selected={selected}
            onChange={(next) => setSelected(next)}
            busy={busy}
          />
          Select all
        </label>

        <p className="text-sm text-ink-soft" aria-live="polite">
          {selected.size === 0
            ? `Exporting all ${total} ${rowNoun(report, total)}`
            : `${selected.size} ${rowNoun(report, selected.size)} selected`}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="File format"
            className="flex items-center rounded-[var(--radius-button)] border border-control-border bg-surface p-0.5"
          >
            {REPORT_FORMATS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={format === option}
                disabled={busy}
                onClick={() => setFormat(option)}
                className={cn(
                  "min-h-9 rounded-[calc(var(--radius-button)-0.15rem)] px-3.5 text-sm font-semibold transition-colors",
                  format === option
                    ? "bg-primary text-white"
                    : "text-ink-soft hover:bg-surface-sunk hover:text-ink",
                )}
              >
                {FORMAT_LABELS[option]}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            onClick={download}
            disabled={busy || total === 0}
            icon={<Icon name="save" />}
          >
            {busy
              ? "Preparing…"
              : `Download ${count} ${rowNoun(report, count)}`}
          </Button>
        </div>

        {problem ? (
          <p role="alert" className="w-full text-sm font-semibold text-danger">
            {problem}
          </p>
        ) : null}
      </div>

      {children}
    </SelectionContext.Provider>
  );
}
