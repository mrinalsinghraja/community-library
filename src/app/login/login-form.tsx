"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { signInAction, type SignInState } from "@/server/actions/auth-actions";
import { Icon } from "@/components/ui/icon";

const INITIAL_STATE: SignInState = {};

/**
 * The sign-in form.
 *
 * One field accepts either identity: a library card code or the username a
 * grown-up chose. Staff type their email address into the same box. Children
 * should never have to work out *which kind* of name they have.
 *
 * The worked example in the hint is built from the library's configured card
 * prefix, so it is correct for whichever community is running this.
 */
export function LoginForm({ next, cardExample }: { next?: string; cardExample?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-[var(--radius-field)] bg-danger-wash px-5 py-4 text-lg font-bold text-danger"
        >
          {/* The wording is unchanged and deliberately vague — it must not say
              which half was wrong. Only the presentation is friendlier. */}
          <Icon name="info" className="mt-1 shrink-0" />
          <span>{state.error}</span>
        </p>
      ) : null}

      <Field
        id="identifier"
        label="Your library card or name"
        hint={
          cardExample
            ? `Like ${cardExample}, or the name you chose.`
            : "Your library card number, or the name you chose."
        }
        required
      >
        <TextInput
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          invalid={Boolean(state.error)}
          describedBy="identifier-hint"
        />
      </Field>

      <Field id="password" label="Your secret word" required>
        <div className="flex gap-2">
          <TextInput
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            invalid={Boolean(state.error)}
          />
          <Button
            variant="quiet"
            size="md"
            onClick={() => setShowPassword((value) => !value)}
            aria-pressed={showPassword}
            className="shrink-0"
          >
            {showPassword ? "Hide" : "Show"}
          </Button>
        </div>
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={pending} icon={<Icon name="key" />}>
        {pending ? "Just a moment…" : "Sign in"}
      </Button>
    </form>
  );
}
