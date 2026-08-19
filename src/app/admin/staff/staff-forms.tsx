"use client";

import { useActionState, useState } from "react";

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
        <ActivationFallback staffId={staffId} emailSent={invitationEmailSent} />
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

/**
 * The way in, when email is not the way in.
 *
 * A library can be running before its mail provider is configured, and in that
 * state a new librarian's account exists and nobody can get into it. This is
 * the answer: the Super Admin takes one activation link out by hand and gives
 * it to them through a channel they trust.
 *
 * What it is careful about:
 *
 *   * **The link is minted when the button is pressed**, not when the page is
 *     rendered. Nothing on this screen holds a live token until an
 *     administrator deliberately asks for one, so simply opening the staff list
 *     does not put credentials on anybody's screen.
 *   * **It goes to the clipboard, not onto the page.** The text box below only
 *     appears when the clipboard is unavailable — an insecure origin, or a
 *     browser that refused — because copying it is the whole purpose and a
 *     visible token with no way to copy it would be worse than useless.
 *   * **It is never rendered for a librarian or a reader**, who cannot reach
 *     this page at all, and the service checks the permission again regardless.
 *
 * There is still no password field here. The librarian chooses their own.
 */
function ActivationFallback({
  staffId,
  emailSent,
}: {
  staffId: string;
  emailSent: boolean | null;
}) {
  const [state, formAction, pending] = useActionState(issueStaffActivationLinkAction, INITIAL);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const url = state.status === "success" ? state.activationUrl : undefined;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // Insecure origin, or the browser said no. Show it so it can be copied
      // by hand rather than leaving the administrator with nothing.
      setCopyFailed(true);
    }
  }

  return (
    <div className="rounded-[var(--radius-field)] bg-surface-sunk p-3">
      <p className="font-bold text-ink">
        {emailSent === false ? "Activation not sent" : "Waiting for them to set a password"}
      </p>
      <p className="mt-1 text-base text-ink-soft">
        {emailSent === false
          ? "The invitation email could not be sent."
          : "They have not chosen a password yet."}
      </p>

      {!url ? (
        <form action={formAction} className="mt-2">
          <input type="hidden" name="staffId" value={staffId} />
          <Button type="submit" variant="secondary" size="sm" disabled={pending} icon={<Icon name="key" />}>
            {pending ? "Making a link…" : "Copy activation link"}
          </Button>
        </form>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={copy} icon={<Icon name="key" />}>
              {copied ? "Copied" : "Copy to clipboard"}
            </Button>
            {copied ? (
              <span role="status" className="text-base font-bold text-success">
                Activation link copied.
              </span>
            ) : null}
          </div>

          {/*
            Only when the clipboard would not take it. Small and plain: it has
            to be selectable, and it has to not look like a prize.
          */}
          {copyFailed ? (
            <>
              <label htmlFor={`link-${staffId}`} className="text-base text-ink-soft">
                Copy did not work — select this and copy it by hand:
              </label>
              <input
                id={`link-${staffId}`}
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="w-full rounded-lg border-2 border-control-border bg-surface px-2 py-1 font-mono text-sm text-ink-soft"
              />
            </>
          ) : null}

          <p className="text-base text-ink-soft">
            Send it to them yourself. It works once, replaces any earlier link, and expires.
          </p>
        </div>
      )}

      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
