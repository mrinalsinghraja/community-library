import Link from "next/link";
import type { ReactNode } from "react";

import { Butterfly, LibraryLogo } from "@/components/library/library-logo";
import { StoryCharacters } from "@/components/library/story-characters";
import { getActor } from "@/server/authz";
import type { Branding } from "@/server/lib/settings";

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

export async function SiteHeader({
  branding,
  signedIn = false,
}: {
  branding: Branding;
  signedIn?: boolean;
}) {
  /*
   * Read rather than passed down, because otherwise every page that renders
   * this shell would have to remember to hand it a flag, and the one that
   * forgot would be the one where an administrator could not find their way
   * back. `getActor` is cached for the request, so on a page that already asked
   * who is signed in this costs nothing at all.
   *
   * The permission decides, not the role name — same key that guards the page
   * itself. A librarian and a reader do not hold it and see nothing.
   */
  const actor = await getActor();
  const canManageStaff = actor?.permissions.has("user.manage_staff") ?? false;

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
          Wraps, and does not shrink-0.

          There is no hamburger menu here on purpose — every door stays visible
          — so the navigation has to be able to take a second row rather than
          push the page sideways. Four doors is the ceiling: adding "My books"
          in Phase 3 made a fourth item, which is what took it past 375px and
          produced a horizontally scrolling page on the smallest phone in the
          building. The donors page is reached from the home page and the foot
          of every page instead of becoming a fifth.
        */}
        <nav
          aria-label="Main"
          className="ms-auto flex flex-wrap items-center justify-end gap-x-1 gap-y-2 sm:gap-2"
        >
          {/*
            Only for signed-in readers, because the catalogue defaults to
            MEMBER_ONLY. Offering a door that answers "sign in first" is worse
            than not showing it, and the setting that decides this is read on
            the page itself.
          */}
          {signedIn ? (
            <>
              <Link href="/books" className={NAV_LINK}>
                Books
              </Link>
              {/*
                No permission check here, deliberately. This shell renders for
                staff as well as readers, and /my-books redirects a librarian to
                the desk rather than showing them an empty shelf. The page
                itself decides; the masthead only offers the door.
              */}
              <Link href="/my-books" className={NAV_LINK}>
                My books
              </Link>
            </>
          ) : null}
          <Link href="/rules" className={NAV_LINK}>
            Our rules
          </Link>
          {/*
            The fifth door, and the only one that breaks the ceiling above.
            It is shown to whoever holds `user.manage_staff` — one person in
            this library, on an adult's phone or a laptop — and never to a
            reader, whose 375px screen the four-door rule was written for.

            Without it the administrator's only way to the desk was to type a
            URL: /account renders this shell, not the staff one, so somebody
            signing in as the owner landed on a page with no door out.
          */}
          {canManageStaff ? (
            <Link href="/admin/staff" className={NAV_LINK}>
              Staff
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

export function SiteFooter({ branding }: { branding: Branding }) {
  return (
    <footer className="mt-16 border-t border-hairline bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-9 text-base text-ink-soft sm:px-8">
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
        <p className="max-w-2xl">
          A free library run by and for the {branding.communityName} community. Books are shared,
          never sold. Joining costs nothing, and donating a book is never a condition of membership.
        </p>
        <p className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/rules" className="font-bold text-primary-deep">
            How our library works
          </Link>
          <Link href="/donors" className="font-bold text-primary-deep">
            Book friends
          </Link>
          {branding.contactEmail ? (
            <a href={`mailto:${branding.contactEmail}`} className="font-bold text-primary-deep">
              {branding.contactEmail}
            </a>
          ) : null}
        </p>
      </div>
    </footer>
  );
}

export function PublicShell({
  branding,
  signedIn,
  children,
}: {
  branding: Branding;
  signedIn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Behind everything on the reader side, and never on the desk. */}
      <StoryCharacters />
      <SiteHeader branding={branding} signedIn={signedIn} />
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
