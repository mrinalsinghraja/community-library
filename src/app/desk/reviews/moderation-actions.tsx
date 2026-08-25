"use client";

import { useActionState, useState } from "react";
import type { ReviewStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  decideReviewAction,
  deleteReviewAction,
  type ReviewFormState,
} from "@/server/actions/review-actions";

/**
 * The desk's answer to one review.
 *
 * Three controls, and their asymmetry is the design:
 *
 *   * **Publish** is one press. Saying yes to a child's writing should not be
 *     the slow path.
 *   * **Send it back** asks for a note first, because the note is what the
 *     author reads and rewrites from. A refusal with no words is a machine.
 *   * **Delete forever** appears only for the Super Admin, only on something
 *     already published, needs a typed reason and a second press, and says out
 *     loud that it cannot be undone.
 *
 * None of that is the security boundary. `review.moderate` and `review.delete`
 * are enforced inside the services, so a librarian who forged this form still
 * cannot delete anything.
 */

const initialState: ReviewFormState = { status: "idle" };

export function ModerationActions({
  reviewId,
  status,
  title,
  canDelete,
}: {
  reviewId: string;
  status: ReviewStatus;
  /** For the accessible name, so a column of identical buttons is not ambiguous. */
  title: string;
  /** True only for the Super Admin. The service checks it again. */
  canDelete: boolean;
}) {
  const [decision, decideAction, deciding] = useActionState(decideReviewAction, initialState);
  const [removal, removeAction, removing] = useActionState(deleteReviewAction, initialState);
  const [declining, setDeclining] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const error = decision.status === "error" ? decision.message : removal.status === "error" ? removal.message : null;

  return (
    <div className="flex flex-col gap-2">
      {status === "PENDING" && !declining ? (
        <>
          <form action={decideAction}>
            <input type="hidden" name="reviewId" value={reviewId} />
            <input type="hidden" name="approve" value="true" />
            <Button type="submit" size="sm" icon={<Icon name="check" />} disabled={deciding}>
              {deciding ? "Publishing…" : "Publish"}
              <span className="sr-only"> — {title}</span>
            </Button>
          </form>

          <Button variant="quiet" size="sm" onClick={() => setDeclining(true)}>
            Send it back
          </Button>
        </>
      ) : null}

      {status === "PENDING" && declining ? (
        <form action={decideAction} className="flex flex-col gap-2">
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="approve" value="false" />

          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            {/*
              Not "reason" — this is addressed to a child, and it is the only
              thing they will see. Naming the field after its reader is how the
              librarian remembers who is going to read it.
            */}
            What should they change?
            <input
              type="text"
              name="note"
              maxLength={200}
              className="min-h-10 w-56 rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
              placeholder="Please write about the book, not your friend…"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={deciding}>
              {deciding ? "Sending…" : "Send it back"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {/*
        Published reviews carry no publish/decline control at all. Publication is
        permanent, and a "decline" button on something already on the shelf would
        be un-publishing under another name — the service refuses it too.
      */}
      {status === "PUBLISHED" && canDelete && !deleting ? (
        <Button variant="quiet" size="sm" icon={<Icon name="trash" />} onClick={() => setDeleting(true)}>
          Delete forever
          <span className="sr-only"> — {title}</span>
        </Button>
      ) : null}

      {status === "PUBLISHED" && canDelete && deleting ? (
        <form action={removeAction} className="flex w-56 flex-col gap-2">
          <input type="hidden" name="reviewId" value={reviewId} />

          <p className="text-sm font-semibold text-danger">
            This deletes the review permanently. It cannot be undone.
          </p>

          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            Why (required, kept in the audit log)
            <input
              type="text"
              name="reason"
              required
              maxLength={200}
              className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={removing}>
              {removing ? "Deleting…" : "Delete forever"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setDeleting(false)}>
              Keep it
            </Button>
          </div>
        </form>
      ) : null}

      {status === "REJECTED" ? (
        <p className="text-sm text-ink-soft">
          Sent back. The reader can rewrite it, and it will come here again.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
