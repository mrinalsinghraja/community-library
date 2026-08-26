"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CHANGE_LIMITS } from "@/lib/profile-changes";
import { decideProfileChangeAction, type ProfileFormState } from "@/server/actions/profile-actions";

/**
 * The desk's answer to one correction.
 *
 * Asymmetric on purpose, the same shape as review moderation: approving is one
 * press, refusing asks for a note first. A child told "no" and nothing else has
 * been refused by a machine, and the note is the only thing they will read.
 *
 * Neither button is the security boundary. `profile_change.review` is checked
 * inside the service, so a librarian who forged this form changes nothing.
 */

const initialState: ProfileFormState = { status: "idle" };

export function ChangeDecision({
  requestId,
  memberName,
  affectsRecovery,
}: {
  requestId: string;
  memberName: string;
  /** True when approving moves where this account's reset link is delivered. */
  affectsRecovery: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideProfileChangeAction, initialState);
  const [refusing, setRefusing] = useState(false);

  if (refusing) {
    return (
      <form action={formAction} className="flex w-60 flex-col gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="approve" value="false" />

        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          {/*
            Named after its reader, not after its purpose. "Reason" invites a
            note to the file; "what should they know" invites a sentence to a
            child.
          */}
          What should they know?
          <input
            type="text"
            name="decisionNote"
            required
            maxLength={CHANGE_LIMITS.decisionNoteMaxLength}
            placeholder="Come and see me and we will sort it out"
            className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {pending ? "Sending…" : "Send it back"}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setRefusing(false)}>
            Cancel
          </Button>
        </div>

        {state.status === "error" ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/*
        Said on the row itself, not once at the top of the page. Approving a new
        guardian email moves this account's recovery path to a different inbox,
        and that is worth reading beside the button rather than above the table.
      */}
      {affectsRecovery ? (
        <p className="w-52 text-sm font-semibold text-accent-ink">
          This changes where their reset link goes.
        </p>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="approve" value="true" />
        <Button type="submit" size="sm" icon={<Icon name="check" />} disabled={pending}>
          {pending ? "Applying…" : "Apply"}
          <span className="sr-only"> — {memberName}</span>
        </Button>
      </form>

      <Button variant="quiet" size="sm" onClick={() => setRefusing(true)}>
        Send it back
      </Button>

      {state.status === "error" ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
