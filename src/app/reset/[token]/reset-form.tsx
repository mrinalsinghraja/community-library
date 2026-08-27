"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { completePasswordResetAction, type ActionState } from "@/server/actions/account-actions";
import { Icon } from "@/components/ui/icon";

const INITIAL: ActionState = { status: "idle" };

export function ResetForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, formAction, pending] = useActionState(completePasswordResetAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="token" value={token} />

      {state.status === "error" && (state.message || state.fieldErrors?.token) ? (
        <p
          role="alert"
          className="rounded-[var(--radius-field)] bg-danger-wash px-5 py-4 text-lg font-bold text-danger"
        >
          {state.fieldErrors?.token ?? state.message}
        </p>
      ) : null}

      <PasswordField
        name="password"
        label="Your new password"
        error={state.fieldErrors?.password}
        minLength={minLength}
        showStrength
      />

      <PasswordField
        name="confirmPassword"
        label="Type it once more"
        error={state.fieldErrors?.confirmPassword}
        minLength={minLength}
      />

      <Button type="submit" size="lg" fullWidth disabled={pending} icon={<Icon name="key" />}>
        {pending ? "Saving…" : "Save my new password"}
      </Button>
    </form>
  );
}
