"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { fillConfirm, summariseBulk, type BulkAction, type BulkResult } from "@/lib/bulk";
import { TextInput } from "@/components/ui/field";
import {
  FORMAT_LABELS,
  REPORT_FORMATS,
  type ReportFormat,
  type ReportKey,
  rowNoun,
} from "@/lib/reports";
import { cn } from "@/lib/cn";

/**
 * Choosing rows, and then doing something with them.
 *
 * One component pair for every desk listing: a provider that owns the ticked
 * set, and a toolbar that turns it into a download, a decision, or both. The
 * checkboxes themselves are rendered inside the server-rendered rows and read
 * the selection from context, so a screen adopts this by wrapping its table and
 * adding one cell — not by becoming a client component.
 *
 * The toolbar states what will happen before it happens, and the two halves say
 * it differently on purpose:
 *
 *   * **Export** defaults to everything. Nothing ticked means "all 30", because
 *     downloading a list nobody asked to narrow is harmless and is what a
 *     librarian nearly always wants.
 *   * **Bulk actions** default to nothing. Nothing ticked means the buttons are
 *     off, because "give out every book on this screen" must never be one
 *     accidental press. Selection is the deliberate act; the button only
 *     carries it out.
 *
 * A bulk action is always the row's own action run once per row — see
 * `src/server/lib/bulk.ts`. The per-row buttons stay exactly where they were,
 * so a librarian can still go one at a time and read each one first. This adds
 * a choice; it removes nothing.
 */

interface SelectionContextValue {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  busy: boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useDeskSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("A selection checkbox must be rendered inside <DeskSelection>.");
  }
  return context;
}

/** The checkbox on one row. */
export function SelectionCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle, busy } = useDeskSelection();

  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      disabled={busy}
      // The row's own words, so a screen reader announces "Tinkle Double
      // Digest No.71, tick box" rather than "tick box, tick box, tick box".
      // Deliberately not "include in the export": the same tick now also
      // chooses what a bulk button acts on.
      aria-label={`Choose ${label}`}
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

/**
 * The bulk half, when a screen has one.
 *
 * `run` is a server action. It is handed the ticked ids and one shared note,
 * and it applies the row's own operation to each — never a bulk query. See
 * `src/server/lib/bulk.ts`.
 */
export interface BulkConfig {
  /** What one row is, and several are: "request" / "requests". */
  noun: string;
  nounPlural: string;
  actions: readonly BulkAction[];
  run: (ids: string[], action: string, note: string) => Promise<BulkResult>;
}

export interface DeskSelectionProps {
  /**
   * The report this listing exports as, when it is one.
   *
   * Omitted on screens that have decisions but no download — moderation and
   * detail changes are queues to work through, not lists anybody wants in a
   * spreadsheet. Without it the toolbar is bulk actions alone.
   */
  report?: ReportKey;
  /**
   * Whether this viewer holds `report.view`.
   *
   * The server refuses the request either way — this only decides whether a
   * person is shown a control that would refuse them. Hiding a button is a
   * courtesy on top of a refusal, never instead of one.
   */
  canExport?: boolean;
  /** Every row id currently on the screen, in display order. */
  ids: string[];
  /** How many rows the filter matches in total, when the screen is paged. */
  totalAvailable?: number;
  /** The filters the screen is showing, so "everything" means the same thing. */
  filter?: Record<string, string>;
  /**
   * Bulk actions, when this viewer may take them.
   *
   * Omitted entirely for somebody who holds no decision permission — the server
   * refuses either way, and this only decides whether a person is shown a
   * control that would refuse them.
   */
  bulk?: BulkConfig;
  children: ReactNode;
}

