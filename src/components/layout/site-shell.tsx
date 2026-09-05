import Link from "next/link";
import type { ReactNode } from "react";

import { Butterfly, LibraryLogo } from "@/components/library/library-logo";
import { NavLink } from "@/components/layout/nav-link";
import { cn } from "@/lib/cn";
import { StoryCharacters } from "@/components/library/story-characters";
import { canReachDesk, readerDestinationsFor } from "@/lib/desk-nav";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { JOIN_HELP_MESSAGE, whatsAppLink } from "@/lib/whatsapp";
import { signOutAction } from "@/server/actions/auth-actions";
import { getActor } from "@/server/authz";
import {
  catalogueIsPubliclyVisible,
  type Branding,
} from "@/server/lib/settings";

/**
 * The public shell: masthead, main landmark, footer.
 *
 * The masthead is anchored by the library's mark and closed by the green rule
 * lifted from it, so the brand is part of the structure rather than a picture
 * parked in a corner. Everything visible here comes from configuration.
 */

/*
 * Navigation is set in the body face, not the display one.
 *
 * A characterful serif on every control is what made this read as a poster. The
 * headings keep Fraunces; the doors are quiet, so the reader's eye goes to the
 * page rather than to the way out of it.
 */
/*
 * `min-h-11` is 44px, and it is the whole reason this is a flex box rather than
 * a padded inline element: the doors were 39px tall on a phone and the policy
 * links at the foot of the page were 23px. Every button in this system is sized
 * for a five-year-old's hand — see the note in `button.tsx` — and the
 * navigation was the one part that had never been measured against that rule.
 * Nothing here changes size on a wide screen by more than a few pixels.
 */
const NAV_LINK =
  "inline-flex min-h-11 items-center rounded-[var(--radius-button)] px-2.5 py-2 text-base " +
  "font-semibold text-ink-soft no-underline transition-colors hover:bg-accent-wash " +
  "hover:text-accent-ink sm:px-3.5";

/** The same 44px floor for a link that is not a door: footers, policy rows. */
const FOOT_LINK = "inline-flex min-h-11 items-center no-underline";

/**
 * The doors, written once.
 *
 * The masthead and the foot of the page offer the same places, and they used to
 * be two hand-maintained lists — which is how the donors page ended up reachable
 * from the footer and the home page but not from the masthead, and how a new
 * page gets added to one of them and forgotten in the other.
 *
 * The destinations themselves live in `@/lib/desk-nav`, with the desk's, so
 * that a role's menu is the same list wherever they are standing. See ADR-059:
 * this shell and the staff shell each used to own a navigation array, which is
 * how a Super Admin came to see one menu on `/account` and a different one on
 * `/desk/loans`.
 */

