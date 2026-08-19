"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { BORROW_REQUEST_MESSAGES, type ReaderBorrowState } from "@/lib/circulation";
import {
  cancelBorrowRequestAction,
  requestBorrowAction,
  type CirculationFormState,
} from "@/server/actions/circulation-actions";
import { Icon } from "@/components/ui/icon";

/**
 * "Please may I have this one?"
 *
 * The one thing a child can do about a book they have found, and the control
 * that has to carry the library's most important rule without ever sounding
 * like a rule: **finding a book here is not taking it off the shelf.** The
 * books live in the library room. One goes home when a librarian hands it over,
 * and this button is how a child asks them to.
 *
 * So every state below says where the book is and what happens next, and none
 * of them says "reserved", "queued", "position" or anything else that would
 * promise a child something the library has not agreed to. Asking is asking.
 *
 * The only thing this form sends is the code printed on the book's own label.
 * No copy id, no member id, no library — who is asking is decided from the
 * session on the server, so there is nothing here worth tampering with.
 */

const initialState: CirculationFormState = { status: "idle" };

export function BorrowRequest({
  code,
  title,
  state,
  canAsk,
  alreadyBorrowed,
  spokenFor,
  onShelf,
}: {
  code: string;
  title: string;
  state: ReaderBorrowState;
  canAsk: boolean;
  alreadyBorrowed: boolean;
  spokenFor: boolean;
  onShelf: boolean;
}) {
  const [ask, askAction, asking] = useActionState(requestBorrowAction, initialState);
  const [undo, undoAction, undoing] = useActionState(cancelBorrowRequestAction, initialState);
  const [confirming, setConfirming] = useState(false);

  // Whatever just happened wins over whatever the page was rendered with — the
  // child pressed a button and deserves to see the result of that press.
  if (ask.status === "success" || (state === "pending" && undo.status !== "success")) {
    return (
      <div className="mt-6 rounded-[var(--radius-card)] bg-accent-wash p-5">
        <p role="status" className="flex items-start gap-2 text-lg font-bold text-ink">
          <Icon name="check" className="mt-1 text-accent-ink" />
          {BORROW_REQUEST_MESSAGES.pending}
        </p>
        <p className="mt-2 text-base text-ink-soft">{BORROW_REQUEST_MESSAGES.collectionNote}</p>

        {!confirming ? (
          <Button variant="quiet" size="sm" className="mt-3" onClick={() => setConfirming(true)}>
            Actually, never mind
          </Button>
        ) : (
          <form action={undoAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="code" value={code} />
            <Button type="submit" variant="secondary" size="sm" disabled={undoing}>
              {undoing ? "Taking it back…" : "Yes, take my question away"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
              Keep asking
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
      <p role="status" className="mt-6 text-lg text-ink-soft">
        {BORROW_REQUEST_MESSAGES.cancelled}
      </p>
    );
  }

  if (alreadyBorrowed) {
    return (
      <p className="mt-6 flex items-start gap-2 text-lg font-bold text-success">
        <Icon name="check" className="mt-1" />
        This one is already on your shelf.
      </p>
    );
  }

  if (state === "declined") {
    return (
      <div className="mt-6 rounded-[var(--radius-card)] bg-surface-sunk p-5">
        <p className="flex items-start gap-2 text-lg text-ink">
          <Icon name="info" className="mt-1 text-ink-soft" />
          {BORROW_REQUEST_MESSAGES.declined}
        </p>
        {/* Asking again is allowed — the reason may not be true next week. */}
        {canAsk ? <AskForm code={code} title={title} action={askAction} pending={asking} state={ask} /> : null}
      </div>
    );
  }

  if (spokenFor) {
    return (
      <p className="mt-6 flex items-start gap-2 text-lg text-ink-soft">
        <Icon name="info" className="mt-1" />
        {BORROW_REQUEST_MESSAGES.spokenFor}
      </p>
    );
  }

  if (!onShelf || !canAsk) {
    // A sentence, not a disabled button. A control a child cannot use is a
    // small closed door; a sentence telling them what to do is an answer.
    return null;
  }

  return (
    <div className="mt-6">
      <AskForm code={code} title={title} action={askAction} pending={asking} state={ask} />
      <p className="mt-3 text-base text-ink-soft">{BORROW_REQUEST_MESSAGES.collectionNote}</p>
    </div>
  );
}

function AskForm({
  code,
  title,
  action,
  pending,
  state,
}: {
  code: string;
  title: string;
  action: (formData: FormData) => void;
  pending: boolean;
  state: CirculationFormState;
}) {
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="code" value={code} />
      <Button type="submit" size="lg" icon={<Icon name="book" />} disabled={pending}>
        {pending ? "Asking…" : BORROW_REQUEST_MESSAGES.invitation}
      </Button>
      <span className="sr-only">Asking for {title}</span>
      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
