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

/*
 * Every lifted card carries the hairline now. A shadow with no edge reads as a
 * blur on the warm ground; the one-pixel line under it is what makes the card
 * an object. See the elevation ladder in globals.css.
 */
const TONE_CLASSES: Record<Tone, string> = {
  plain: "bg-surface shadow-card",
  shelf: "bg-surface shadow-card border-l-4 border-l-accent",
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
    <Component className={cn("rounded-[var(--radius-card)] p-5 sm:p-6", TONE_CLASSES[tone], className)}>
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
    <Heading className="flex items-center gap-2.5 text-xl">
      {icon ? (
        <span aria-hidden="true" className="text-2xl leading-none text-primary-deep">
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
