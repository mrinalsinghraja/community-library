import Link from "next/link";
import type { ReactNode } from "react";

import { Butterfly, LibraryLogo } from "@/components/library/library-logo";
import { StoryCharacters } from "@/components/library/story-characters";
import { canReachDesk, deskDestinationsFor, readerDestinationsFor } from "@/lib/desk-nav";
import { JOIN_HELP_MESSAGE, whatsAppLink } from "@/lib/whatsapp";
import { getActor } from "@/server/authz";
import { catalogueIsPubliclyVisible, type Branding } from "@/server/lib/settings";

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
const NAV_LINK =
  "rounded-[var(--radius-button)] px-2.5 py-2 text-base font-semibold text-ink-soft no-underline " +
  "transition-colors hover:bg-accent-wash hover:text-accent-ink sm:px-3.5";

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
    <header className="relative bg-surface">
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
            <span className="text-sm text-ink-soft sm:text-base">{branding.communityName}</span>
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
            <Link href="/desk" className={NAV_LINK}>
              Library desk
            </Link>
          ) : null}
          <Link
            href={signedIn ? "/account" : "/login"}
            className="rounded-[var(--radius-button)] bg-primary px-4 py-2 text-base font-semibold text-white no-underline transition-colors hover:bg-primary-deep"
          >
            {signedIn ? "My library" : "Sign in"}
          </Link>
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
          <ul className="flex items-center gap-1 py-1.5 sm:gap-2">
            {destinations.map((item) => (
              <li key={item.href} className="list-none">
                <Link href={item.href} className={`${NAV_LINK} whitespace-nowrap`}>
                  {item.label}
                </Link>
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
            <p className="font-display text-lg font-semibold text-ink">{branding.libraryName}</p>
          </div>
          <p className="max-w-md">
            A free library run by and for the {branding.communityName} community. Books are shared,
            never sold. Joining costs nothing, and donating a book is never a condition of
            membership.
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
          <ul className="mt-4 flex flex-col gap-2.5">
            {destinations.map((item) => (
              <li key={item.href} className="list-none">
                <Link href={item.href} className="font-bold text-primary-deep no-underline">
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="list-none">
              <Link
                href={signedIn ? "/account" : "/login"}
                className="font-bold text-primary-deep no-underline"
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
          <ul className="mt-4 flex flex-col gap-2.5">
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
                  className="font-bold text-primary-deep no-underline"
                >
                  Message us on WhatsApp
                </a>
              </li>
            ) : null}
            {branding.contactEmail ? (
              <li className="list-none">
                <a
                  href={`mailto:${branding.contactEmail}`}
                  className="font-bold text-primary-deep no-underline"
                >
                  {branding.contactEmail}
                </a>
              </li>
            ) : null}
            <li className="list-none pt-1 text-base">
              A neighbour replies, not a robot — please allow a little time.
            </li>
          </ul>
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
 * A page heading with the garden rule under it, and one butterfly to the side.
 * Used at the top of every child-facing page so they are visibly one family.
 */
export function PageHeading({
  title,
  children,
  butterfly = true,
}: {
  title: string;
  children?: ReactNode;
  butterfly?: boolean;
}) {
  return (
    <div className="relative">
      <h1 className="garden-rule inline-block text-3xl sm:text-4xl">{title}</h1>
      {butterfly ? (
        <Butterfly className="drift absolute -top-2 right-0 w-9 opacity-80 sm:w-12" />
      ) : null}
      {children ? <p className="mt-7 max-w-2xl text-lg text-ink-soft">{children}</p> : null}
    </div>
  );
}
