import Link from "next/link";
import type { ReactNode } from "react";

import { Butterfly, LibraryLogo } from "@/components/library/library-logo";
import type { Branding } from "@/server/lib/settings";

/**
 * The public shell: masthead, main landmark, footer.
 *
 * The masthead is anchored by the library's mark and closed by the green rule
 * lifted from it, so the brand is part of the structure rather than a picture
 * parked in a corner. Everything visible here comes from configuration.
 */

const NAV_LINK =
  "rounded-full px-2.5 py-2.5 text-base font-bold font-display text-ink-soft no-underline " +
  "transition-colors hover:bg-accent-wash hover:text-accent-ink sm:px-4 sm:text-lg";

export function SiteHeader({
  branding,
  signedIn = false,
}: {
  branding: Branding;
  signedIn?: boolean;
}) {
  return (
    <header className="relative bg-surface">
      {/*
        Wraps to two rows on a narrow screen: brand above, navigation below.
        A library name can be long, and squeezing it onto one row with the
        buttons either shreds it into four lines or truncates the community's
        own name — neither is acceptable on the front door.
      */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 no-underline sm:gap-4"
          aria-label={`${branding.libraryName} — home`}
        >
          <LibraryLogo
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            size={52}
            className="w-11 shrink-0 sm:w-14"
          />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-bold text-ink sm:text-2xl">
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
            How it works
          </Link>
          <Link
            href={signedIn ? "/account" : "/login"}
            className="rounded-full bg-primary px-5 py-2.5 font-display text-base font-bold text-white no-underline transition-colors hover:bg-primary-deep sm:text-lg"
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
    <footer className="mt-20 border-t-2 border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-10 text-base text-ink-soft sm:px-8">
        <div className="flex items-center gap-3">
          <LibraryLogo
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            size={40}
            priority={false}
            className="w-9 shrink-0"
          />
          <p className="font-display text-lg font-bold text-ink">{branding.libraryName}</p>
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
      {children ? <p className="mt-8 max-w-2xl text-lg text-ink-soft">{children}</p> : null}
    </div>
  );
}
