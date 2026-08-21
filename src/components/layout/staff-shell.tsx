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
  overdueLoans,
  pendingRenewals,
  pendingBorrowRequests,
  title,
  children,
}: {
  branding: Branding;
  actor: Actor;
  pendingRegistrations?: number;
  /** Counted by the page that wants the badge; omitted elsewhere. */
  overdueLoans?: number;
  pendingRenewals?: number;
  pendingBorrowRequests?: number;
  title: string;
  children: ReactNode;
}) {
  const navItems: NavItem[] = [
    // Circulation first: on an ordinary afternoon it is what the desk is for.
    { href: "/desk/circulation", label: "Issue", permission: "loan.issue" },
    // loan.return, not loan.view — every reader holds loan.view, and this link
    // must only appear for somebody who works the desk.
    { href: "/desk/loans", label: "Books out", permission: "loan.return", badge: overdueLoans },
    // A child has asked for a book and is waiting for it. `loan.issue` is the
    // authority to hand one over, and the same key guards the page — saying yes
    // here runs the desk's own issue, so it is the same power either way.
    {
      href: "/desk/requests",
      label: "Books asked for",
      permission: "loan.issue",
      badge: pendingBorrowRequests,
    },
    // A child asked a question and is waiting. `loan.renew` is the authority to
    // answer it, and the same key guards the page.
    {
      href: "/desk/renewals",
      label: "Asks to keep",
      permission: "loan.renew",
      badge: pendingRenewals,
    },
    {
      href: "/desk/registrations",
      label: "New members",
      permission: "registration.view",
      badge: pendingRegistrations,
    },
    { href: "/desk/members", label: "Readers", permission: "member.view" },
    // book.edit, not book.view: every reader holds book.view, and this link
    // must only appear for somebody who can actually manage the collection.
    { href: "/admin/books", label: "Books", permission: "book.edit" },
    { href: "/admin/staff", label: "Staff", permission: "user.manage_staff" },
    // Administration. Three links, not fifteen: how the library works, what it
    // looks like, and what has been done to it.
    { href: "/admin/settings", label: "Settings", permission: "settings.view" },
    { href: "/admin/branding", label: "Branding", permission: "branding.edit" },
    { href: "/admin/audit", label: "Audit", permission: "audit.view" },
  ];

  const visible = navItems.filter((item) => actor.permissions.has(item.permission));

  return (
    <div className="desk-density flex min-h-screen flex-col bg-surface">
      <header className="bg-surface">
        <div className="mx-auto flex w-full max-w-[104rem] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5 sm:px-7">
          <Link href="/desk" className="flex items-center gap-3 no-underline">
            <LibraryLogo
              logoUrl={branding.logoUrl}
              libraryName={branding.libraryName}
              size={40}
              className="w-8"
            />
            <span className="font-display text-lg font-semibold text-ink">Library desk</span>
          </Link>

          <nav aria-label="Desk" className="flex flex-wrap items-center gap-1">
            {visible.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold whitespace-nowrap text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
              >
                {item.label}
                {item.badge ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-ink px-1.5 py-0.5 text-xs font-bold text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-3">
            {/*
              A librarian's own account was reachable only by typing /account:
              every desk screen renders this shell, and this shell had no door to
              it. Their name is the thing they would click looking for it, so
              their name is the link.
            */}
            <Link
              href="/account"
              className="rounded-md px-2 py-1.5 text-sm font-semibold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
            >
              {actor.displayName}
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border border-control-border px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-surface-sunk hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/*
          The same rule that closes the reader masthead. Thinner here — the desk
          is a working screen and the brand should not shout at somebody who is
          serving a queue — but unmistakably the same product.
        */}
        <div
          aria-hidden="true"
          className="h-0.5 w-full bg-[linear-gradient(to_right,var(--color-leaf),var(--color-primary)_35%,var(--color-accent))]"
        />
      </header>

      {/*
        104rem, not 72rem.

        The desk was capped at the same width as a reading page, which on a
        librarian's laptop left a third of the screen empty while the catalogue
        wrapped "MJCL-B0004" onto two lines and a donor's name onto five. The
        reader app stays narrow because a long line is hard to read; a table is
        not read that way, it is scanned across, and it wants the room.
      */}
      <main id="main" className="mx-auto w-full max-w-[104rem] flex-1 px-5 py-6 sm:px-7">
        <h1 className="garden-rule inline-block text-3xl">{title}</h1>
        <div className="mt-8">{children}</div>
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
    <div
      className={cn(
        "overflow-x-auto rounded-[var(--radius-card)] border border-hairline",
        className,
      )}
    >
      <table className="w-full min-w-[46rem] border-collapse text-base">
        <thead>
          {/*
            Headers are small caps in the body face, not the display serif.
            A column heading is a label, not a title — setting it as one was
            making every table look like eight little headlines in a row.
          */}
          <tr className="border-b border-hairline bg-surface-sunk text-left">
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3.5 py-2.5 text-xs font-bold tracking-[0.06em] whitespace-nowrap text-ink-soft uppercase"
              >
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
