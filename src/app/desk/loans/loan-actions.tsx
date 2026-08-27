"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/field";
import { CONDITIONS } from "@/lib/catalogue";
import {
  cancelLoanAction,
  renewLoanAction,
  returnBookAction,
  type CirculationFormState,
} from "@/server/actions/circulation-actions";
import { Icon } from "@/components/ui/icon";

/**
 * The three things a librarian does to a book that is already out, in the order
 * they actually happen.
 *
 * **One of them is the job and two are exceptions**, and the screen now says so
 * rather than offering four buttons of equal weight. Almost every row on this
 * page ends the same way: a child walks up with a book and it goes back on the
 * shelf. Taking it back is the only filled button. Extending a loan for a child
 * who asked in person, recording that a book came back damaged, and undoing a
 * mis-issue are all real and all rare, so they are quiet.
 *
 * Each is its own small form with its own state, so a failed renewal does not
 * blank the return control next to it, and a queue of children does not have to
 * wait for a page that has lost its place.
 *
 * Every button here is also a permission the server checks independently.
 * Hiding one is a courtesy to a role that cannot use it; the service is what
 * refuses.
 */

const initialState: CirculationFormState = { status: "idle" };

export function LoanActions({
  loanId,
  copyCode,
  canReturn,
  canRenew,
  canCancel,
  renewalsLeft,
  renewalBlockedByOverdue,
}: {
  loanId: string;
  copyCode: string;
  canReturn: boolean;
  canRenew: boolean;
  canCancel: boolean;
  renewalsLeft: number;
  /** The library's policy, evaluated on the server against this loan's date. */
  renewalBlockedByOverdue: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {canReturn ? <ReturnControl loanId={loanId} copyCode={copyCode} /> : null}
      {canRenew ? (
        <RenewControl
          loanId={loanId}
          renewalsLeft={renewalsLeft}
          blockedByOverdue={renewalBlockedByOverdue}
        />
      ) : null}
      {canCancel ? <CancelControl loanId={loanId} copyCode={copyCode} /> : null}
    </div>
  );
}

/**
 * Taking a book back.
 *
 * One click for the ordinary case. The condition dropdown sits behind a link
 * named for the reason somebody would want it — "Damaged or torn?" — rather
 * than for the click itself: "Check it first" read like a second, more careful
 * way of returning, which made two buttons look like a choice a librarian had
 * to make on every row. It is not a choice. It is an exception.
 *
 * The dropdown's default is deliberately "leave it as it is" rather than Good:
 * a book that went out Fair comes back Fair unless somebody actually looked.
 */
function ReturnControl({ loanId, copyCode }: { loanId: string; copyCode: string }) {
  const [state, formAction, pending] = useActionState(returnBookAction, initialState);
  const [checking, setChecking] = useState(false);

  if (state.status === "success") {
    return (
      <p role="status" className="text-base font-bold text-success">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="loanId" value={loanId} />

      {checking ? (
        <>
          <label
            htmlFor={`condition-${loanId}`}
            className="text-base font-semibold text-ink"
          >
            What shape is it in?
          </label>
          <Select
            id={`condition-${loanId}`}
            name="condition"
            defaultValue=""
            className="min-h-11 text-base"
          >
            <option value="">Leave it as it is</option>
            {CONDITIONS.map((condition) => (
              <option key={condition.value} value={condition.value}>
                {condition.label} — {condition.hint}
              </option>
            ))}
          </Select>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" icon={<Icon name="returnBook" />} disabled={pending}>
          {pending ? "Taking it back…" : "Accept Return"}
        </Button>
        {!checking ? (
          <Button variant="quiet" size="sm" onClick={() => setChecking(true)}>
            Damaged or torn?
          </Button>
        ) : null}
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
      <span className="sr-only">Returning {copyCode}</span>
    </form>
  );
}

function RenewControl({
  loanId,
  renewalsLeft,
  blockedByOverdue,
}: {
  loanId: string;
  renewalsLeft: number;
  blockedByOverdue: boolean;
}) {
  const [state, formAction, pending] = useActionState(renewLoanAction, initialState);

  if (state.status === "success") {
    return (
      <p role="status" className="text-base font-bold text-success">
        {state.message}
      </p>
    );
  }

  const blocked = renewalsLeft <= 0 || blockedByOverdue;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="loanId" value={loanId} />
      {/*
        Shown even when it cannot be used, and disabled rather than hidden — so
        the librarian can see the rule exists and tell the child why, instead of
        hunting for a button that is not there. The label says which rule.

        Disabling is a courtesy; `renewLoan` re-checks both rules server-side
        and refuses regardless of what the browser did.
      */}
      <Button type="submit" variant="quiet" size="sm" icon={<Icon name="renew" />} disabled={pending || blocked}>
        {blockedByOverdue
          ? "Return it first"
          : renewalsLeft <= 0
            ? "No renewals left"
            : pending
              ? "Extending…"
              : "Let them keep it longer"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Cancelling a mis-issue.
 *
 * The one administrative correction Phase 3 provides, and it asks for a reason
 * because an unexplained correction in an audit log is worse than none. Nothing
 * is deleted: the loan becomes CANCELLED, keeps its events, and the reason goes
 * with it.
 *
 * Behind a confirm step so it cannot be the button somebody hits by accident
 * while reaching for Return.
 */
function CancelControl({ loanId, copyCode }: { loanId: string; copyCode: string }) {
  const [state, formAction, pending] = useActionState(cancelLoanAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (state.status === "success") {
    return (
      <p role="status" className="text-base font-bold text-success">
        {state.message}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button variant="quiet" size="sm" icon={<Icon name="cross" />} onClick={() => setConfirming(true)}>
        Issued by mistake
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      <p className="text-base text-ink-soft">
        Undo issuing {copyCode}? The record stays, with your reason on it.
      </p>
      <TextInput
        name="reason"
        placeholder="Why? (e.g. wrong child)"
        maxLength={500}
        required
        className="min-h-11 text-base"
        aria-label={`Reason for cancelling the loan of ${copyCode}`}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel it"}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
          Leave it
        </Button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
