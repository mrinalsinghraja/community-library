"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  FORMAT_LABELS,
  REPORT_FORMATS,
  type PeriodReportKey,
  type ReportFormat,
} from "@/lib/reports";

/**
 * Two buttons: this report as a spreadsheet, or this report as a PDF.
 *
 * Simpler than the toolbar on the desk listings, and deliberately so. That one
 * exists to answer "these rows or all of them", which is a real question when
 * you are looking at a list you have been ticking. Here there is nothing to
 * tick — the period is the selection, and it was chosen at the top of the page.
 *
 * The dates travel in the request body rather than being re-read on the server
 * from a referrer, so the file matches the screen that asked for it even if the
 * person edits the query string between counting and downloading.
 */
export function PeriodReportDownload({
  report,
  from,
  to,
  rowCount,
}: {
  report: PeriodReportKey;
  from: string;
  to: string;
  rowCount: number;
}) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function download(format: ReportFormat) {
    setBusy(format);
    setProblem(null);
    try {
      const response = await fetch(`/api/reports/${report}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, selectedIds: [], filter: { from, to } }),
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
       * in the download folder matches the name in the audit log.
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
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {REPORT_FORMATS.map((format) => (
          <Button
            key={format}
            type="button"
            variant={format === "xlsx" ? "primary" : "secondary"}
            onClick={() => download(format)}
            disabled={busy !== null || rowCount === 0}
            icon={<Icon name="save" />}
          >
            {busy === format ? "Making it…" : FORMAT_LABELS[format]}
          </Button>
        ))}
      </div>

      {problem ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
