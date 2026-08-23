import "server-only";

import { formatInTimezone } from "@/lib/dates";
import { MAX_LABELS, labelFilename, type LabelSize } from "@/lib/labels";
import { requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { RuleViolationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import { buildLabelSheet } from "@/server/reports/label-sheet";
import { listBooksForStaff } from "@/server/services/catalogue-service";

/**
 * Printing shelf labels.
 *
 * Two permissions have to hold, on the same rule as the report exports:
 *
 *  1. `report.view` — may this person take something printable out of the
 *     building at all. Checked here.
 *  2. whatever the books screen already demands. Checked by
 *     `listBooksForStaff`, which is the same call the screen makes and refuses
 *     independently of who is asking it or why.
 *
 * Neither is restated and neither is sufficient alone. A label sheet is a
 * catalogue extract in a different shape, and it must never become the way
 * somebody prints a list they were not allowed to open.
 *
 * There is nothing personal on a label — a book code and a title, no donor, no
 * reader, no flat. That is worth stating because it is what makes this the one
 * export that can be left lying on the desk.
 */

export interface LabelRequest {
  /** Inclusive, as a plain `yyyy-mm-dd`. Resolved to instants in the library's timezone. */
  from?: Date;
  to?: Date;
  size: LabelSize;
  cutGuides: boolean;
  /** Ticked rows from the books screen. Empty means the whole date range. */
  selectedIds: string[];
}

export interface LabelFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
  labelCount: number;
  sheetCount: number;
}

/** "Books added 17–23 Aug 2026", or the honest thing when no range was given. */
function describeScope(
  from: Date | undefined,
  to: Date | undefined,
  timezone: string,
  selectedCount: number,
): string {
  if (selectedCount > 0) return `${selectedCount} chosen ${selectedCount === 1 ? "book" : "books"}`;

  const day = (value: Date) => formatInTimezone(value, timezone, "d MMM yyyy");
  if (from && to) return `Books added ${day(from)} – ${day(to)}`;
  if (from) return `Books added from ${day(from)}`;
  if (to) return `Books added up to ${day(to)}`;
  return "Every book on the shelf";
}

export async function printBookLabels(request: LabelRequest): Promise<LabelFile> {
  const actor = await requirePermission("report.view");

  /*
   * Archived copies are left out and there is no switch to include them. A
   * label exists to be stuck to a book that is on the shelf; a sheet of
   * stickers for books that have been withdrawn is waste at best and a
   * mislabelled shelf at worst.
   *
   * Sorted by code so the sheet comes off the printer in the order the books
   * sit in a pile — which is the order somebody works through them.
   */
  const page = await listBooksForStaff({
    addedFrom: request.from,
    addedTo: request.to,
    sort: "code",
    page: 1,
    pageSize: MAX_LABELS + 1,
  });

  const selected = new Set(request.selectedIds);
  const rows =
    selected.size === 0 ? page.items : page.items.filter((row) => selected.has(row.copyId));

  if (rows.length > MAX_LABELS) {
    throw new RuleViolationError(
      `Label run of ${rows.length} exceeds the ${MAX_LABELS} label limit`,
      `That is more than ${MAX_LABELS} labels at once. Narrow the dates and print in batches.`,
    );
  }

  const { library, settings } = await getCurrentLibrary();
  const generatedAt = new Date();

  const sheet = await buildLabelSheet({
    rows: rows.map((row) => ({ code: row.copyCode, title: row.title })),
    size: request.size,
    // Read from settings, never written as a literal — the lint rule that keeps
    // this library's name out of `src/` applies here as much as anywhere.
    libraryName: library.name,
    scopeLabel: describeScope(request.from, request.to, settings.timezone, selected.size),
    generatedAt,
    cutGuides: request.cutGuides,
  });

  /*
   * Logged after the file exists, so a failed render is not recorded as a print
   * that never happened. No book codes and no titles in the metadata: the log
   * says a sheet of labels was printed, it does not become a second copy of the
   * catalogue.
   */
  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED,
    entityType: "book_label_sheet",
    entityId: null,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: {
      labelCount: rows.length,
      sheetCount: sheet.sheetCount,
      size: request.size,
      scope: selected.size === 0 ? "range" : "selection",
      from: request.from?.toISOString() ?? null,
      to: request.to?.toISOString() ?? null,
    },
  });

  return {
    filename: labelFilename(library.name, generatedAt),
    contentType: "application/pdf",
    bytes: sheet.bytes,
    labelCount: rows.length,
    sheetCount: sheet.sheetCount,
  };
}

/**
 * How many labels a given range would produce, for the screen to say so before
 * anybody spends a sheet of paper.
 *
 * Same query, same authorisation, no PDF and no audit entry — counting what you
 * are allowed to see is not a disclosure, and a page that logged an export
 * every time somebody changed a date would make the audit log useless.
 */
export async function countBookLabels(from?: Date, to?: Date): Promise<number> {
  await requirePermission("report.view");

  const page = await listBooksForStaff({
    addedFrom: from,
    addedTo: to,
    sort: "code",
    page: 1,
    pageSize: 1,
  });

  return page.total;
}
