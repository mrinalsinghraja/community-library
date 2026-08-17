"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import {
  approveRegistrationAction,
  rejectRegistrationAction,
  type DeskActionState,
} from "@/server/actions/registration-actions";

const INITIAL: DeskActionState = { status: "idle" };

/**
 * Approve and reject controls for one registration.
 *
 * Approve is one click, because it is the common case and a librarian may have
 * a child waiting. Reject asks for a reason first — the reason is for the
 * library's own records and is never sent to the family.
 */
export function ReviewActions({ registrationId }: { registrationId: string }) {
  const [approveState, approve, approving] = useActionState(approveRegistrationAction, INITIAL);
  const [rejectState, reject, rejecting] = useActionState(rejectRegistrationAction, INITIAL);
  const [showReject, setShowReject] = useState(false);

  const state = approveState.status !== "idle" ? approveState : rejectState;

  return (
    <div className="flex flex-col gap-3">
      {state.status !== "idle" && state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "rounded-lg bg-danger-wash px-3 py-2 text-base font-bold text-danger"
              : "rounded-lg bg-success-wash px-3 py-2 text-base font-bold text-success"
          }
        >
          {state.message}
        </p>
      ) : null}

      {showReject ? (
        <form action={reject} className="flex flex-col gap-3">
          <input type="hidden" name="registrationId" value={registrationId} />
          <Field
            id={`reason-${registrationId}`}
            label="Why? (for our records only)"
            hint="The family never sees this — they get a friendly note asking them to come and talk to us."
            required
          >
            <TextInput
              id={`reason-${registrationId}`}
              name="reason"
              required
              minLength={3}
              placeholder="e.g. duplicate of an existing card"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={rejecting}>
              {rejecting ? "Closing…" : "Confirm reject"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setShowReject(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={approve}>
            <input type="hidden" name="registrationId" value={registrationId} />
            <Button type="submit" size="sm" disabled={approving} icon="✅">
              {approving ? "Approving…" : "Approve"}
            </Button>
          </form>
          <Button variant="quiet" size="sm" onClick={() => setShowReject(true)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
