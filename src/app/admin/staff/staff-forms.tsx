"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { ROLE_KEYS } from "@/lib/permissions";
import {
  createStaffAction,
  deactivateStaffAction,
  reactivateStaffAction,
  reissueStaffActivationAction,
  setStaffRoleAction,
  suspendStaffAction,
  type ActionState,
} from "@/server/actions/account-actions";

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
 * Add a staff account.
 *
 * No password field, deliberately. The new librarian is emailed a single-use
 * link and chooses their own — the Super Admin creating the account never
 * learns it, and there is nowhere for them to type one.
 */
export function CreateStaffForm() {
  const [state, formAction, pending] = useActionState(createStaffAction, INITIAL);

  return (
    <Card>
      <h2 className="text-2xl">Add someone to the team</h2>
      <p className="mt-2 text-ink-soft">
        They will be emailed a link to choose their own password. You will never see it.
      </p>

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        <Notice state={state} />

        <Field id="displayName" label="Their name" error={state.fieldErrors?.displayName} required>
          <TextInput id="displayName" name="displayName" autoComplete="off" required />
        </Field>

        <Field id="email" label="Their email" error={state.fieldErrors?.email} required>
          <TextInput id="email" name="email" type="email" autoCapitalize="none" required />
        </Field>

        <Field id="roleKey" label="Role" error={state.fieldErrors?.roleKey} required>
          <select
            id="roleKey"
            name="roleKey"
            defaultValue={ROLE_KEYS.LIBRARIAN}
            className="min-h-14 w-full rounded-[var(--radius-field)] border-2 border-control-border bg-surface px-4 text-lg"
          >
            <option value={ROLE_KEYS.LIBRARIAN}>Librarian</option>
            <option value={ROLE_KEYS.SUPER_ADMIN}>Super Admin</option>
          </select>
        </Field>

        <Button type="submit" size="md" disabled={pending} icon="➕">
          {pending ? "Creating…" : "Create account"}
        </Button>
      </form>
    </Card>
  );
}

/** Per-person controls. `isSelf` disables everything that would lock you out. */
export function StaffRowActions({
  staffId,
  status,
  roleKey,
  isSelf,
}: {
  staffId: string;
  status: string;
  roleKey: string;
  isSelf: boolean;
}) {
  const [suspendState, suspend, suspending] = useActionState(suspendStaffAction, INITIAL);
  const [reactivateState, reactivate, reactivating] = useActionState(reactivateStaffAction, INITIAL);
  const [deactivateState, deactivate, deactivating] = useActionState(deactivateStaffAction, INITIAL);
  const [roleState, changeRole, changingRole] = useActionState(setStaffRoleAction, INITIAL);
  const [reissueState, reissue, reissuing] = useActionState(reissueStaffActivationAction, INITIAL);

  const [prompt, setPrompt] = useState<"suspend" | "deactivate" | null>(null);

  const state = [suspendState, reactivateState, deactivateState, roleState, reissueState].find(
    (candidate) => candidate.status !== "idle",
  );

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

      {prompt ? (
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

          <form action={changeRole} className="flex items-center gap-2">
            <input type="hidden" name="staffId" value={staffId} />
            <label htmlFor={`role-${staffId}`} className="sr-only">
              Role
            </label>
            <select
              id={`role-${staffId}`}
              name="roleKey"
              defaultValue={roleKey}
              className="min-h-11 rounded-lg border-2 border-control-border bg-surface px-2 text-base"
            >
              <option value={ROLE_KEYS.LIBRARIAN}>Librarian</option>
              <option value={ROLE_KEYS.SUPER_ADMIN}>Super Admin</option>
            </select>
            <Button type="submit" variant="quiet" size="sm" disabled={changingRole}>
              Set role
            </Button>
          </form>

          {!isPaused ? (
            <Button variant="quiet" size="sm" onClick={() => setPrompt("deactivate")}>
              Close
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
