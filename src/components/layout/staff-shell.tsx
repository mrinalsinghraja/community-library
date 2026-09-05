import Link from "next/link";
import type { ReactNode } from "react";

import { LEGAL_LINKS } from "@/lib/legal-links";
import { LibraryLogo } from "@/components/library/library-logo";
import { DeskEyebrow } from "@/components/layout/desk-eyebrow";
import { NavLink } from "@/components/layout/nav-link";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/permissions";
import type { Actor } from "@/server/authz";
import {
  DESK_GROUPS,
  deskDestinationsFor,
  readerDestinationsFor,
  type DeskDestination,
} from "@/lib/desk-nav";
import { catalogueIsPubliclyVisible, type Branding } from "@/server/lib/settings";
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

type NavItem = DeskDestination & { badge?: number };

export async function StaffShell({
  branding,
  actor,
  pendingRegistrations,
  overdueLoans,
  pendingRenewals,
  pendingBorrowRequests,
  pendingReviews,
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
  /** Reviews written and not yet answered. Nothing publishes until they are. */
  pendingReviews?: number;
  title: string;
  children: ReactNode;
}) {
  /*
   * Badges belong to the page that counted them, so they are layered on here
   * rather than living in the shared list. Everything else about the desk --
   * which doors exist and which permission opens each one -- comes from
   * `DESK_DESTINATIONS`, so the reader masthead cannot disagree with this shell
   * about whether somebody works here.
   */
  const badges: Record<string, number | undefined> = {
    "/desk/loans": overdueLoans,
    "/desk/requests": pendingBorrowRequests,
    "/desk/renewals": pendingRenewals,
    "/desk/reviews": pendingReviews,
    "/desk/registrations": pendingRegistrations,
  };

  const visible: NavItem[] = deskDestinationsFor(actor.permissions).map((item) => ({
    ...item,
    badge: badges[item.href],
  }));

  /*
   * The same doors, standing in their clusters.
   *
   * Sliced from the filtered list above rather than filtered again, so a
   * cluster cannot hold a door the flat list refused. A cluster with nothing in
   * it for this person is left out — a Librarian sees no "Admin" heading over
   * an empty space.
   */
  const clusters = DESK_GROUPS.map((group) => ({
    group,
    doors: visible.filter((item) => item.group === group),
  })).filter((cluster) => cluster.doors.length > 0);

  /*
   * What this person is, said once, in the corner.
   *
   * A volunteer holds one role and it is the first thing a colleague looking
   * over their shoulder wants to know. Somebody holding several sees the first;
   * the full list is on their account page.
   */
  const role = actor.roleKeys[0] ? roleLabel(actor.roleKeys[0]) : null;

  /*
   * The public side of the library, in the same band the reader masthead uses.
   *
   * Added in ADR-059. Before it, eighteen desk screens offered no route to the
   * catalogue, the rules or the donors page — so a librarian's menu changed
   * completely depending on whether they were standing on `/desk/loans` or on
   * `/account`, which is the inconsistency this file and `site-shell.tsx` were
   * asked to stop having.
   *
   * `isMember: false` always: staff hold no library card, so "My books" and
   * "What I thought" are not theirs and would redirect them straight back here.
   */
  const cataloguePublic = await catalogueIsPubliclyVisible().catch(() => false);
  const readerDoors = readerDestinationsFor({
    isMember: false,
    signedIn: true,
    cataloguePublic,
  });


  return (
    <div className="desk-density flex min-h-screen flex-col">
      {/*
        White on the paper ground, with a hairline under it. The desk used to be
        white on white, which is why nothing on it had an edge.
      */}
      <header className="bg-surface shadow-[0_1px_0_rgb(43_33_24/0.08)]">
        <div className="mx-auto flex w-full max-w-[104rem] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5 sm:px-7">
          <Link href="/desk" className="flex items-center gap-3 no-underline">
            <LibraryLogo
              logoUrl={branding.logoUrl}
              libraryName={branding.libraryName}
              size={40}
              className="w-8"
            />
            <span className="flex flex-col leading-tight">
              <span className="font-display text-lg font-semibold text-ink">Library desk</span>
              {/* Which library's desk — from tablet width up; on a phone the row is the desk's. */}
              <span className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft sm:block">
                {branding.libraryName}
              </span>
            </span>
          </Link>

          <div className="ms-auto flex items-center gap-2.5">
            {role ? (
              <span className="hidden rounded-full bg-primary-wash px-2.5 py-1 text-xs font-bold tracking-[0.04em] text-primary-deep sm:inline-flex">
                {role}
              </span>
            ) : null}
            {/*
              A librarian's own account was reachable only by typing /account:
              every desk screen renders this shell, and this shell had no door to
              it. Their name is the thing they would click looking for it, so
              their name is the link.
            */}
            <Link
              href="/account"
              className="rounded-md px-2 py-1.5 text-sm font-semibold text-ink no-underline hover:bg-surface-sunk"
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
          The doors, in their clusters.

          One row that scrolls sideways on a narrow screen rather than wrapping
          into a wall. Each cluster carries its name above it from a wide
          screen up — "Lending", "People" — so a volunteer on their first
          afternoon reads five jobs rather than fifteen links. The current page
          is underlined in the same berry-to-green as every other current page
          on the site.
        */}
        <nav
          aria-label="Desk"
          className="mx-auto w-full max-w-[104rem] overflow-x-auto px-5 [scrollbar-width:none] sm:px-7 [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex items-stretch gap-1 pb-1.5 pt-1 lg:gap-0">
            {clusters.map((cluster, index) => (
              <li
                key={cluster.group}
                className={cn(
                  "flex list-none flex-col",
                  index > 0 && "lg:ms-3 lg:border-s lg:border-hairline lg:ps-3",
                )}
              >
                <span
                  aria-hidden="true"
                  className="hidden ps-2.5 pb-0.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-faint lg:block"
                >
                  {cluster.group}
                </span>
                <ul className="flex items-center gap-0.5">
                  {cluster.doors.map((item) => (
                    <li key={item.href} className="list-none">
                      <NavLink
                        href={item.href}
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold whitespace-nowrap text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
                      >
                        {item.label}
                        {item.badge ? (
                          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-ink px-1.5 py-0.5 text-xs font-bold text-white">
                            {item.badge}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          The reader's doors, in a band of their own beneath the desk's.

          Two bands rather than seventeen links on one row, and the split is the
          same one the reader masthead makes: what you are working on above, the
          places to go below. Quieter than the row above it, because a librarian
          serving a queue is not looking for the rules page — but it is there,
          and it is the same list they see on every other screen.
        */}
        <div className="border-t border-hairline bg-ground/60">
          <nav
            aria-label="The library"
            className="mx-auto flex w-full max-w-[104rem] flex-wrap items-center gap-1 px-5 py-1 sm:px-7"
          >
            {readerDoors.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                exact={item.href === "/"}
                className="rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
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
        {/*
          The title, opened the way every other screen opens: the cluster in
          small capitals, then the heading on its rule. The eyebrow is the one
          thing on the desk that knows the address; it says where you are so
          the heading does not have to.
        */}
        <header>
          <DeskEyebrow />
          <h1 className="garden-rule inline-block text-3xl">{title}</h1>
        </header>
        <div className="mt-8">{children}</div>
      </main>

      {/*
        The policy row, quietly, at the foot of the desk as well.

        The desk deliberately has no marketing footer — it is a working tool and
        a volunteer scrolling to the bottom of a loan list does not need to be
        told the library is free. But a librarian is also a person whose own
        details this software holds, and "where is the privacy notice" should
        have the same answer on every screen of the site rather than only on the
        ones a child can see.
      */}
      <footer className="mt-12 border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-5 text-base text-ink-faint sm:px-8">
          {LEGAL_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-ink-soft no-underline hover:text-accent-ink"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </footer>
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
        "desk-plate overflow-x-auto rounded-[var(--radius-card)]",
        className,
      )}
    >
      <table className="desk-table w-full min-w-[46rem] border-collapse text-base">
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
