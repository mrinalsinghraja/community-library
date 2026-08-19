"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import {
  decideBorrowRequestAction,
  type CirculationFormState,
} from "@/server/actions/circulation-actions";
import { Icon } from "@/components/ui/icon";

/**
 * Yes or no, on one child's request for a book.
 *
 * Approving is one press and it **issues the book** — the same transaction the
 * desk's own Issue button runs. The librarian then hands over the object, which
 * is the part no software can do.
 *
 * Declining asks for a short note first: the child is told something either
 * way, and somebody has to have written it.
 *
 * Both buttons are shown even when the rules would refuse, with the reason
 * beside them on the row. A librarian who can see the rule can explain it to
 * the child; one who finds a missing button has to guess. The service re-checks
 * everything at the moment of the press regardless.
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
  const [state, formAction, pending] = useActionState(decideBorrowRequestAction, initialState);
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
          placeholder="e.g. it is being mended just now"
          maxLength={500}
          required
          className="min-h-11 text-base"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Sending…" : "Not this one"}
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
          {pending ? "Saving…" : "Give it out"}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setDeclining(true)}>
          Not this one
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
