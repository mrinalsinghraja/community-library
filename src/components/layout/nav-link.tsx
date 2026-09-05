"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A door that knows whether you are standing in it.
 *
 * The only client-side thing either shell does. `aria-current="page"` is the
 * whole feature: the stylesheet draws the mark from that attribute, and a
 * screen reader announces it as "current page", so a keyboard user and a
 * sighted one get the same answer to "where am I".
 *
 * The lists themselves never learn the pathname — `desk-nav.ts` takes no
 * argument about where a person is standing, and a test holds it to that. This
 * component reads the URL only to draw one underline.
 */
export function NavLink({
  href,
  exact = false,
  className,
  children,
}: {
  href: string;
  /** Match this path only, not its children. Home is "/" and would otherwise match everything. */
  exact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn("door", className)}
    >
      {children}
    </Link>
  );
}
