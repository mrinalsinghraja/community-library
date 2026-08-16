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

        <nav aria-label="Main" className="ms-auto flex shrink-0 items-center gap-2">
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
