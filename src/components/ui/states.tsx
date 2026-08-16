import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Empty, loading and error states.
 *
 * An empty shelf is an invitation, not a dead end, so every empty state offers
 * somewhere to go. Error copy never shows a status code to a child — the
 * technical detail goes to the server log, and the reader gets a sentence they
 * can act on.
 */

export function EmptyState({
  illustration = "📚",
  title,
  children,
  action,
}: {
  illustration?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] bg-surface-sunk px-6 py-14 text-center">
      <span aria-hidden="true" className="text-6xl">
        {illustration}
      </span>
      <h3 className="mt-5 text-2xl">{title}</h3>
      {children ? <p className="mt-2 max-w-md text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-7">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Finding things…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-4 px-6 py-14 text-center"
    >
      <span aria-hidden="true" className="flex gap-2">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-3.5 w-3.5 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${index * 120}ms` }}
          />
        ))}
      </span>
      <span className="text-ink-soft">{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "Oops! Something went wrong.",
  children = "Please ask your librarian for help.",
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-[var(--radius-card)] bg-danger-wash px-6 py-14 text-center"
    >
      <span aria-hidden="true" className="text-6xl">
        🐛
      </span>
      <h3 className="mt-5 text-2xl">{title}</h3>
      <p className="mt-2 max-w-md text-ink-soft">{children}</p>
      {action ? <div className="mt-7">{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "success";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const toneClasses = {
    info: "bg-primary-wash text-ink",
    warn: "bg-warn-wash text-ink",
    success: "bg-success-wash text-ink",
  } as const;

  return (
    <div className={cn("rounded-[var(--radius-field)] px-5 py-4", toneClasses[tone], className)}>
      {title ? <p className="font-display text-lg font-bold">{title}</p> : null}
      <div className={cn(title && "mt-1", "text-ink-soft")}>{children}</div>
    </div>
  );
}
