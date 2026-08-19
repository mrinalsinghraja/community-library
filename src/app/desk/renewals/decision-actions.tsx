"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import {
  decideRenewalRequestAction,
  type CirculationFormState,
} from "@/server/actions/circulation-actions";
import { Icon } from "@/components/ui/icon";

/**
 * Yes or no, on one child's question.
 *
 * Approving is one press, because it is the answer most of these get and the
 * librarian is usually standing up. Declining asks for a short note first — the
 * child is told something either way, and somebody has to have written it.
 *
 * Both buttons are shown even when the request cannot be approved, with the
 * reason beside them on the row. A librarian who can see the rule can explain
 * it to the child; a librarian who finds a missing button cannot. The service
 * re-checks every rule at the moment of the press regardless.
 */

const initialState: CirculationFormState = { status: "idle" };

export function DecisionActions({
  requestId,
  readerName,
  title,
  canApprove,
}: {
  requestId: string;
  readerName: string;
  title: string;
  /** The desk's own read of the rules. Never what enforces them. */
  canApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideRenewalRequestAction, initialState);
  const [declining, setDeclining] = useState(false);

  if (state.status === "success") {
    return (
      <p role="status" className="text-base font-bold text-success">
        {state.message}
      </p>
    );
  }

  if (declining) {
    return (
      <form action={formAction} className="flex min-w-56 flex-col gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="decision" value="DECLINE" />
        <label htmlFor={`reason-${requestId}`} className="text-base text-ink-soft">
          A short note for {readerName}:
        </label>
        <TextInput
          id={`reason-${requestId}`}
          name="reason"
          placeholder="e.g. someone else is waiting for it"
          maxLength={500}
          required
          className="min-h-11 text-base"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Sending…" : "Not this time"}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setDeclining(false)}>
            Back
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

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="decision"
          value="APPROVE"
          size="sm"
          icon={<Icon name="check" />}
          disabled={pending || !canApprove}
        >
          {pending ? "Saving…" : "Yes, keep it"}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setDeclining(true)}>
          Not this time
        </Button>
      </div>
      <span className="sr-only">
        Deciding {readerName}&apos;s request for {title}
      </span>
      {state.status === "error" ? (
        <p role="alert" className="text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
