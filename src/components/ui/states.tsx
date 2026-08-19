import type { ReactNode } from "react";

import { Butterfly, LeafSprig } from "@/components/library/library-logo";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * Empty, loading and error states.
 *
 * An empty shelf is an invitation, not a dead end, so every empty state offers
 * somewhere to go. Error copy never shows a status code to a child — the
 * technical detail goes to the server log, and the reader gets a sentence they
 * can act on.
 *
 * The illustration is a small garden scene rather than a lone emoji: a berry
 * disc with the page's own symbol on it, a butterfly and a sprig. Callers keep
 * passing whatever symbol suits the page, so all eighteen existing empty states
 * inherited the drawing without being edited.
 */

export function EmptyState({
  illustration = <Icon name="book" />,
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
    <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-surface-sunk px-6 py-14 text-center">
      {/* the garden, kept faint so the words stay the loudest thing here */}
      <LeafSprig className="pointer-events-none absolute -left-2 bottom-0 w-16 opacity-25" />
      <LeafSprig className="pointer-events-none absolute -right-3 bottom-2 w-12 opacity-20" />

      <div className="relative flex flex-col items-center">
        <span className="relative inline-flex h-24 w-24 items-center justify-center rounded-full bg-accent-wash">
          {/*
            Sized in `em`, so a drawn glyph from the icon family and a symbol a
            librarian chose as data both come out the same size here.
          */}
          <span aria-hidden="true" className="text-5xl text-accent-ink">
            {illustration}
          </span>
          <Butterfly className="drift absolute -right-1 -top-1 w-9" />
        </span>
        <h3 className="mt-6 text-2xl">{title}</h3>
        {children ? <p className="mt-2 max-w-md text-ink-soft">{children}</p> : null}
        {action ? <div className="mt-7">{action}</div> : null}
      </div>
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
      <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-surface text-4xl text-danger">
        <Icon name="info" />
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

/**
 * One drawn glyph on a soft disc.
 *
 * The success panels on the joining, sign-in-help and email-confirmation
 * screens each used to open with a different large emoji — a party popper, a
 * postbox, a tick — in three different sizes, drawn by three different vendors
 * depending on the device. This is the same moment on all of them, in the
 * library's own hand.
 */
export function IconMedallion({
  name,
  tone = "primary",
}: {
  name: React.ComponentProps<typeof Icon>["name"];
  tone?: "primary" | "accent";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-20 w-20 items-center justify-center rounded-full text-4xl",
        tone === "accent" ? "bg-accent-wash text-accent-ink" : "bg-primary-wash text-primary-deep",
      )}
    >
      <Icon name={name} />
    </span>
  );
}
