import Link from "next/link";
import type { ReactNode } from "react";

import { LibraryLogo } from "@/components/library/library-logo";
import type { Branding } from "@/server/lib/settings";

/**
 * The public shell: masthead, main landmark, footer.
 *
 * Reader, desk and admin shells arrive in later phases and will share this
 * header. Everything visible here comes from configuration.
 */

export function SiteHeader({
  branding,
  signedIn = false,
}: {
  branding: Branding;
  signedIn?: boolean;
}) {
  return (
    <header className="border-b-2 border-hairline bg-surface">
      {/*
        Wraps to two rows on a narrow screen: brand above, navigation below.
        A library name can be long, and squeezing it onto one row with the
        buttons either shreds it into four lines or truncates the community's
        own name — neither is acceptable on the front door.
      */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 no-underline sm:gap-3.5"
          aria-label={`${branding.libraryName} — home`}
        >
          <LibraryLogo
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            size={44}
            className="shrink-0 sm:size-13"
          />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-extrabold text-ink sm:text-2xl">
              {branding.libraryName}
            </span>
            <span className="text-sm text-ink-soft sm:text-base">{branding.communityName}</span>
          </span>
        </Link>

        {/*
          Wraps, and does not shrink-0.

          There is no hamburger menu here on purpose — every door stays visible
          — so the navigation has to be able to take a second row rather than
          push the page sideways. Adding "My books" in Phase 3 made a fourth
          item, which is what took it past 375px and produced a horizontally
          scrolling page on the smallest phone in the building.
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
              <Link
                href="/books"
                className="rounded-full px-2 py-2.5 text-base font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink sm:px-4 sm:text-lg"
              >
                Books
              </Link>
              {/*
                No permission check here, deliberately. This shell renders for
                staff as well as readers, and /my-books redirects a librarian to
                the desk rather than showing them an empty shelf. The page
                itself decides; the masthead only offers the door.
              */}
              <Link
                href="/my-books"
                className="rounded-full px-2 py-2.5 text-base font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink sm:px-4 sm:text-lg"
              >
                My books
              </Link>
            </>
          ) : null}
          <Link
            href="/rules"
            /* Kept visible at every width: there is no hamburger menu, so
               hiding this would make the page unreachable from the masthead. */
            className="rounded-full px-2 py-2.5 text-base font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink sm:px-4 sm:text-lg"
          >
            How it works
          </Link>
          <Link
            href={signedIn ? "/account" : "/login"}
            className="rounded-full bg-primary px-5 py-2.5 text-base font-bold text-white no-underline hover:bg-primary-deep sm:text-lg"
          >
            {signedIn ? "My library" : "Sign in"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ branding }: { branding: Branding }) {
  return (
    <footer className="mt-20 border-t-2 border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-10 text-base text-ink-soft sm:px-8">
        <p className="font-display text-lg font-bold text-ink">{branding.libraryName}</p>
        <p>
          A free library run by and for the {branding.communityName} community. Books are shared,
          never sold. Joining costs nothing, and donating a book is never a condition of membership.
        </p>
        {branding.contactEmail ? (
          <p>
            Questions?{" "}
            <a href={`mailto:${branding.contactEmail}`} className="font-bold text-primary-deep">
              {branding.contactEmail}
            </a>
          </p>
        ) : null}
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
