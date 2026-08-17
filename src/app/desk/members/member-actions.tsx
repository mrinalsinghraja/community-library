"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import {
  deactivateMemberAction,
  reactivateMemberAction,
  reissueActivationAction,
  suspendMemberAction,
  type ActionState,
} from "@/server/actions/account-actions";

const INITIAL: ActionState = { status: "idle" };

/**
 * Per-reader controls.
 *
 * Every destructive action asks for an internal reason first. That is partly
 * for the audit trail and partly because typing a reason is a moment's pause
 * before pausing a child's library account.
 */
export function MemberActions({
  memberId,
  status,
  canSuspend,
  canDeactivate,
  canReissue,
}: {
  memberId: string;
  status: string;
  canSuspend: boolean;
  canDeactivate: boolean;
  canReissue: boolean;
}) {
  const [suspendState, suspend, suspending] = useActionState(suspendMemberAction, INITIAL);
  const [reactivateState, reactivate, reactivating] = useActionState(reactivateMemberAction, INITIAL);
  const [deactivateState, deactivate, deactivating] = useActionState(deactivateMemberAction, INITIAL);
  const [reissueState, reissue, reissuing] = useActionState(reissueActivationAction, INITIAL);

  const [prompt, setPrompt] = useState<"suspend" | "deactivate" | null>(null);

  const state = [suspendState, reactivateState, deactivateState, reissueState].find(
    (candidate) => candidate.status !== "idle",
  );

  const isPaused = status === "SUSPENDED" || status === "DEACTIVATED";

  return (
    <div className="flex flex-col gap-2">
      {state?.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "text-base font-bold text-danger"
              : "text-base font-bold text-success"
          }
        >
          {state.message}
        </p>
      ) : null}

      {prompt ? (
        <form
          action={prompt === "suspend" ? suspend : deactivate}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="memberId" value={memberId} />
          <label htmlFor={`reason-${memberId}`} className="text-base font-bold text-ink">
            Why? (our records only)
          </label>
          <TextInput id={`reason-${memberId}`} name="reason" required minLength={3} />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={suspending || deactivating}
            >
              {prompt === "suspend" ? "Pause account" : "Close account"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canSuspend && !isPaused ? (
            <Button variant="quiet" size="sm" onClick={() => setPrompt("suspend")}>
              Pause
            </Button>
          ) : null}

          {canSuspend && isPaused ? (
            <form action={reactivate}>
              <input type="hidden" name="memberId" value={memberId} />
              <Button type="submit" size="sm" disabled={reactivating}>
                {reactivating ? "…" : "Un-pause"}
              </Button>
            </form>
          ) : null}

          {canReissue && !isPaused ? (
            <form action={reissue}>
              <input type="hidden" name="memberId" value={memberId} />
              <Button type="submit" variant="quiet" size="sm" disabled={reissuing}>
                {reissuing ? "Sending…" : "Send link again"}
              </Button>
            </form>
          ) : null}

          {canDeactivate && status !== "DEACTIVATED" ? (
            <Button variant="quiet" size="sm" onClick={() => setPrompt("deactivate")}>
              Close
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
