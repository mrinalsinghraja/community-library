import Link from "next/link";
import type { ReactNode } from "react";

import { LibraryLogo } from "@/components/library/library-logo";
import { cn } from "@/lib/cn";
import type { PermissionKey } from "@/lib/permissions";
import type { Actor } from "@/server/authz";
import type { Branding } from "@/server/lib/settings";
import { signOutAction } from "@/server/actions/auth-actions";

/**
 * The shell for desk and admin screens.
 *
 * Deliberately a different world from the reader app: denser, quieter, plain
 * white, information-first. Librarians are working, often with a queue of
 * children in front of them, and the children's visual language would slow them
 * down.
 *
 * Navigation is built from the actor's actual permissions — but that is a
 * convenience, not a control. Every page behind these links independently calls
 * requirePermission().
 */

interface NavItem {
  href: string;
  label: string;
  permission: PermissionKey;
  badge?: number;
}

export function StaffShell({
  branding,
  actor,
  pendingRegistrations,
  title,
  children,
}: {
  branding: Branding;
  actor: Actor;
  pendingRegistrations?: number;
  title: string;
  children: ReactNode;
}) {
  const navItems: NavItem[] = [
    {
      href: "/desk/registrations",
      label: "New members",
      permission: "registration.view",
      badge: pendingRegistrations,
    },
    { href: "/desk/members", label: "Readers", permission: "member.view" },
    { href: "/admin/staff", label: "Staff", permission: "user.manage_staff" },
  ];

  const visible = navItems.filter((item) => actor.permissions.has(item.permission));

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b-2 border-hairline bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3 sm:px-8">
          <Link href="/desk" className="flex items-center gap-3 no-underline">
            <LibraryLogo
              logoUrl={branding.logoUrl}
              libraryName={branding.libraryName}
              size={36}
            />
            <span className="font-display text-lg font-extrabold text-ink">Library desk</span>
          </Link>

          <nav aria-label="Desk" className="flex flex-wrap items-center gap-1">
            {visible.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-base font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
              >
                {item.label}
                {item.badge ? (
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-accent-ink px-1.5 py-0.5 text-sm font-bold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-3">
            <span className="text-base text-ink-soft">{actor.displayName}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-lg border-2 border-control-border px-3 py-2 text-base font-bold text-ink-soft hover:bg-surface-sunk hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <h1 className="text-3xl">{title}</h1>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

/** A compact table for staff screens. Readable, not pretty. */
export function DataTable({
  headers,
  children,
  className,
}: {
  headers: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border-2 border-hairline", className)}>
      <table className="w-full min-w-[46rem] border-collapse text-base">
        <thead>
          <tr className="bg-surface-sunk text-left">
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-3 font-display font-bold text-ink">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
