"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import {
  approveRegistrationAction,
  recordStaffVerificationAction,
  rejectRegistrationAction,
  type DeskActionState,
} from "@/server/actions/registration-actions";
import { Icon } from "@/components/ui/icon";

const INITIAL: DeskActionState = { status: "idle" };

/**
 * Approve and reject controls for one registration.
 *
 * Approve is one click, because it is the common case and a child may be
 * waiting. Reject asks for a reason first — the reason is for the library's own
 * records and is never sent to the family.
 *
 * **Deciding is the Super Admin's.** A librarian holds `registration.view` and
 * not `registration.review`, so they see the whole submission — that is how
 * they recognise the family at the desk — and they see no Approve or Reject
 * button at all. The server refuses either way: `approveRegistration` and
 * `rejectRegistration` both call `requirePermission("registration.review")`, so
 * hiding the buttons removes a dead end, not a control. See ADR-040.
 *
 * When the library requires stronger guardian verification than the form can
 * produce, the approve button is replaced by the way to close that gap. The
 * server refuses the approval regardless (see `assertVerificationSufficient`);
 * this only makes the refusal legible before it happens.
 */
export function ReviewActions({
  registrationId,
  verificationSatisfied,
  awaitingGuardian,
  canReview,
  canVerify,
}: {
  registrationId: string;
  verificationSatisfied: boolean;
  awaitingGuardian: boolean;
  canReview: boolean;
  canVerify: boolean;
}) {
  const [approveState, approve, approving] = useActionState(approveRegistrationAction, INITIAL);
  const [rejectState, reject, rejecting] = useActionState(rejectRegistrationAction, INITIAL);
  const [verifyState, verify, verifying] = useActionState(
    recordStaffVerificationAction,
    INITIAL,
  );
  const [showReject, setShowReject] = useState(false);
  const [showVerify, setShowVerify] = useState(false);

  const state =
    approveState.status !== "idle"
      ? approveState
      : rejectState.status !== "idle"
        ? rejectState
        : verifyState;

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
      ) : showVerify ? (
        <form action={verify} className="flex flex-col gap-3">
          <input type="hidden" name="registrationId" value={registrationId} />
          <Field
            id={`evidence-${registrationId}`}
            label="How did you confirm this?"
            hint="A short note for our records — “spoke to her at the desk”. Never write down identity documents."
            required
          >
            <TextInput
              id={`evidence-${registrationId}`}
              name="evidenceNote"
              required
              minLength={3}
              maxLength={500}
              placeholder="e.g. spoke to her at the desk on Saturday"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={verifying}>
              {verifying ? "Recording…" : "Record confirmation"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setShowVerify(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : !canReview ? (
        /* A librarian's view: everything above this point still renders, so the
           details are all there to read. What is missing is the decision. */
        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-warn-wash px-3 py-2 text-base font-bold text-ink">
            Waiting for Super Admin approval.
          </p>
          <p className="text-base text-ink-soft">
            You can review the details, but only the Super Admin can approve or reject a new
            member.
          </p>
          {canVerify && !verificationSatisfied ? (
            <Button size="sm" onClick={() => setShowVerify(true)} icon={<Icon name="handshake" />}>
              Confirm the guardian
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {verificationSatisfied ? (
            <form action={approve}>
              <input type="hidden" name="registrationId" value={registrationId} />
              <Button type="submit" size="sm" disabled={approving} icon={<Icon name="check" />}>
                {approving ? "Approving…" : "Approve"}
              </Button>
            </form>
          ) : canVerify ? (
            <Button size="sm" onClick={() => setShowVerify(true)} icon={<Icon name="handshake" />}>
              Confirm the guardian
            </Button>
          ) : (
            <p className="rounded-lg bg-warn-wash px-3 py-2 text-base text-ink">
              {awaitingGuardian
                ? "Waiting for the parent or guardian to confirm by email."
                : "Guardian verification is needed before this can be approved."}
            </p>
          )}
          <Button variant="quiet" size="sm" onClick={() => setShowReject(true)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
