"use client";

import { useActionState, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import {
  removeMemberPhotoAction,
  replaceMemberPhotoAction,
  type MediaActionState,
} from "@/server/actions/media-actions";

const INITIAL: MediaActionState = { status: "idle" };

/**
 * Photo controls for one reader.
 *
 * Deliberately quiet: these are not everyday actions, and a librarian browsing
 * the member list has no reason to be invited to handle children's photographs.
 * Removal asks for a reason, like every other action that changes a child's
 * record — it goes to the audit log, not to the family.
 */
export function PhotoActions({
  memberId,
  hasPhoto,
}: {
  memberId: string;
  hasPhoto: boolean;
}) {
  const [replaceState, replace, replacing] = useActionState(replaceMemberPhotoAction, INITIAL);
  const [removeState, remove, removing] = useActionState(removeMemberPhotoAction, INITIAL);
  const [showRemove, setShowRemove] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const state = replaceState.status !== "idle" ? replaceState : removeState;

  return (
    <div className="flex flex-col gap-2">
      {state.message ? (
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

      {showRemove ? (
        <form action={remove} className="flex flex-col gap-2">
          <input type="hidden" name="memberId" value={memberId} />
          <label htmlFor={`photo-reason-${memberId}`} className="text-base font-bold text-ink">
            Why? (our records only)
          </label>
          <TextInput id={`photo-reason-${memberId}`} name="reason" required minLength={3} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={removing}>
              {removing ? "Removing…" : "Remove photo"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setShowRemove(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <form ref={formRef} action={replace} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="memberId" value={memberId} />
          <input
            ref={fileRef}
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            // Submits as soon as a file is chosen: a second "now upload it"
            // button is a step nobody remembers to press.
            onChange={() => formRef.current?.requestSubmit()}
          />
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={replacing}
            onClick={() => fileRef.current?.click()}
          >
            {replacing ? "Saving…" : hasPhoto ? "Replace photo" : "Add photo"}
          </Button>

          {hasPhoto ? (
            <Button variant="quiet" size="sm" onClick={() => setShowRemove(true)}>
              Remove photo
            </Button>
          ) : null}
        </form>
      )}
    </div>
  );
}
