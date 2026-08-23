"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { LabelSize } from "@/lib/labels";

/**
 * Asks for the sheet and hands it to the browser.
 *
 * The only client component on this screen. The dates, the size and the cut
 * guides all live in the query string and are read by the server, so the form
 * works with JavaScript switched off right up to this button — which needs
 * script because a download is a POST whose response is a file rather than a
 * page.
 *
 * It says what it is about to make before it makes it. A person who is about to
 * spend three sheets of paper should be told it is three sheets while they can
 * still change the dates.
 */
export function PrintLabelsButton({
  from,
  to,
  size,
  cutGuides,
  labelCount,
  sheetCount,
}: {
  from: string;
  to: string;
  size: LabelSize;
  cutGuides: boolean;
  labelCount: number;
  sheetCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, size, cutGuides, selectedIds: [] }),
      });

      if (!response.ok) {
        const message = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => null);
        setProblem(message ?? "The labels could not be made. Please try again.");
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
      anchor.download = named?.[1] ?? "book-labels.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setProblem("The labels could not be downloaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={download}
        disabled={busy || labelCount === 0}
        icon={<Icon name="save" />}
      >
        {busy
          ? "Making the sheet…"
          : labelCount === 0
            ? "No labels to print"
            : `Print ${labelCount} ${labelCount === 1 ? "label" : "labels"} · ${sheetCount} ${sheetCount === 1 ? "sheet" : "sheets"}`}
      </Button>

      {problem ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
