import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Accessible form field.
 *
 * Every input gets a real <label> (never a placeholder standing in for one), and
 * errors are wired with aria-describedby + aria-invalid so a screen reader
 * announces the problem rather than leaving a red box no one can hear.
 */

export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-display text-lg font-bold text-ink">
        {label}
        {required ? (
          <>
            {" "}
            <span className="text-accent-ink" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </label>

      {hint ? (
        <p id={hintId} className="text-base text-ink-soft">
          {hint}
        </p>
      ) : null}

      {children}

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-2 text-base font-bold text-danger">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TextInputProps = ComponentPropsWithoutRef<"input"> & {
  invalid?: boolean;
  describedBy?: string;
};

export function TextInput({ invalid, describedBy, className, ...rest }: TextInputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        "min-h-14 w-full rounded-[var(--radius-field)] border-2 bg-surface px-4 text-lg",
        "placeholder:text-ink-faint",
        invalid ? "border-danger" : "border-control-border",
        className,
      )}
    />
  );
}
