"use client";

import { useActionState, useState } from "react";

import { ActivationFallback } from "@/components/library/activation-fallback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import {
  createStaffAction,
  deactivateStaffAction,
  deleteStaffAction,
  issueStaffActivationLinkAction,
  reactivateStaffAction,
  reissueStaffActivationAction,
  suspendStaffAction,
  type ActionState,
} from "@/server/actions/account-actions";
import { Icon } from "@/components/ui/icon";

const INITIAL: ActionState = { status: "idle" };

function Notice({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;

  return (
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
  );
}

/**
 * Add a librarian.
 *
 * Two fields, and no role picker: everyone this form creates is a Librarian.
 * No password field either — the new librarian is emailed a single-use link and
 * chooses their own, so the Super Admin creating the account never learns it,
 * and there is nowhere for them to type one.
 */
export function CreateStaffForm() {
  const [state, formAction, pending] = useActionState(createStaffAction, INITIAL);

  return (
    <Card>
      <h2 className="text-2xl">Add Librarian</h2>
      <p className="mt-2 text-ink-soft">
        Create a Librarian account for helping manage the library.
      </p>
      <p className="mt-2 text-ink-soft">
        They will be emailed a link to choose their own password. You will never see it.
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        <Notice state={state} />

        <Field id="displayName" label="Full name" error={state.fieldErrors?.displayName} required>
          <TextInput id="displayName" name="displayName" autoComplete="off" required />
        </Field>

        <Field id="email" label="Email address" error={state.fieldErrors?.email} required>
          <TextInput id="email" name="email" type="email" autoCapitalize="none" required />
        </Field>

        <Button type="submit" size="md" disabled={pending} icon={<Icon name="plus" />}>
          {pending ? "Creating…" : "Add Librarian"}
        </Button>
      </form>
    </Card>
  );
}

/** Per-person controls. `isSelf` disables everything that would lock you out. */
export function StaffRowActions({
  staffId,
  displayName,
  status,
  isSelf,
  mustSetPassword,
  invitationEmailSent,
  canDelete,
}: {
  staffId: string;
  displayName: string;
  status: string;
  isSelf: boolean;
  /** They have not chosen a password yet, so the invitation still matters. */
  mustSetPassword: boolean;
  /** Null when nothing was ever attempted. False when the mailer refused. */
  invitationEmailSent: boolean | null;
  /** Super Admin only. Hiding it is a courtesy; the service is what refuses. */
  canDelete: boolean;
}) {
  const [suspendState, suspend, suspending] = useActionState(suspendStaffAction, INITIAL);
  const [reactivateState, reactivate, reactivating] = useActionState(reactivateStaffAction, INITIAL);
  const [deactivateState, deactivate, deactivating] = useActionState(deactivateStaffAction, INITIAL);
  const [reissueState, reissue, reissuing] = useActionState(reissueStaffActivationAction, INITIAL);

  const [deleteState, remove, removing] = useActionState(deleteStaffAction, INITIAL);

  const [prompt, setPrompt] = useState<"suspend" | "deactivate" | "delete" | null>(null);
  const [typedName, setTypedName] = useState("");

  const state = [suspendState, reactivateState, deactivateState, reissueState, deleteState].find(
    (candidate) => candidate.status !== "idle",
  );

  const nameMatches = typedName.trim().toLowerCase() === displayName.trim().toLowerCase();

  if (isSelf) {
    return (
      <p className="text-base text-ink-soft">
        This is you. Another administrator has to make changes to your account.
      </p>
    );
  }

  const isPaused = status === "SUSPENDED" || status === "DEACTIVATED";

  return (
    <div className="flex flex-col gap-2">
      {state ? <Notice state={state} /> : null}

      {/*
        The account exists and nobody can get into it. That is the state this
        block is for, and it is a normal state for a library whose email is not
        configured yet — so it explains itself rather than looking like a fault.
      */}
      {mustSetPassword && !isPaused ? (
        <ActivationFallback
          subjectId={staffId}
          fieldName="staffId"
          action={issueStaffActivationLinkAction}
          emailSent={invitationEmailSent}
          waitingLabel="Waiting for them to set a password"
          waitingDetail="They have not chosen a password yet."
        />
      ) : null}

      {prompt === "delete" ? (
        /*
          Two deliberate steps, and the second asks for the person's name. Not
          security — whoever is here already holds `user.delete` — but a pause,
          because this is the one control on the screen that removes a record
          rather than changing its state.
        */
        <form action={remove} className="flex flex-col gap-2">
          <input type="hidden" name="staffId" value={staffId} />
          <p className="rounded-lg bg-danger-wash px-3 py-2 text-base text-ink">
            This removes {displayName}&rsquo;s account for good. It cannot be undone, and it only
            works for an account nobody has ever used.
          </p>
          <label htmlFor={`staff-confirm-${staffId}`} className="text-base font-bold text-ink">
            Type {displayName} to confirm
          </label>
          <TextInput
            id={`staff-confirm-${staffId}`}
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            autoComplete="off"
          />
          <label htmlFor={`staff-delete-reason-${staffId}`} className="text-base font-bold text-ink">
            Why? (our records only)
          </label>
          <TextInput
            id={`staff-delete-reason-${staffId}`}
            name="reason"
            required
            minLength={3}
            maxLength={500}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={!nameMatches || removing}>
              {removing ? "Deleting…" : "Delete permanently"}
            </Button>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setPrompt(null);
                setTypedName("");
              }}
            >
              Keep this account
            </Button>
          </div>
        </form>
      ) : prompt ? (
        <form action={prompt === "suspend" ? suspend : deactivate} className="flex flex-col gap-2">
          <input type="hidden" name="staffId" value={staffId} />
          <label htmlFor={`staff-reason-${staffId}`} className="text-base font-bold text-ink">
            Why? (our records only)
          </label>
          <TextInput id={`staff-reason-${staffId}`} name="reason" required minLength={3} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={suspending || deactivating}>
              {prompt === "suspend" ? "Suspend" : "Close account"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!isPaused ? (
            <Button variant="quiet" size="sm" onClick={() => setPrompt("suspend")}>
              Suspend
            </Button>
          ) : (
            <form action={reactivate}>
              <input type="hidden" name="staffId" value={staffId} />
              <Button type="submit" size="sm" disabled={reactivating}>
                Reactivate
              </Button>
            </form>
          )}

          {!isPaused ? (
            <form action={reissue}>
              <input type="hidden" name="staffId" value={staffId} />
              <Button type="submit" variant="quiet" size="sm" disabled={reissuing}>
                {reissuing ? "Sending…" : "Send link again"}
              </Button>
            </form>
          ) : null}

          {!isPaused ? (
            <Button variant="quiet" size="sm" onClick={() => setPrompt("deactivate")}>
              Close
            </Button>
          ) : null}

          {canDelete ? (
            <Button variant="quiet" size="sm" onClick={() => setPrompt("delete")}>
              Delete permanently
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
