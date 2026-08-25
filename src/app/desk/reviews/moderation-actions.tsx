"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { setReviewHiddenAction, type ReviewFormState } from "@/server/actions/review-actions";

/**
 * Take a review down, or put it back.
 *
 * Taking one down asks for a reason and a second press; putting one back does
 * not. That asymmetry is on purpose — removing a child's words from a page they
 * were proud of is the consequential direction, and the reason is what lets the
 * librarian who did it explain themselves to a family six weeks later.
 *
 * The reason is stored, never published. "A grown-up took this down because…"
 * on a public page would be worse than the review.
 */

const initialState: ReviewFormState = { status: "idle" };

export function ModerationActions({
  reviewId,
  hidden,
  title,
}: {
  reviewId: string;
  hidden: boolean;
  /** For the accessible name, so a row of identical buttons is not ambiguous. */
  title: string;
}) {
  const [state, action, pending] = useActionState(setReviewHiddenAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (hidden) {
    return (
      <form action={action} className="flex flex-col gap-1.5">
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="hidden" value="false" />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Restoring…" : "Put it back"}
          <span className="sr-only"> — {title}</span>
        </Button>
        {state.status === "error" ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        ) : null}
      </form>
    );
  }

  if (!confirming) {
    return (
      <Button variant="quiet" size="sm" icon={<Icon name="hide" />} onClick={() => setConfirming(true)}>
        Take down
        <span className="sr-only"> — {title}</span>
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="hidden" value="true" />

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Why (for our records only)
        <input
          type="text"
          name="reason"
          maxLength={200}
          className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
          placeholder="Names a person, unkind, off topic…"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "Taking down…" : "Take it down"}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
          Leave it
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
