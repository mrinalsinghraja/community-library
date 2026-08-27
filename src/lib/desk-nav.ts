import type { PermissionKey } from "@/lib/permissions";

/**
 * Every door in the application, written once, for both shells.
 *
 * **The whole point of this file is that a role sees the same menu on every
 * screen.** It did not, and the reason was structural rather than a slip: the
 * application has two shells — the reader app and the desk — and each used to
 * own a navigation list. A Super Admin therefore got the children's masthead on
 * `/account` and the desk's on `/desk/loans`, with different items in each, and
 * one of the items on the reader side ("My books") went nowhere at all for
 * somebody with no library card. See ADR-059.
 *
 * Both shells now render from here:
 *
 *   * `deskDestinationsFor` — the working screens, filtered by permission.
 *   * `readerDestinationsFor` — the public side, filtered by who is looking.
 *
 * A role's menu is the concatenation of those two answers, and it does not
 * depend on which page they happen to be standing on. `tests/unit/navigation.
 * test.ts` asserts that directly.
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
  // "Book list", not "Books". The reader side has a "Catalogue"; two menus
  // using the same word for two different pages is the one inconsistency a
  // navigation must never have.
  { href: "/admin/books", label: "Book list", permission: "book.edit" },
  // Reviews waiting to go on a book's page. `review.moderate` is the authority
  // to decide, and so is exactly the authority to read what is waiting — not
  // `book.edit`, which is a fact about the collection rather than a judgement
  // about a child's writing. Deleting a published review is a different key
  // again (`review.delete`, Super Admin only) and guards a control on this page
  // rather than the page itself.
  { href: "/desk/reviews", label: "Reviews", permission: "review.moderate" },
  // When the room is open. `visit.manage` is Librarian and Super Admin both —
  // the person who will be standing behind the desk is the person who says when.
  // Corrections readers have asked for. `profile_change.review` is Super Admin
  // only — approving what a child proposed for their guardian's email moves the
  // account's recovery path, which is not the desk's call.
  { href: "/desk/changes", label: "Detail changes", permission: "profile_change.review" },
  { href: "/desk/visits", label: "Visiting times", permission: "visit.manage" },
  // What the library says to every family at once. Super Admin alone.
  { href: "/desk/board", label: "Notice board", permission: "announcement.manage" },
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

// ---------------------------------------------------------------------------
// The reader's side
// ---------------------------------------------------------------------------

export interface ReaderDestination {
  href: string;
  label: string;
  /**
   * Needs a library card, not merely a session.
   *
   * The distinction is the bug this replaced. The old filter asked "is somebody
   * signed in", so a librarian was shown "My books" — and `/my-books` reads the
   * session, finds no member, and silently redirects them to the desk. A door
   * that teleports you somewhere else is worse than no door.
   */
  membersOnly?: boolean;
  /** Shown to a signed-out visitor only when the catalogue is public. */
  cataloguePublicOnly?: boolean;
}

export const READER_DESTINATIONS: readonly ReaderDestination[] = [
  /*
   * Home, first, for everybody.
   *
   * The library's name in the corner has always been a link to it, and that is
   * a convention rather than a control: it is unlabelled, it is not where a
   * person looks for a way back, and on the desk the same corner says "Library
   * desk" and goes to /desk instead. So a librarian standing on a reader page
   * had no way back to the front of the site at all, and a child who had wandered
   * into the donors register had to know that a logo is a button.
   *
   * A named door, in the same row as the others, in the same place on every
   * screen. It costs one item and removes a piece of folklore.
   */
  { href: "/", label: "Home" },
  /*
   * "Catalogue", not "Books". The desk has a "Book list" and this is the shelf
   * a child browses; when both were called "Books" a librarian saw the same
   * word in two menus pointing at two different pages, which is the one kind of
   * inconsistency a navigation must never have.
   */
  { href: "/books", label: "Catalogue", cataloguePublicOnly: true },
  { href: "/my-books", label: "My books", membersOnly: true },
  { href: "/my-card", label: "My card", membersOnly: true },
  { href: "/my-reviews", label: "What I thought", membersOnly: true },
  { href: "/how-to-join", label: "How to join" },
  { href: "/rules", label: "Our rules" },
  /*
   * In the shared list, so it is in the masthead of both shells for every role.
   * A parent reads it before joining and a librarian gets asked the same
   * questions at the desk; putting it only on the home page would mean the one
   * person who has to answer them cannot reach the answers.
   */
  { href: "/faq", label: "Questions" },
  { href: "/donors", label: "Book friends" },
];

/**
 * The public doors this person may open.
 *
 * `isMember` is a fact about the account, not about the session: staff hold no
 * library card, so the two "my own" pages are not theirs. The catalogue is a
 * fact about the library's settings, so a signed-out visitor sees it exactly
 * when the shelf is public.
 */
export function readerDestinationsFor(options: {
  isMember: boolean;
  signedIn: boolean;
  cataloguePublic: boolean;
}): readonly ReaderDestination[] {
  return READER_DESTINATIONS.filter((item) => {
    if (item.membersOnly) return options.isMember;
    if (item.cataloguePublicOnly) return options.signedIn || options.cataloguePublic;
    return true;
  });
}

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
