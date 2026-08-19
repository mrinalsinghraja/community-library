"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { CATALOGUE_LIMITS } from "@/lib/catalogue";
import {
  archiveBookAction,
  restoreBookAction,
  type BookFormState,
} from "@/server/actions/catalogue-actions";
import { Icon } from "@/components/ui/icon";

/**
 * Taking a book off the shelf, and putting it back.
 *
 * There is no delete button anywhere in this application, and this is the
 * screen where somebody would most expect one. Archiving keeps the record, the
 * code and — the part that matters — the donation: somebody in this community
 * gave that book, and a mis-tap must not be able to erase that.
 *
 * Archiving asks for a reason, like every other action that changes a shared
 * record. It goes to the audit log, not to the donor.
 */

const initialState: BookFormState = { status: "idle" };

export function ArchiveActions({
  copyId,
  copyCode,
  archived,
  canArchive,
}: {
  copyId: string;
  copyCode: string;
  archived: boolean;
  canArchive: boolean;
}) {
  // Hiding these is a courtesy for a role that cannot use them. The permission
  // is checked again inside the service, which is what actually refuses.
  if (!canArchive) return null;

  return archived ? <RestoreButton copyId={copyId} /> : <ArchiveButton copyId={copyId} copyCode={copyCode} />;
}

function ArchiveButton({ copyId, copyCode }: { copyId: string; copyCode: string }) {
  const [state, formAction] = useActionState(archiveBookAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (state.status === "success") {
    return <p className="text-base text-success">{state.message}</p>;
  }

  if (!confirming) {
    return (
      <Button variant="quiet" size="sm" icon={<Icon name="archive" />} onClick={() => setConfirming(true)}>
        Archive
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="copyId" value={copyId} />
      <p className="text-base text-ink-soft">
        Take {copyCode} off the shelf? Its record and its donation are kept.
      </p>
      <TextInput
        name="reason"
        placeholder="Why? (e.g. fell apart)"
        maxLength={CATALOGUE_LIMITS.archiveReasonMax}
        className="min-h-11 text-base"
        aria-label={`Reason for archiving ${copyCode}`}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" icon={<Icon name="archive" />}>
          Archive
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
          Keep it
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

function RestoreButton({ copyId }: { copyId: string }) {
  const [state, formAction] = useActionState(restoreBookAction, initialState);

  if (state.status === "success") {
    return <p className="text-base text-success">{state.message}</p>;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="copyId" value={copyId} />
      <Button type="submit" variant="quiet" size="sm" icon={<Icon name="returnBook" />}>
        Back on the shelf
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="mt-1 text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
