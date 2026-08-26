"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CLOSURE_KINDS } from "@/lib/account-lifecycle";
import { closeMemberAccountAction, type ProfileFormState } from "@/server/actions/profile-actions";

/**
 * Closing a reader's account: grown up, or left the building.
 *
 * Two buttons rather than one with a dropdown, because they record two
 * different facts and the library will want to count them differently —
 * children growing up every year is the library working, families leaving is
 * churn. A free-text reason cannot be counted.
 *
 * **Neither deletes anything, and the card says so out loud.** That sentence is
 * doing real work: an administrator who believes "close" might mean "erase"
 * will hesitate over a family who moved away, and the record the library
 * actually wants is the one they were afraid to make.
 *
 * `member.deactivate` is Super Admin only and is checked in the service, so
 * this is presentation rather than the boundary.
 */

const initialState: ProfileFormState = { status: "idle" };

export function CloseAccount({
  memberId,
  displayName,
  currentStatus,
}: {
  memberId: string;
  displayName: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(closeMemberAccountAction, initialState);
  const [choosing, setChoosing] = useState<string | null>(null);

  const kind = CLOSURE_KINDS.find((entry) => entry.status === choosing);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-ink-soft">
        Nothing is deleted. Their loans, reviews and any books they gave stay exactly where they
        are — those are the library&rsquo;s own records. The account simply stops working: no
        signing in, and no borrowing.
      </p>

      {!kind ? (
        <div className="flex flex-wrap gap-2">
          {CLOSURE_KINDS.filter((entry) => entry.status !== currentStatus).map((entry) => (
            <Button
              key={entry.status}
              variant="secondary"
              size="sm"
              onClick={() => setChoosing(entry.status)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      ) : (
        <form action={formAction} className="flex max-w-md flex-col gap-2">
          <input type="hidden" name="memberUserId" value={memberId} />
          <input type="hidden" name="status" value={kind.status} />

          <p className="text-base font-semibold text-ink">
            {kind.label} — {displayName}
          </p>
          <p className="text-sm text-ink-soft">{kind.description}</p>

          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            {/*
              For the library, not for the family. The reader is never shown
              this — they get a plain message and an invitation to come and
              talk, which is the rule everywhere else in this service.
            */}
            Why, for the library&rsquo;s own records
            <input
              type="text"
              name="reason"
              required
              maxLength={200}
              placeholder={
                kind.status === "LEFT" ? "Family moved to Whitefield" : "Turned 15 last year"
              }
              className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              {pending ? "Saving…" : kind.label}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setChoosing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {state.status !== "idle" && state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "text-base font-semibold text-danger"
              : "text-base font-semibold text-primary-deep"
          }
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