export function DeskSelection({
  report,
  canExport = false,
  ids,
  totalAvailable,
  filter,
  bulk,
  children,
}: DeskSelectionProps) {
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

  /*
   * What one row is called. The report knows on a screen that exports; on one
   * that only decides, the bulk config is the only thing that does.
   */
  const noun = (howMany: number) =>
    report ? rowNoun(report, howMany) : howMany === 1 ? (bulkNoun ?? "row") : (bulkNounPlural ?? "rows");

  /*
   * Bulk state. Deliberately separate from the export's: the export treats an
   * empty selection as "everything", and a bulk action must treat it as
   * "nothing". Sharing one notion of count between them would make one of the
   * two wrong, and the dangerous one is the one that would be wrong.
   */
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<BulkResult | null>(null);
  const chosen = selected.size;
  const bulkNoun = bulk?.noun;
  const bulkNounPlural = bulk?.nounPlural;

  async function runBulk(action: BulkAction) {
    if (!bulk || chosen === 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await bulk.run([...selected], action.value, note.trim());
      setOutcome(result);
      /*
       * The selection is cleared whatever happened. The rows that worked are
       * gone from the list on the next render, and leaving the ones that failed
       * ticked would invite a second press of the same button on the same rows
       * for the same reason. Their names and reasons stay on screen instead, so
       * the librarian can deal with each one deliberately.
       */
      setSelected(new Set());
      setPendingAction(null);
      setNote("");
    } catch {
      setOutcome({
        done: 0,
        failures: [{ label: "This screen", reason: "Nothing was saved. Please try again." }],
      });
    } finally {
      setBusy(false);
    }
  }

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

  /*
   * Nothing to offer at all — no download, no decisions — so the screen renders
   * exactly as it did before this component existed. Note the two are checked
   * separately: `report.view` must never be what decides whether a librarian
   * can approve six requests, and holding it must never be what lets them.
   */
  if ((!canExport || !report) && !bulk) return <>{children}</>;

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
          {selected.size > 0
            ? `${selected.size} ${noun(selected.size)} selected`
            : bulk && canExport
              ? `Tick rows to act on several at once — or use the buttons on each row. Downloading all ${total} ${noun(total)}.`
              : bulk
                ? "Tick rows to act on several at once — or use the buttons on each row."
                : `Exporting all ${total} ${noun(total)}`}
        </p>

        {canExport && report ? (
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
              : `Download ${count} ${noun(count)}`}
          </Button>
        </div>
        ) : null}

        {problem ? (
          <p role="alert" className="w-full text-sm font-semibold text-danger">
            {problem}
          </p>
        ) : null}

        {/* ---------- Doing it to all of them ---------- */}
        {bulk ? (
          <div className="w-full border-t border-hairline pt-3">
            {pendingAction ? (
              /*
               * The confirmation. It names the number and the consequence in
               * one sentence — a dialogue that only asks "are you sure?"
               * teaches people to press yes without reading it.
               */
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">
                  {pendingAction.confirm ? fillConfirm(pendingAction.confirm, chosen) : null}
                </p>

                {pendingAction.notePrompt ? (
                  <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
                    {pendingAction.notePrompt}
                    <TextInput
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={500}
                      required
                      className="min-h-11 text-base"
                    />
                  </label>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={pendingAction.tone === "danger" ? "danger" : "primary"}
                    disabled={
                      busy || (pendingAction.notePrompt !== null && note.trim().length === 0)
                    }
                    onClick={() => runBulk(pendingAction)}
                  >
                    {busy ? "Working…" : `Yes, ${pendingAction.label.toLowerCase()}`}
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setPendingAction(null);
                      setNote("");
                    }}
                  >
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  With the {chosen > 0 ? chosen : ""} selected:
                </span>
                {bulk.actions.map((action) => (
                  <Button
                    key={action.value}
                    size="sm"
                    variant={
                      action.tone === "primary"
                        ? "primary"
                        : action.tone === "danger"
                          ? "danger"
                          : "secondary"
                    }
                    // Off until rows are ticked. Choosing is the deliberate
                    // act; this button only carries it out.
                    disabled={busy || chosen === 0}
                    onClick={() =>
                      action.confirm ? setPendingAction(action) : runBulk(action)
                    }
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}

            {outcome ? (
              <div className="mt-3" role="status">
                <p className="text-sm font-semibold text-ink">
                  {summariseBulk(outcome, bulk.noun, bulk.nounPlural)}
                </p>
                {outcome.failures.length > 0 ? (
                  /*
                   * Every failure by name and reason, never a count on its own.
                   * "3 could not be done" is not something a librarian can act
                   * on; "Matilda — that book is already out" is.
                   */
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {outcome.failures.map((failure) => (
                      <li key={failure.label} className="text-sm text-ink-soft">
                        <span className="font-semibold text-ink">{failure.label}</span> &mdash;{" "}
                        {failure.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {children}
    </SelectionContext.Provider>
  );
}
