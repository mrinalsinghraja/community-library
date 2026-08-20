import "server-only";

import {
  type ReportFormat,
  type ReportKey,
  FORMAT_MIME,
  REPORT_LABELS,
  reportFilename,
  rowNoun,
} from "@/lib/reports";
import { requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { RuleViolationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import { MAX_EXPORT_ROWS, type ReportFilter, loadReport } from "@/server/reports/registry";
import { buildPdf } from "@/server/reports/pdf";
import type { ReportTable } from "@/server/reports/table";
import { buildXlsx } from "@/server/reports/xlsx";

/**
 * Turning a list into a file.
 *
 * Two permissions have to hold, and they are checked in two different places on
 * purpose:
 *
 *  1. `report.view` — may this person export anything at all. Checked here.
 *  2. whatever the underlying list already demands — may this person see *this*
 *     list. Checked by the service that loads it, which is the same service the
 *     screen calls. See `src/server/reports/registry.ts`.
 *
 * Neither is sufficient alone, and neither is restated. A librarian holding
 * `report.view` still cannot export the audit log, because `listAuditEvents`
 * asks for `audit.view` and does not care who is calling it or why.
 *
 * `report.view` was seeded in Phase 0 and sat dormant until this feature; it is
 * held by Librarian and by Super Admin, which is exactly the pair of roles that
 * should be able to take a list away with them. See ADR-045.
 */

export interface ExportRequest {
  report: ReportKey;
  format: ReportFormat;
  /**
   * The rows the person ticked. Empty means "everything the filter matches" —
   * which is a different question from "everything in the library", and is why
   * the filter travels with the request.
   */
  selectedIds: string[];
  filter: ReportFilter;
}

export interface ExportedFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
  rowCount: number;
}

export async function exportReport(request: ExportRequest): Promise<ExportedFile> {
  const actor = await requirePermission("report.view");

  // Loading also authorises: each report calls the list service that owns the
  // screen, and that service throws if this actor may not read it.
  const loaded = await loadReport(request.report, actor, request.filter);

  const selected = new Set(request.selectedIds);
  const rows =
    selected.size === 0
      ? loaded.rows
      : loaded.rows.filter((row) => selected.has(loaded.rowId(row)));

  if (rows.length > MAX_EXPORT_ROWS) {
    throw new RuleViolationError(
      `Export of ${rows.length} rows exceeds the ${MAX_EXPORT_ROWS} row limit`,
      "That is too much to export at once. Narrow the list with the filters and try again.",
    );
  }

  const { library, settings } = await getCurrentLibrary();
  const generatedAt = new Date();

  const total = loaded.rows.length;
  const scopeLabel =
    selected.size === 0
      ? `All ${total} ${rowNoun(request.report, total)}`
      : `${rows.length} selected ${rowNoun(request.report, rows.length)} of ${total}`;

  const table: ReportTable<never> = {
    title: REPORT_LABELS[request.report],
    // Read from settings, never written as a literal — the lint rule that keeps
    // this library's name out of `src/` applies here as much as anywhere.
    libraryName: library.name,
    scopeLabel,
    generatedAt,
    generatedBy: actor.displayName,
    timezone: settings.timezone,
    columns: loaded.columns,
    rows,
  };

  const bytes =
    request.format === "xlsx" ? buildXlsx(table) : (await buildPdf(table)).bytes;

  /*
   * Logged after the file exists, so a failed render is not recorded as a
   * disclosure that never happened — and before the bytes are returned, so a
   * successful one cannot be returned without a record.
   *
   * No row identifiers and no personal data in the metadata. The log says a
   * list of readers left the building; it does not become a second copy of the
   * list.
   */
  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    entityType: "report",
    entityId: request.report,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: {
      report: request.report,
      format: request.format,
      rowCount: rows.length,
      availableRows: total,
      scope: selected.size === 0 ? "all" : "selection",
    },
  });

  return {
    filename: reportFilename(library.name, request.report, request.format, generatedAt),
    contentType: FORMAT_MIME[request.format],
    bytes,
    rowCount: rows.length,
  };
}
