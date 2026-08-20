"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/states";
import { issueBookAction, type CirculationFormState } from "@/server/actions/circulation-actions";
import { Icon } from "@/components/ui/icon";

/**
 * The last step: one button, and the three facts it commits.
 *
 * The reader, the book, its code and the date are rendered by the server page
 * above this component. All this owns is the submit and what comes back — which
 * keeps the confirmation card itself a server-rendered projection with no
 * client state to drift out of date.
 *
 * The ids travel in hidden fields, and that is safe because they are not
 * trusted: `issueBook` re-reads both rows inside its transaction, scoped to the
 * actor's own library, and re-checks every rule while holding the locks. A
 * tampered field reaches a NotFound, not somebody else's book.
 */

const initialState: CirculationFormState = { status: "idle" };

export function IssueConfirm({
  memberUserId,
  copyId,
  readerName,
  blockers,
}: {
  memberUserId: string;
  copyId: string;
  readerName: string;
  /**
   * Rendered here rather than by the server page above, so that a successful
   * issue takes them away with it. Left on the page, they reappear the instant
   * the issue succeeds — because the book really is out now — and a librarian
   * reads "cannot go out" directly above "is now with Aarav Sharma".
   */
  blockers: string[];
}) {
  const [state, formAction, pending] = useActionState(issueBookAction, initialState);

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-lg font-bold text-success">
          <Icon name="check" /> {state.message}
        </p>
        <div className="flex flex-wrap gap-3">
          {/*
            A plain link, not a router push: after an issue the librarian either
            serves the next child or looks at the list, and a full navigation
            gets them a clean form rather than one still holding the last
            child's name.
          */}
          <a
            href="/desk/circulation"
            className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-[var(--radius-button)] bg-primary px-6 text-lg font-bold text-white no-underline hover:bg-primary-deep"
          >
            Next reader
          </a>
          <a
            href="/desk/loans"
            className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-[var(--radius-button)] border border-control-border px-6 text-lg font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
          >
            See books out
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberUserId" value={memberUserId} />
      <input type="hidden" name="copyId" value={copyId} />

      {blockers.length > 0 ? (
        <Callout tone="warn" title="This one cannot go out yet">
          <ul className="flex list-disc flex-col gap-1 ps-5">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Button type="submit" size="lg" icon={<Icon name="shelf" />} disabled={blockers.length > 0 || pending}>
        {pending ? "Issuing…" : `Issue to ${readerName}`}
      </Button>

      {state.status === "error" ? (
        <p role="alert" className="text-lg font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
