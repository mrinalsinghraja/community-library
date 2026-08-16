import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The container everything else sits in.
 *
 * `tone="shelf"` adds the accent spine along the left edge — the motif that ties
 * the whole interface back to a physical bookshelf. Used sparingly: if every
 * card has a spine, none of them mean anything.
 */

type Tone = "plain" | "shelf" | "sunk" | "primary";

const TONE_CLASSES: Record<Tone, string> = {
  plain: "bg-surface shadow-lift",
  shelf: "bg-surface shadow-lift border-l-8 border-l-accent",
  sunk: "bg-surface-sunk",
  primary: "bg-primary-wash",
};

export function Card({
  tone = "plain",
  children,
  className,
  as: Component = "div",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Component className={cn("rounded-[var(--radius-card)] p-6 sm:p-8", TONE_CLASSES[tone], className)}>
      {children}
    </Component>
  );
}

export function CardTitle({
  children,
  icon,
  as: Heading = "h2",
}: {
  children: ReactNode;
  icon?: ReactNode;
  as?: "h2" | "h3" | "h4";
}) {
  return (
    <Heading className="flex items-center gap-3 text-2xl">
      {icon ? (
        <span aria-hidden="true" className="text-3xl leading-none">
          {icon}
        </span>
      ) : null}
      {children}
    </Heading>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-3 text-ink-soft", className)}>{children}</div>;
}
