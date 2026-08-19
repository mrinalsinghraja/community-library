"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { requestPasswordResetAction, type ActionState } from "@/server/actions/account-actions";
import { Icon } from "@/components/ui/icon";
import { IconMedallion } from "@/components/ui/states";

const INITIAL: ActionState = { status: "idle" };

/**
 * The forgotten-password form.
 *
 * The response is identical whether the account exists, is suspended, or was
 * never real. Anything else would turn this box into a way of asking "is
 * MJCL-R0042 a real child at this address?".
 */
export function ForgotForm({ cardExample }: { cardExample?: string }) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL);

  if (state.status === "success") {
    return (
      <div role="status" className="text-center">
        <IconMedallion name="mail" />
        <h2 className="mt-4 text-2xl">Check with a grown-up</h2>
        <p className="mt-3 text-ink-soft">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <Field
        id="identifier"
        label="Your library card or name"
        hint={cardExample ? `Like ${cardExample}, or the name you chose.` : undefined}
        required
      >
        <TextInput
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={pending} icon={<Icon name="mail" />}>
        {pending ? "Sending…" : "Send the link"}
      </Button>
    </form>
  );
}
