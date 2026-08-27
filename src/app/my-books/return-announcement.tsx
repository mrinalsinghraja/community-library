"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { RETURN_ANNOUNCEMENT_MESSAGES } from "@/lib/circulation";
import {
  announceReturnAction,
  withdrawReturnAnnouncementAction,
  type CirculationFormState,
} from "@/server/actions/circulation-actions";

/**
 * "I've finished — this one is coming back."
 *
 * **This control does not return the book, and it must never look as if it
 * does.** The loan stays open, the due date does not move, and the copy stays
 * out until a librarian has it in their hands. Every sentence here is written
 * to keep that true: the child is told the library *knows*, never that the book
 * is *back*, because the second one becomes a lie the moment they close the
 * laptop and the book is still on the table.
 *
 * Why it exists at all, when a librarian could simply take the book: because a
 * child who has finished a book wants to do something about it, and the honest
 * something is telling the library. It also lets the desk see what to expect
 * before anybody walks in.
 *
 * Sends nothing but the code printed on the book, like the ask above it.
 * Ownership is decided from the session on the server.
 */

const initialState: CirculationFormState = { status: "idle" };

export function ReturnAnnouncement({
  code,
  title,
  announced,
  canAnnounce,
}: {
  code: string;
  title: string;
  announced: boolean;
  canAnnounce: boolean;
}) {
  const [tell, tellAction, telling] = useActionState(announceReturnAction, initialState);
  const [undo, undoAction, undoing] = useActionState(
    withdrawReturnAnnouncementAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);

  // What the child just did wins over what the page was rendered with.
  const isAnnounced = tell.status === "success" || (announced && undo.status !== "success");

  if (isAnnounced) {
    return (
      <div className="mt-3 rounded-[var(--radius-field)] bg-surface-sunk p-3">
        <p role="status" className="flex items-start gap-2 font-bold text-ink">
          <Icon name="returnBook" className="mt-1 text-accent-ink" />
          {RETURN_ANNOUNCEMENT_MESSAGES.announced}
        </p>
        {!confirming ? (
          <Button variant="quiet" size="sm" className="mt-2" onClick={() => setConfirming(true)}>
            I want to keep reading
          </Button>
        ) : (
          <form action={undoAction} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="code" value={code} />
            <Button type="submit" variant="secondary" size="sm" disabled={undoing}>
              {undoing ? "Putting it back…" : "Yes, I am still reading it"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
              No, I am returning it
            </Button>
          </form>
        )}
        {undo.status === "error" ? (
          <p role="alert" className="mt-2 text-base font-bold text-danger">
            {undo.message}
          </p>
        ) : null}
      </div>
    );
  }

  if (undo.status === "success") {
    return (
      <p role="status" className="mt-3 text-base text-ink-soft">
        {RETURN_ANNOUNCEMENT_MESSAGES.keptBack}
      </p>
    );
  }

  if (!canAnnounce) return null;

  return (
    <form action={tellAction} className="mt-3">
      <input type="hidden" name="code" value={code} />
      <p className="text-base text-ink-soft">{RETURN_ANNOUNCEMENT_MESSAGES.invitation}</p>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        icon={<Icon name="returnBook" />}
        className="mt-2"
        disabled={telling}
      >
        {telling ? "Telling the library…" : "I want to return this book"}
      </Button>
      <span className="sr-only">Telling the library about {title}</span>
      {tell.status === "error" ? (
        <p role="alert" className="mt-2 text-base font-bold text-danger">
          {tell.message}
        </p>
      ) : null}
    </form>
  );
}
