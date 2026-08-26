"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { APARTMENT_HINT } from "@/lib/apartment";
import { NOT_CHANGEABLE } from "@/lib/profile-changes";
import { updateMemberDetailsAction, type ProfileFormState } from "@/server/actions/profile-actions";

/**
 * A librarian correcting what is on a reader's record.
 *
 * Guarded by `member.edit`, which Librarian and Super Admin both hold: fixing a
 * misspelt name should not need the owner. Approving what a *child* proposed is
 * the different, Super-Admin-only act — that queue is at /desk/changes.
 *
 * Birth year is editable here and nowhere else. It decides whether a reader is
 * still the right age for the library, so it is the one field a reader must not
 * be able to propose for themselves; the note under it says so, because an
 * administrator who does not know that will wonder why it is missing from the
 * reader's own form.
 */

const initialState: ProfileFormState = { status: "idle" };

export function EditDetails({
  memberId,
  displayName,
  apartment,
  birthYear,
}: {
  memberId: string;
  displayName: string;
  apartment: string;
  birthYear: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateMemberDetailsAction, initialState);
  const [open, setOpen] = useState(false);
  const errors = state.fieldErrors ?? {};

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="secondary" size="sm" icon={<Icon name="save" />} onClick={() => setOpen(true)}>
          Correct these details
        </Button>
        {state.status === "success" ? (
          <p role="status" className="text-base font-semibold text-primary-deep">
            {state.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-5">
      <input type="hidden" name="memberUserId" value={memberId} />

      <Field id="displayName" label="Name" error={errors.displayName}>
        <TextInput
          id="displayName"
          name="displayName"
          maxLength={80}
          defaultValue={displayName}
          invalid={Boolean(errors.displayName)}
        />
      </Field>

      <Field id="apartment" label="Flat" hint={APARTMENT_HINT} error={errors.apartment}>
        <TextInput
          id="apartment"
          name="apartment"
          maxLength={20}
          defaultValue={apartment}
          invalid={Boolean(errors.apartment)}
        />
      </Field>

      <Field
        id="birthYear"
        label="Year they were born"
        hint={NOT_CHANGEABLE.birthYear}
        error={errors.birthYear}
      >
        <TextInput
          id="birthYear"
          name="birthYear"
          inputMode="numeric"
          defaultValue={birthYear ?? ""}
          invalid={Boolean(errors.birthYear)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending} icon={<Icon name="save" />}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

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
    </form>
  );
}
