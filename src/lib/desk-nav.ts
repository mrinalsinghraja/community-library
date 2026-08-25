import type { PermissionKey } from "@/lib/permissions";

/**
 * The desk, written once.
 *
 * Two separate screens needed to agree about this and did not. The staff shell
 * built its own list and filtered it by permission, correctly. The reader
 * masthead asked a different question entirely — `user.manage_staff` — to decide
 * whether to offer a way back to the desk at all, and only the Super Admin holds
 * that. A librarian who opened their own account page therefore arrived on a
 * page with no route back to the library they run, and had to type the URL.
 *
 * Both now read this file: the shell renders the destinations, the masthead asks
 * whether any of them are open. Adding a desk screen cannot leave one of them
 * behind.
 */

export interface DeskDestination {
  href: string;
  label: string;
  /** The single permission that decides whether this door exists. */
  permission: PermissionKey;
}

export const DESK_DESTINATIONS: readonly DeskDestination[] = [
  // Circulation first: on an ordinary afternoon it is what the desk is for.
  { href: "/desk/circulation", label: "Issue", permission: "loan.issue" },
  // loan.return, not loan.view — every reader holds loan.view, and this link
  // must only appear for somebody who works the desk.
  { href: "/desk/loans", label: "Books out", permission: "loan.return" },
  // A child has asked for a book and is waiting for it. `loan.issue` is the
  // authority to hand one over, and the same key guards the page — saying yes
  // here runs the desk's own issue, so it is the same power either way.
  { href: "/desk/requests", label: "Books asked for", permission: "loan.issue" },
  // A child asked a question and is waiting. `loan.renew` is the authority to
  // answer it, and the same key guards the page.
  { href: "/desk/renewals", label: "Asks to keep", permission: "loan.renew" },
  { href: "/desk/registrations", label: "New members", permission: "registration.view" },
  { href: "/desk/members", label: "Readers", permission: "member.view" },
  // book.edit, not book.view: every reader holds book.view, and this link must
  // only appear for somebody who can actually manage the collection.
  { href: "/admin/books", label: "Books", permission: "book.edit" },
  // Reviews waiting to go on a book's page. `review.moderate` is the authority
  // to decide, and so is exactly the authority to read what is waiting — not
  // `book.edit`, which is a fact about the collection rather than a judgement
  // about a child's writing. Deleting a published review is a different key
  // again (`review.delete`, Super Admin only) and guards a control on this page
  // rather than the page itself.
  { href: "/desk/reviews", label: "Reviews", permission: "review.moderate" },
  { href: "/admin/staff", label: "Staff", permission: "user.manage_staff" },
  // What the library did over a period, as opposed to what it is doing now.
  // `report.view` is held by Librarian and Super Admin both.
  { href: "/desk/reports", label: "Reports", permission: "report.view" },
  // Administration. Three links, not fifteen: how the library works, what it
  // looks like, and what has been done to it.
  { href: "/admin/settings", label: "Settings", permission: "settings.view" },
  { href: "/admin/branding", label: "Branding", permission: "branding.edit" },
  { href: "/admin/audit", label: "Audit", permission: "audit.view" },
] as const;

/** The doors this person may open. Same filter the desk shell renders. */
export function deskDestinationsFor(
  permissions: ReadonlySet<PermissionKey>,
): readonly DeskDestination[] {
  return DESK_DESTINATIONS.filter((item) => permissions.has(item.permission));
}

/**
 * Whether to offer a way back to the desk from a reader-facing page.
 *
 * True when there is at least one desk screen this person can actually open, so
 * the link never leads somewhere that answers "you may not be here" — and never
 * goes missing for somebody who works there. A Librarian holds `loan.issue` and
 * not `user.manage_staff`, which is the whole reason this is a question about
 * the desk rather than a question about one page on it.
 */
export function canReachDesk(permissions: ReadonlySet<PermissionKey>): boolean {
  return deskDestinationsFor(permissions).length > 0;
}
