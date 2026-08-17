"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { RENEWAL_REQUEST_MESSAGES, renewalInvitation, type ReaderRenewalState } from "@/lib/circulation";
import {
  cancelRenewalRequestAction,
  requestRenewalAction,
  type CirculationFormState,
} from "@/server/actions/circulation-actions";

/**
 * "Can I keep it a bit longer?" — the one thing a child can ask the software.
 *
 * Everything about this control is shaped by who is using it. It is one button
 * with one sentence above it, in words a six-year-old can read. It never shows
 * a status name, a request id, a policy, or a date the librarian has not agreed
 * to yet. When the answer is no, it says what to do instead — bring it back —
 * and never why in the library's own vocabulary.
 *
 * The only thing it sends is the code printed on the book. There is no loan id
 * in this form, because there is no loan id on this page: ownership is decided
 * from the session on the server, and this control has nothing in it worth
 * tampering with.
 */

const initialState: CirculationFormState = { status: "idle" };

export function RenewalRequest({
  code,
  title,
  state,
  canAsk,
  blockedReason,
  renewalPeriodDays,
}: {
  code: string;
  title: string;
  state: ReaderRenewalState;
  canAsk: boolean;
  blockedReason: string | null;
  renewalPeriodDays: number;
}) {
  const [ask, askAction, asking] = useActionState(requestRenewalAction, initialState);
  const [undo, undoAction, undoing] = useActionState(cancelRenewalRequestAction, initialState);
  const [confirming, setConfirming] = useState(false);

  // Whatever just happened wins over whatever the page was rendered with — the
  // child pressed a button and deserves to see the result of that press.
  if (ask.status === "success" || (state === "pending" && undo.status !== "success")) {
    return (
      <div className="mt-3 rounded-[var(--radius-field)] bg-surface-sunk p-3">
        <p role="status" className="font-bold text-ink">
          ⏳ {RENEWAL_REQUEST_MESSAGES.pending}
        </p>
        {!confirming ? (
          <Button variant="quiet" size="sm" className="mt-2" onClick={() => setConfirming(true)}>
            Actually, never mind
          </Button>
        ) : (
          <form action={undoAction} className="mt-2 flex flex-wrap gap-2">
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
      <p role="status" className="mt-3 text-base text-ink-soft">
        {RENEWAL_REQUEST_MESSAGES.cancelled}
      </p>
    );
  }

  if (state === "approved") {
    return (
      <p className="mt-3 text-base font-bold text-success">
        🎉 {RENEWAL_REQUEST_MESSAGES.approved}
      </p>
    );
  }

  if (state === "declined") {
    return (
      <p className="mt-3 text-base text-ink-soft">📚 {RENEWAL_REQUEST_MESSAGES.declined}</p>
    );
  }

  if (!canAsk) {
    // A sentence, not a disabled button. A control a child cannot use is a
    // small closed door; a sentence telling them what to do is an answer.
    return blockedReason ? (
      <p className="mt-3 text-base text-ink-soft">{blockedReason}</p>
    ) : null;
  }

  return (
    <form action={askAction} className="mt-3">
      <input type="hidden" name="code" value={code} />
      <p className="text-base text-ink-soft">{renewalInvitation(renewalPeriodDays)}</p>
      <Button type="submit" variant="secondary" size="sm" icon="⏳" className="mt-2" disabled={asking}>
        {asking ? "Asking…" : "Ask to keep it"}
      </Button>
      <span className="sr-only">Asking about {title}</span>
      {ask.status === "error" ? (
        <p role="alert" className="mt-2 text-base font-bold text-danger">
          {ask.message}
        </p>
      ) : null}
    </form>
  );
}
