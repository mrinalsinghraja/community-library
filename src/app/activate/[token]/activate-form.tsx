"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { activateAccountAction, type ActionState } from "@/server/actions/account-actions";
import { Icon } from "@/components/ui/icon";

const INITIAL: ActionState = { status: "idle" };

export function ActivateForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, formAction, pending] = useActionState(activateAccountAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {/* The token travels in a hidden field on submit rather than being read
          from the URL again, so the value posted is the one we validated. */}
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
        label="Choose a password"
        error={state.fieldErrors?.password}
        minLength={minLength}
        showStrength
      />

      <PasswordField
        name="confirmPassword"
        label="Type it once more"
        hint="Just to be sure you can remember it."
        error={state.fieldErrors?.confirmPassword}
        minLength={minLength}
      />

      <Button type="submit" size="lg" fullWidth disabled={pending} icon={<Icon name="key" />}>
        {pending ? "Setting it up…" : "That's my password"}
      </Button>
    </form>
  );
}
