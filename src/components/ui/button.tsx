import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The one button in the system.
 *
 * Sizing note: `md` is 48px tall and `lg` is 58px — still above the 44px target
 * everyone quotes, because the smallest hands using this application are five
 * years old. They came down from 56 and 68: a button that tall next to 17px
 * text is not generous, it is a slab, and three of them in a row filled a
 * phone screen.
 *
 * `sm` is 40px and is what the desk uses. A librarian is clicking with a mouse.
 */

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-white shadow-lift hover:bg-primary-deep active:translate-y-px",
  // The berry accent now passes AA under white (6.48:1), so this *could* be a
  // solid fill. It stays outlined on purpose: two solid brand colours side by
  // side give a child no clue which button is the main one, and half of these
  // sit in admin forms where a loud pink submit would be wrong.
  secondary:
    "bg-surface text-accent-ink border-2 border-accent hover:bg-accent-wash active:translate-y-px",
  quiet:
    "bg-transparent text-ink-soft border border-control-border hover:bg-surface-sunk hover:text-ink",
  danger: "bg-danger text-white shadow-lift hover:brightness-110 active:translate-y-px",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "min-h-10 px-3.5 text-sm gap-1.5",
  md: "min-h-12 px-5 text-base gap-2",
  lg: "min-h-[3.625rem] px-7 text-lg gap-2.5",
};

/*
 * The body face, not the display serif, and no longer a pill.
 *
 * Both were deliberate reversals: a rounded display face on every control plus
 * a 999px radius is the shape language of a game, and this is a library.
 */
const BASE_CLASSES =
  "inline-flex items-center justify-center rounded-[var(--radius-button)] font-semibold " +
  "transition-[background-color,transform,filter] duration-150 " +
  "disabled:opacity-55 disabled:pointer-events-none " +
  "no-underline text-center";

/**
 * The same classes, for the rare control that cannot be `Button` or
 * `ButtonLink`.
 *
 * There is one: a link that leaves the site and therefore needs `target` and
 * `rel`, which `next/link` here is not given props for. Handing that link its
 * own hand-copied class string is how a design system quietly grows a second
 * button, so it borrows this instead and the two cannot drift.
 */
export function buttonClasses(
  variant: Variant = "primary",
  size: Size = "md",
  className?: string,
): string {
  return cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className);
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  /** Decorative only — always pair with a text label, never an icon alone. */
  icon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
}

type ButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, "children" | "className">;

export function Button({
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        BASE_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="text-[1.2em] leading-none">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

type ButtonLinkProps = CommonProps & { href: string };

export function ButtonLink({
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  children,
  className,
  href,
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        BASE_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-[1.2em] leading-none">
          {icon}
        </span>
      ) : null}
      {children}
    </Link>
  );
}
