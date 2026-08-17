"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { changePasswordAction, type ActionState } from "@/server/actions/account-actions";

const INITIAL: ActionState = { status: "idle" };

export function ChangePasswordForm({
  minLength,
  isStaff,
}: {
  minLength: number;
  isStaff: boolean;
}) {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);
  const noun = isStaff ? "password" : "secret word";

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.status === "error" && state.message && !state.fieldErrors ? (
        <p
          role="alert"
          className="rounded-[var(--radius-field)] bg-danger-wash px-5 py-4 text-lg font-bold text-danger"
        >
          {state.message}
        </p>
      ) : null}

      {/* Requiring the current one is what stops a borrowed unlocked device
          from becoming a permanent account takeover. */}
      <PasswordField
        name="currentPassword"
        label={`Your current ${noun}`}
        error={state.fieldErrors?.currentPassword}
        minLength={1}
        autoComplete="current-password"
      />

      <PasswordField
        name="newPassword"
        label={`Your new ${noun}`}
        error={state.fieldErrors?.newPassword}
        minLength={minLength}
        showStrength={!isStaff}
      />

      <PasswordField
        name="confirmPassword"
        label="Type the new one again"
        error={state.fieldErrors?.confirmPassword}
        minLength={minLength}
      />

      <Button type="submit" size="lg" fullWidth disabled={pending} icon="🔑">
        {pending ? "Saving…" : `Save my new ${noun}`}
      </Button>
    </form>
  );
}
