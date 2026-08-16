import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The one button in the system.
 *
 * Sizing note: `md` is 56px tall and `lg` is 68px. That is larger than a typical
 * web button on purpose — the smallest hands using this application are five
 * years old, and 44px targets are sized for adult thumbs.
 */

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary text-white shadow-lift hover:bg-primary-deep active:translate-y-px",
  // Accent is a shape colour and fails contrast under white text, so the
  // secondary button is an outlined treatment with text-safe accent ink.
  secondary:
    "bg-surface text-accent-ink border-2 border-accent hover:bg-accent-wash active:translate-y-px",
  quiet:
    "bg-transparent text-ink-soft border-2 border-control-border hover:bg-surface-sunk hover:text-ink",
  danger: "bg-danger text-white shadow-lift hover:brightness-110 active:translate-y-px",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "min-h-11 px-4 text-base gap-2",
  md: "min-h-14 px-6 text-lg gap-2.5",
  lg: "min-h-17 px-8 text-xl gap-3",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center rounded-full font-bold font-display " +
  "transition-[background-color,transform,filter] duration-150 " +
  "disabled:opacity-55 disabled:pointer-events-none " +
  "no-underline text-center";

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
