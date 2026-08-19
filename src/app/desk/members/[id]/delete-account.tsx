"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { deleteMemberAction, type ActionState } from "@/server/actions/account-actions";

const INITIAL: ActionState = { status: "idle" };

/**
 * "Delete permanently", for one reader.
 *
 * Two deliberate steps, and the second one asks for the reader's name in full.
 * That is not security — the person here already holds `user.delete` — it is a
 * pause. Typing a child's name is a different act from clicking a red button,
 * and it is the last thing between an administrator and a record that cannot be
 * brought back.
 *
 * Everything this component does is refused again on the server: the permission,
 * the reason, and the history check that turns most attempts into an archive
 * instead. Hiding the button from a librarian is a courtesy; `user.delete` is
 * what actually stops them.
 */
export function DeleteAccount({
  memberId,
  displayName,
}: {
  memberId: string;
  displayName: string;
}) {
  const [state, formAction, pending] = useActionState(deleteMemberAction, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");

  const nameMatches = typedName.trim().toLowerCase() === displayName.trim().toLowerCase();

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        {state.status === "error" ? (
          <p role="alert" className="text-base font-bold text-danger">
            {state.message}
          </p>
        ) : null}
        <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>
          Delete permanently
        </Button>
        <p className="text-base text-ink-soft">
          Only possible for an account that has never been used. Anything with library history is
          closed instead, and its record is kept.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="memberId" value={memberId} />

      <p className="rounded-[var(--radius-field)] bg-danger-wash px-4 py-3 text-base text-ink">
        This removes {displayName}&rsquo;s account for good. It cannot be undone.
      </p>

      <Field
        id={`confirm-${memberId}`}
        label={`Type ${displayName} to confirm`}
        hint="Exactly as it appears above."
        required
      >
        <TextInput
          id={`confirm-${memberId}`}
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          autoComplete="off"
          className="min-h-11 text-base"
        />
      </Field>

      <Field id={`delete-reason-${memberId}`} label="Why? (our records only)" required>
        <TextInput
          id={`delete-reason-${memberId}`}
          name="reason"
          required
          minLength={3}
          maxLength={500}
          placeholder="e.g. registered twice by mistake"
          className="min-h-11 text-base"
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={!nameMatches || pending}>
          {pending ? "Deleting…" : "Delete permanently"}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setConfirming(false);
            setTypedName("");
          }}
        >
          Keep this account
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
