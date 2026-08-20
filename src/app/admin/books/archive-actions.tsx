"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { CATALOGUE_LIMITS } from "@/lib/catalogue";
import {
  archiveBookAction,
  deleteBookAction,
  restoreBookAction,
  type BookFormState,
} from "@/server/actions/catalogue-actions";
import { Icon } from "@/components/ui/icon";

/**
 * Taking a book off the shelf, putting it back, and — for one person only —
 * removing a row that should never have been written.
 *
 * **Archive is the normal answer, and it is the one a librarian gets.** It
 * keeps the record, the code and, the part that matters, the donation: somebody
 * in this community gave that book, and a mis-tap must not erase that.
 *
 * Delete appears only for the Super Admin, and the service behind it refuses
 * any copy with a history — borrowed once, asked for once, given by anybody. It
 * is for the duplicate somebody typed in twice, which is not history at all but
 * a row that was never true. Archiving that would leave a permanent record of a
 * book the library never had.
 *
 * Both ask for a reason, like every other action that changes a shared record.
 * It goes to the audit log, not to the donor.
 */

const initialState: BookFormState = { status: "idle" };

export function ArchiveActions({
  copyId,
  copyCode,
  archived,
  canArchive,
  canDelete = false,
}: {
  copyId: string;
  copyCode: string;
  archived: boolean;
  canArchive: boolean;
  /** Super Admin only. Hiding it is a courtesy; the service is what refuses. */
  canDelete?: boolean;
}) {
  // Hiding these is a courtesy for a role that cannot use them. The permission
  // is checked again inside the service, which is what actually refuses.
  if (!canArchive && !canDelete) return null;

  return (
    /* Side by side. Two stacked buttons made every catalogue row 40px taller
       than the book in it needed. */
    <div className="flex flex-wrap items-start gap-2">
      {canArchive ? (
        archived ? (
          <RestoreButton copyId={copyId} />
        ) : (
          <ArchiveButton copyId={copyId} copyCode={copyCode} />
        )
      ) : null}
      {canDelete ? <DeleteButton copyId={copyId} copyCode={copyCode} /> : null}
    </div>
  );
}

function DeleteButton({ copyId, copyCode }: { copyId: string; copyCode: string }) {
  const [state, formAction] = useActionState(deleteBookAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (state.status === "success") {
    return <p className="text-base text-success">{state.message}</p>;
  }

  if (!confirming) {
    return (
      <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>
        Delete permanently
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="copyId" value={copyId} />
      <p className="text-base text-ink-soft">
        Remove {copyCode} altogether? This cannot be undone. It only works for a book nobody has
        borrowed, asked for or given — anything else must be archived instead.
      </p>
      <TextInput
        name="reason"
        placeholder="Why? (e.g. entered twice by mistake)"
        maxLength={CATALOGUE_LIMITS.archiveReasonMax}
        required
        minLength={3}
        className="min-h-11 text-base"
        aria-label={`Reason for removing ${copyCode}`}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm">
          Delete permanently
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
