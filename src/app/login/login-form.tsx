"use client";

import { useActionState, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import type { Audience } from "@/lib/sign-in";
import { signInAction, type SignInState } from "@/server/actions/auth-actions";

const INITIAL_STATE: SignInState = {};

/**
 * The sign-in form.
 *
 * One field accepts either identity: a library card code for a reader, an
 * email address for somebody who works here. The two used to share one label
 * with a footnote for librarians, which was right for the server and wrong for
 * the person: a parent typing a card number and an administrator typing an
 * address were being asked the same question in the same words, and each had
 * to read past the other's half.
 *
 * So the form asks first. The switch is two radio buttons drawn as a
 * segmented control, and choosing one rewrites the label, the hint and the
 * keyboard the phone offers. It does not change what is sent: `identifier` and
 * `password` reach `signInAction` exactly as before, and the server still
 * works out which kind of name it was given. Nothing about who may sign in, or
 * how, moved by so much as a character.
 *
 * Librarians and administrators are one audience here — "library staff" —
 * because they sign in the same way and the form has no business telling a
 * stranger that two kinds of staff exist.
 */
export function LoginForm({
  next,
  cardExample,
  defaultAudience = "reader",
}: {
  next?: string;
  cardExample?: string;
  /** Pre-selected from where the person was headed — the desk means staff. */
  defaultAudience?: Audience;
}) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);
  const [audience, setAudience] = useState<Audience>(defaultAudience);
  const switchId = useId();

  const reader = audience === "reader";

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {/*
        The switch. Native radios inside labels, so arrow keys move between
        them and a screen reader hears "I am a reader, radio button, 1 of 2".
        The stylesheet draws the selected one as the lifted segment.
      */}
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Who is signing in</legend>
        <div className="segment" role="presentation">
          <label htmlFor={`${switchId}-reader`}>
            <input
              id={`${switchId}-reader`}
              type="radio"
              name="audience"
              value="reader"
              checked={reader}
              onChange={() => setAudience("reader")}
            />
            <span className="inline-flex items-center gap-2">
              <Icon name="reader" className="text-[1.15em]" />I am a reader
            </span>
          </label>
          <label htmlFor={`${switchId}-staff`}>
            <input
              id={`${switchId}-staff`}
              type="radio"
              name="audience"
              value="staff"
              checked={!reader}
              onChange={() => setAudience("staff")}
            />
            <span className="inline-flex items-center gap-2">
              <Icon name="staff" className="text-[1.15em]" />I work at the library
            </span>
          </label>
        </div>
      </fieldset>

      <p className="text-base text-ink-soft" aria-live="polite">
        {reader
          ? "Sign in to see your books, your card, and what to read next."
          : "Sign in to open the library desk. Librarians and administrators both come in this way."}
      </p>

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-[var(--radius-field)] border border-danger/30 bg-danger-wash px-5 py-4 text-base font-bold text-danger"
        >
          {/* The wording is unchanged and deliberately vague — it must not say
              which half was wrong. Only the presentation is friendlier. */}
          <Icon name="info" className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </p>
      ) : null}

      {/*
        One box, two names. The `key` remounts the input when the audience
        changes so a card number half-typed under the wrong label is not
        quietly submitted as an email address — and so the phone's keyboard
        follows the `type`.
      */}
      <Field
        id="identifier"
        label={reader ? "Your library card number" : "Your email address"}
        hint={
          reader
            ? cardExample
              ? `It is printed on your card, like ${cardExample}.`
              : "It is printed on your card."
            : "Use your email address — the one the library's invitation went to."
        }
        required
      >
        <TextInput
          key={audience}
          id="identifier"
          name="identifier"
          type={reader ? "text" : "email"}
          inputMode={reader ? "text" : "email"}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          invalid={Boolean(state.error)}
          describedBy="identifier-hint"
        />
      </Field>

      <Field id="password" label="Your password" required>
        {/*
          Show/hide lives inside the box. A separate button beside the field
          made the password line a different width from the one above it, which
          is the kind of thing a person notices without knowing why.
        */}
        <div className="relative">
          <TextInput
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            invalid={Boolean(state.error)}
            className="pe-20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-pressed={showPassword}
            className="absolute end-1.5 top-1/2 inline-flex min-h-9 -translate-y-1/2 items-center rounded-[calc(var(--radius-field)-0.15rem)] px-3 text-sm font-semibold text-ink-soft hover:bg-surface-sunk hover:text-ink"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={pending} icon={<Icon name="key" />}>
        {pending ? "Just a moment…" : "Sign in"}
      </Button>
    </form>
  );
}