export async function SiteHeader({ branding }: { branding: Branding }) {
  /*
   * Everything here is read from the session. Nothing is passed in.
   *
   * It used to be half and half, and the halves disagreed. Whether to show
   * "Sign in" or "My library" came from a `signedIn` prop, while whether to show
   * the way to the desk was read from `getActor()` -- so any page that forgot
   * the prop rendered a signed-in administrator "Sign in" and a link to the
   * library desk at the same time, and hid Books and My books from somebody
   * holding a valid session. Seven pages had forgotten it, including the rules
   * page and the login page.
   *
   * A flag that every page must remember is a flag some page will forget. The
   * session is the only thing that knows the answer, so it is the only thing
   * asked. `getActor` is cached per request, so this costs nothing on a page
   * that already asked.
   */
  const actor = await getActor();
  const signedIn = Boolean(actor);
  const deskIsOpen = actor ? canReachDesk(actor.permissions) : false;
  /*
   * Read, not passed in, for the same reason `actor` is. An unconfigured
   * database throwing here must not take down the masthead on every page, so a
   * failure means "not public" and the link stays hidden.
   */
  const cataloguePublic = await catalogueIsPubliclyVisible().catch(() => false);

  /*
   * The same two calls the staff shell makes, with the same answers. Staff hold
   * no library card, so `isMember` is a question about the account rather than
   * about the session — which is what stops "My books" being offered to a
   * librarian and silently redirecting them to the desk.
   */
  const destinations = readerDestinationsFor({
    isMember: actor?.kind === "MEMBER",
    signedIn,
    cataloguePublic,
  });

  return (
    /*
      Sticky from tablet width up, static on a phone. A two-row masthead is a
      fifth of a phone screen and pinning it there would be paying for
      convenience with the one thing a small screen has none of.
    */
    <header className="masthead relative">
      {/*
        Wraps to two rows on a narrow screen: brand above, navigation below.
        A library name can be long, and squeezing it onto one row with the
        buttons either shreds it into four lines or truncates the community's
        own name — neither is acceptable on the front door.
      */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 no-underline sm:gap-4"
          aria-label={`${branding.libraryName} — home`}
        >
          <LibraryLogo
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            size={48}
            className="w-10 shrink-0 sm:w-12"
          />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-semibold text-ink sm:text-2xl">
              {branding.libraryName}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft sm:text-sm">
              {branding.communityName}
            </span>
          </span>
        </Link>

        {/*
          The top row holds only the two controls that are about *you* — the way
          in, and the way to the desk. The places to read about live in the band
          below.

          This is what replaced the old four-door ceiling. Every content page
          used to compete for room beside the library's name, and the fifth one
          pushed the smallest phone in the building into a horizontal scroll —
          which is why the donors page was reachable from the footer and the
          home page but never from the masthead. Splitting the two kinds of
          destination means adding a page no longer costs the layout anything.
        */}
        <nav
          aria-label="Your account"
          className="ms-auto flex flex-wrap items-center justify-end gap-x-1 gap-y-2 sm:gap-2"
        >
          {/*
            Shown to anybody with at least one desk screen they can open, and to
            no reader.

            It used to ask for `user.manage_staff`, which only the Super Admin
            holds — so a Librarian who opened their own account page arrived
            somewhere with no route back to the library they run, and had to
            type the URL. The question is "do you work here", not "do you
            administer the staff list", and `canReachDesk` answers the first one
            from the same list the desk itself renders.
          */}
          {deskIsOpen ? (
            <NavLink href="/desk" className={NAV_LINK}>
              Library desk
            </NavLink>
          ) : null}
          <Link
            href={signedIn ? "/account" : "/login"}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-button)] bg-primary px-4 py-2 text-base font-semibold text-white no-underline shadow-lift transition-colors hover:bg-primary-deep"
          >
            {signedIn ? "My library" : "Sign in"}
          </Link>
          {/*
            The way out, in the corner, on every page.

            It used to exist in exactly one place: the bottom of /account, below
            the password panel. A child on the library's shared laptop had to
            know that their own page was where signing out lived, scroll past
            everything on it, and find the button — so the realistic outcome was
            that they closed the tab and left the session open for whoever sat
            down next. The desk has had this control in its corner since it was
            built; the reader side is where it was missing.

            Quiet, not filled: the reader's eye should land on "My library",
            which is where they are going. This one only has to be findable.
          */}
          {signedIn ? (
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-[var(--radius-button)] border border-control-border px-3 py-2 text-base font-semibold text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent-ink"
              >
                Sign out
              </button>
            </form>
          ) : null}
        </nav>
      </div>

      {/*
        The doors, in a band of their own.

        It scrolls sideways rather than wrapping on a narrow screen. Wrapping
        would push the page content down by a whole row on exactly the phones
        that have the least room, and a row of destinations is the one thing a
        reader can be trusted to swipe: the first two are always visible, so it
        never looks like the end of the list.
      */}
      <div className="border-t border-hairline bg-ground/60">
        <nav
          aria-label="Main"
          className="mx-auto max-w-6xl overflow-x-auto px-5 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex items-center gap-1 py-2 sm:gap-2">
            {destinations.map((item) => (
              <li key={item.href} className="list-none">
                {/* Home is "/" and would otherwise be current on every page. */}
                <NavLink
                  href={item.href}
                  exact={item.href === "/"}
                  className={`${NAV_LINK} whitespace-nowrap`}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/*
        The signature, doing structural work: the rule from the mark becomes the
        edge of the masthead. Decorative, so it is hidden from screen readers.
      */}
      <div
        aria-hidden="true"
        className="h-1 w-full bg-[linear-gradient(to_right,var(--color-leaf),var(--color-primary)_35%,var(--color-accent))]"
      />
    </header>
  );
}

/**
 * The foot of every reader-facing page.
 *
 * Three columns on a wide screen, stacked on a phone, and the middle one is the
 * same list the masthead renders — a reader who has scrolled to the bottom
 * should not have to scroll back up to find a door, and the two lists must not
 * be able to disagree about what exists.
 *
 * The green rule from the masthead is repeated at the very bottom, closing the
 * page the same way the header opens it.
 */
export async function SiteFooter({ branding }: { branding: Branding }) {
  const whatsapp = whatsAppLink(branding.contactPhone, JOIN_HELP_MESSAGE);

  /*
   * Read from the session, exactly like the masthead, and for the reason the
   * masthead already learned: `signedIn` used to arrive as a prop with a default
   * of `false`, so every page that forgot to pass it rendered a signed-in
   * reader a different footer from their own header. A flag every page must
   * remember is a flag some page will forget. Both are cached per request.
   */
  const actor = await getActor();
  const cataloguePublic = await catalogueIsPubliclyVisible().catch(() => false);

  const signedIn = Boolean(actor);
  const destinations = readerDestinationsFor({
    isMember: actor?.kind === "MEMBER",
    signedIn,
    cataloguePublic,
  });

  return (
    <footer className="mt-16 border-t border-hairline bg-surface">
      <div className="mx-auto grid max-w-6xl gap-9 px-5 py-11 text-base text-ink-soft sm:px-8 md:grid-cols-[1.4fr_1fr_1fr] md:gap-12">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <LibraryLogo
              logoUrl={branding.logoUrl}
              libraryName={branding.libraryName}
              size={40}
              priority={false}
              className="w-9 shrink-0"
            />
            <p className="font-display text-lg font-semibold text-ink">
              {branding.libraryName}
            </p>
          </div>
          <p className="max-w-md">
            A free library run by and for the {branding.communityName}{" "}
            community. Books are shared, never sold. Joining costs nothing, and
            donating a book is never a condition of membership.
          </p>
          {/*
            The address in the footer of every page, because this is where a
            person looks for it once they have decided to come.
          */}
          <p className="font-bold text-ink">{branding.venueAddress}</p>
        </div>

        {/*
          "Pages" is the site's own list of destinations. Three paginations used
          to carry the same accessible name, so a screen-reader user hearing
          "Pages navigation" could not tell the footer from a list of page
          numbers. Each pagination is now named after what it pages through.
        */}
        <nav aria-label="Pages">
          <h2 className="font-display text-base font-bold uppercase tracking-[0.12em] text-ink">
            Find your way
          </h2>
          {/* No gap: the 44px hit areas are what separate these now. */}
          <ul className="mt-2 flex flex-col">
            {destinations.map((item) => (
              <li key={item.href} className="list-none">
                <Link href={item.href} className={`${FOOT_LINK} font-bold text-primary-deep`}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="list-none">
              <Link
                href={signedIn ? "/account" : "/login"}
                className={`${FOOT_LINK} font-bold text-primary-deep`}
              >
                {signedIn ? "My library" : "Sign in"}
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="font-display text-base font-bold uppercase tracking-[0.12em] text-ink">
            Ask a person
          </h2>
          <ul className="mt-2 flex flex-col">
            {whatsapp ? (
              <li className="list-none">
                {/*
                  Same prefilled message as the help block on the home page and
                  the joining guide, from the same helper — a parent who reaches
                  the foot of the page still stuck gets the identical door.
                */}
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${FOOT_LINK} font-bold text-primary-deep`}
                >
                  Message us on WhatsApp
                </a>
              </li>
            ) : null}
            {branding.contactEmail ? (
              <li className="list-none">
                <a
                  href={`mailto:${branding.contactEmail}`}
                  className={`${FOOT_LINK} font-bold text-primary-deep`}
                >
                  {branding.contactEmail}
                </a>
              </li>
            ) : null}
            <li className="list-none pt-3 text-base">
              A neighbour replies, not a robot — please allow a little time.
            </li>
          </ul>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The legal row                                                       */}
      {/*                                                                     */}
      {/* Its own band under a rule, in smaller type, the way every portal a   */}
      {/* parent already trusts arranges it. These four are not destinations   */}
      {/* the library wants anybody to visit — they are the ones somebody      */}
      {/* looks for when they have a reason to, and not finding them is itself */}
      {/* an answer about how seriously a site takes children's data.          */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 text-base text-ink-soft sm:px-8 md:flex-row md:items-center md:justify-between">
          <nav aria-label="Policies">
            <ul className="flex flex-wrap items-center gap-x-6">
              {LEGAL_LINKS.map((item) => (
                <li key={item.href} className="list-none">
                  <Link
                    href={item.href}
                    className={`${FOOT_LINK} text-ink-soft hover:text-accent-ink`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/*
            No "all rights reserved". The library owns a shelf of donated books
            and a piece of software; claiming rights over the page a family
            reads to find out what is held about their child would set exactly
            the wrong tone in the smallest type on the site.
          */}
          <p className="text-ink-faint">
            © {new Date().getFullYear()} {branding.libraryName}. Free to join,
            run by neighbours.
          </p>
        </div>
      </div>

      {/* The masthead's rule again, closing the page the way it was opened. */}
      <div
        aria-hidden="true"
        className="h-1 w-full bg-[linear-gradient(to_right,var(--color-accent),var(--color-primary)_65%,var(--color-leaf))]"
      />
    </footer>
  );
}

export async function PublicShell({
  branding,
  children,
}: {
  branding: Branding;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Behind everything on the reader side, and never on the desk. */}
      <StoryCharacters />
      <SiteHeader branding={branding} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter branding={branding} />
    </div>
  );
}

/**
 * The one place a reader page decides how wide it is.
 *
 * Every page used to carry its own `mx-auto w-full max-w-Nxl px-5 py-12`, and
 * the N was chosen a page at a time: 3xl here, 4xl there, 5xl on the busiest
 * screen in the application. On a laptop that reads as an accident and on a
 * large monitor it is one — the desk works at 104rem while a child's own shelf
 * was pinned to 64rem with a third of the screen empty either side, so the page
 * was long because it was narrow.
 *
 * Four widths, chosen by what the page holds rather than by taste:
 *
 *   * `form`  — one column of fields. A wide text input is harder to fill in,
 *               not easier, so this stays where it was.
 *   * `prose` — paragraphs meant to be read straight through. Capped near the
 *               line length the eye can track without losing its place.
 *   * `page`  — a mix: some prose, some cards.
 *   * `wide`  — grids, lists and dashboards, which get the room they can use.
 *
 * A `wide` page is not a licence to stretch a sentence across 88rem: the prose
 * inside one still caps itself. Width belongs to the layout; measure belongs to
 * the paragraph.
 */
export const PAGE_WIDTHS = {
  form: "max-w-xl",
  prose: "max-w-3xl",
  /*
   * One object and its facts: a book beside its cover, a family beside their
   * gifts. Narrower than `page` because the column of prose next to a picture
   * is the thing being read, and wider than `prose` because the picture needs
   * somewhere to stand.
   */
  detail: "max-w-4xl",
  page: "max-w-5xl",
  wide: "max-w-[88rem]",
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export function PageBody({
  width = "page",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full px-5 py-10 sm:px-8 sm:py-12",
        PAGE_WIDTHS[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The band every page opens with.
 *
 * The same room the sign-in page is drawn in, laid across the top of a page a
 * few lines deep: the deep primary lit berry at one corner and leaf at the
 * other, faintly ruled, with the section in small capitals, the heading, the
 * mark's own rule and the sentence that says what the page is for.
 *
 * It replaced a heading set in ink on paper, and the reason is that the library
 * had two visual languages and no rule about which page got which. The front
 * door, the sign-in and the joining form were lit; everything a family opened
 * afterwards was not, so the site looked like two sites — the one that
 * persuaded them and the one they then had to use.
 *
 * The light is the front door's own — gold high on the left, the deep primary
 * low on the right — so a family who was persuaded by the home page opens a
 * page that looks like the place they were persuaded by. The sign-in keeps the
 * dark room: a room is a moment at a door, a page is somewhere you stand.
 *
 * **Every colour on it is measured, not eyeballed.** See `.theme-band` in
 * globals.css: the darkest patch of the gradient is #E0DABF, where the page's
 * ordinary ink still reads 11.21:1 and its softest grey 5.64:1.
 *
 * The API did not change, so no page was edited to get this.
 */
export function PageHeading({
  eyebrow,
  title,
  children,
  butterfly = true,
}: {
  /**
   * The section this page belongs to, in small capitals above the title —
   * "Joining", "Policies". The same device the masthead and the desk use for
   * the library's name, so a page opens the way the site opens.
   *
   * A node rather than a string, because on a page one level down the section
   * is also the way back to it: `/account/details` had a "← My library" link
   * and then an eyebrow reading "MY LIBRARY" two lines below it, saying the
   * same words twice. One line that says where you are and takes you there.
   */
  eyebrow?: ReactNode;
  title: string;
  children?: ReactNode;
  butterfly?: boolean;
}) {
  return (
    <div className="theme-band relative isolate overflow-hidden rounded-[var(--radius-card)] px-6 py-7 shadow-card sm:px-9 sm:py-9">
      {butterfly ? (
        <Butterfly className="drift pointer-events-none absolute right-5 top-4 w-11 opacity-80 sm:right-8 sm:w-14" />
      ) : null}

      {eyebrow ? (
        <p className="relative mb-3 text-xs font-bold uppercase tracking-[0.18em] text-accent-ink">
          {eyebrow}
        </p>
      ) : null}

      <h1 className="garden-rule relative inline-block pe-14 text-3xl sm:pe-0 sm:text-4xl">
        {title}
      </h1>

      {children ? (
        <p className="relative mt-9 max-w-2xl text-lg text-ink-soft">{children}</p>
      ) : null}
    </div>
  );
}
