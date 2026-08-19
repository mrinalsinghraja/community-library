"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { removeBookCoverAction, type BookFormState } from "@/server/actions/catalogue-actions";
import { Icon } from "@/components/ui/icon";

/**
 * Remove cover.
 *
 * Lives beside the cover thumbnail rather than inside the Add/Edit form, and
 * that placement is load-bearing rather than cosmetic: a `<form>` cannot be
 * nested inside another `<form>`. React renders both without complaint on the
 * server and then fails to hydrate the whole page in the browser — which is
 * exactly how this arrived, and only the browser console said so.
 *
 * The thumbnail is also the right place for it. The control that takes the
 * picture away belongs next to the picture, not eight fields down.
 */

const initialState: BookFormState = { status: "idle" };

export function RemoveCoverButton({ copyId }: { copyId: string }) {
  const [state, formAction] = useActionState(removeBookCoverAction, initialState);

  if (state.status === "success") {
    return <p className="mt-3 text-base text-success">{state.message}</p>;
  }

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="copyId" value={copyId} />
      <Button type="submit" variant="quiet" size="sm" icon={<Icon name="trash" />} fullWidth>
        Remove cover
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
