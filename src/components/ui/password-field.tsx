"use client";

import { useId, useState } from "react";

import { Field, TextInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * Password entry for children.
 *
 * Three decisions worth stating:
 *
 * 1. Show/hide is on by default-visible-off but always available. A child
 *    typing an eight-character word they invented two seconds ago needs to be
 *    able to see it. Hiding it by default protects the shared-room case.
 *
 * 2. The strength hint counts *length*, because that is the rule we actually
 *    apply. Showing a bar that rewards symbols would be teaching a rule the
 *    system does not have.
 *
 * 3. It suggests joining words together. That is the single most useful piece
 *    of password advice for this age group, and far better than "use a symbol".
 */
export function PasswordField({
  name,
  label,
  hint,
  error,
  minLength,
  autoComplete = "new-password",
  showStrength = false,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  minLength: number;
  autoComplete?: string;
  showStrength?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  const remaining = Math.max(0, minLength - value.length);
  const strong = value.length >= minLength + 4;

  return (
    <Field id={id} label={label} hint={hint} error={error} required>
      <div className="flex gap-2">
        <TextInput
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={minLength}
          required
          invalid={Boolean(error)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          className="min-h-12 shrink-0 rounded-[var(--radius-field)] border border-control-border px-4 text-base font-semibold text-ink-soft hover:bg-surface-sunk hover:text-ink"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {showStrength ? (
        <p
          aria-live="polite"
          className={cn(
            "text-base",
            value.length === 0
              ? "text-ink-soft"
              : remaining > 0
                ? "text-warn"
                : strong
                  ? "text-success"
                  : "text-ink-soft",
          )}
        >
          {value.length === 0
            ? `At least ${minLength} letters. Two words joined together works nicely — like “bluecatjumps”.`
            : remaining > 0
              ? `${remaining} more ${remaining === 1 ? "letter" : "letters"} to go…`
              : strong
                ? "That is a good long one! 🎉"
                : "That works. A little longer would be even better."}
        </p>
      ) : null}
    </Field>
  );
}
