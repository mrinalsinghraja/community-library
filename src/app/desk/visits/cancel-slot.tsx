"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CANCEL_REASON_MAX_LENGTH } from "@/lib/visits";
import { cancelVisitSlotAction, type VisitFormState } from "@/server/actions/visit-actions";

/**
 * Calling one visiting time off.
 *
 * Two presses and a reason, deliberately slower than putting a time up. A slot
 * on this screen is one a family may already have read and arranged a Saturday
 * around, so cancelling it is breaking something rather than editing something.
 *
 * The reason is optional and worth writing: it is shown to readers exactly as
 * typed, and "the room is being painted" tells a family the library has not
 * simply forgotten them, which the word "cancelled" on its own does not.
 *
 * The button appears for the Super Admin only. `visit.cancel` is checked in the
 * service regardless, so this is presentation and not the boundary.
 */

const initialState: VisitFormState = { status: "idle" };

export function CancelSlot({ slotId, label }: { slotId: string; label: string }) {
  const [state, formAction, pending] = useActionState(cancelVisitSlotAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="quiet" size="sm" icon={<Icon name="cross" />} onClick={() => setConfirming(true)}>
          Cancel
          <span className="sr-only"> — {label}</span>
        </Button>
        {state.status === "error" ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-60 flex-col gap-2">
      <input type="hidden" name="slotId" value={slotId} />

      <p className="text-sm text-ink-soft">
        Readers see this time crossed out straight away. It does not disappear — that is the point.
      </p>

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Why, for readers to see
        <input
          type="text"
          name="reason"
          maxLength={CANCEL_REASON_MAX_LENGTH}
          placeholder="The room is being used that afternoon"
          className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel this time"}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
          Keep it
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
