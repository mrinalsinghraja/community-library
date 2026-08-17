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

type SelectProps = ComponentPropsWithoutRef<"select"> & {
  invalid?: boolean;
  describedBy?: string;
};

/**
 * A real `<select>`, not a div pretending to be one.
 *
 * The native control gets the platform's own picker — a full-height wheel on a
 * phone, keyboard type-ahead on a desktop, and screen-reader support nobody has
 * to reimplement. A custom listbox would look tidier in a screenshot and be
 * worse for a seven-year-old on a tablet.
 *
 * `appearance-none` plus a drawn chevron, because the default arrow is tiny and
 * the field has to read as tappable at 56px.
 */
export function Select({ invalid, describedBy, className, children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-14 w-full appearance-none rounded-[var(--radius-field)] border-2 bg-surface",
          "ps-4 pe-12 text-lg text-ink",
          invalid ? "border-danger" : "border-control-border",
          className,
        )}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-ink-soft"
      >
        ▾
      </span>
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
