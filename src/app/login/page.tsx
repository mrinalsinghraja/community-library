import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Butterfly, LibraryLogo } from "@/components/library/library-logo";
import { Icon } from "@/components/ui/icon";
import { POST_LOGIN_PATH } from "@/lib/routes";
import { audienceFor } from "@/lib/sign-in";
import { getActor } from "@/server/authz";
import { formatCode } from "@/server/lib/codes";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; activated?: string; reset?: string; changed?: string }>;
}) {
  const branding = await getBrandingSafe();
  const { next, activated, reset, changed } = await searchParams;

  /*
   * Somebody genuinely signed in has no reason to be here.
   *
   * This used to live in the proxy, which can only see that a cookie exists —
   * so a session that had gone idle bounced between /account and /login for
   * ever, and the reader could not get back in. Resolving the real session is
   * the difference between "you are signed in" and "you have a cookie".
   */
  if (await getActor()) redirect(POST_LOGIN_PATH);

  // A worked example of this library's own card format, so the hint is right
  // whichever community is running the platform.
  let cardExample: string | undefined;
  try {
    const { settings } = await getCurrentLibrary();
    cardExample = formatCode(settings.memberCodePrefix, 42, settings.memberCodePadding);
  } catch {
    cardExample = undefined;
  }

  const notice = activated
    ? "All set up! Sign in with your library card and your new password. 🎉"
    : changed
      ? "Your new password is saved. Please sign in with it."
      : reset
        ? "Your new password is saved. Sign in with it now."
        : null;

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        {/*
          A room, not a form.

          Two halves in one lifted frame: the library on the left, in the deep
          green of its own rule, and the way in on the right, on white. The
          left half is what a parent who has never been here reads while a
          child reaches for the keyboard — where this is, what it is for, and
          that nobody here can see a password. On a phone it sits above the
          form, shortened, and the form comes first in the reading order that
          matters, which is the tab order.
        */}
        <div className="grid overflow-hidden rounded-[1.25rem] bg-surface shadow-float lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          {/*
            Second on a phone, first on a desk. A parent on a phone came to
            sign a child in and the form should be under their thumb; the room
            reads fine below it. The DOM keeps the panel first because a
            sighted keyboard user on a wide screen meets it first too, and the
            panel holds nothing to focus, so the tab order is the form's either
            way.
          */}
          <aside className="auth-panel relative isolate order-2 flex flex-col justify-between gap-10 px-7 py-9 text-white sm:px-10 sm:py-11 lg:order-none lg:px-12 lg:py-14">
            <Butterfly
              tone="soft"
              className="drift pointer-events-none absolute right-8 top-8 w-14 opacity-50 sm:w-20"
            />
            <Butterfly
              tone="soft"
              className="drift-slow pointer-events-none absolute bottom-24 right-24 hidden w-9 opacity-35 lg:block"
            />

            <div className="relative">
              {/* On its own white plate, so an uploaded mark with a light ground never floats unframed on the dark panel. */}
              <span className="inline-flex rounded-[0.9rem] bg-white/95 p-2.5 shadow-lift">
                <LibraryLogo
                  logoUrl={branding.logoUrl}
                  libraryName={branding.libraryName}
                  size={64}
                  className="w-12 sm:w-14"
                />
              </span>
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-white/70">
                {branding.libraryName}
              </p>
              <h2 className="mt-3 max-w-md text-3xl text-white sm:text-4xl">
                Your library is open.
              </h2>
              <p className="mt-4 max-w-md text-base text-white/80 sm:text-lg">
                Free to join, run by neighbours, and shelved a short walk from your door.
              </p>
            </div>

            <ul className="relative flex flex-col gap-4 text-base text-white/85">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
                  <Icon name="book" />
                </span>
                <span>
                  <strong className="font-semibold text-white">Readers</strong> — your books,
                  your card, and what to read next.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
                  <Icon name="staff" />
                </span>
                <span>
                  <strong className="font-semibold text-white">Library staff</strong> — the
                  desk, the shelves, and the families who use them.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
                  <Icon name="key" />
                </span>
                <span>Nobody at the library can see your password. Not even the librarian.</span>
              </li>
            </ul>

            <p className="relative flex items-start gap-2.5 text-sm text-white/70">
              <Icon name="home" className="mt-0.5 shrink-0" />
              <span>{branding.venueAddress}</span>
            </p>
          </aside>

          <div className="order-1 px-6 py-8 sm:px-10 sm:py-11 lg:order-none lg:px-12 lg:py-14">
            {notice ? (
              <p
                role="status"
                className="mb-6 flex items-start gap-3 rounded-[var(--radius-field)] border border-success/25 bg-success-wash px-5 py-4 text-base font-bold text-success"
              >
                <Icon name="check" className="mt-0.5 shrink-0" />
                <span>{notice}</span>
              </p>
            ) : null}

            <h1 className="garden-rule inline-block text-3xl sm:text-4xl">Welcome back!</h1>

            <div className="mt-9">
              <LoginForm
                next={next}
                cardExample={cardExample}
                defaultAudience={audienceFor(next)}
              />
            </div>

            <div className="mt-8 flex flex-col gap-3 border-t border-hairline pt-6 text-base text-ink-soft">
              <p>
                <Link href="/forgot" className="font-bold text-primary-deep">
                  Forgotten your password?
                </Link>{" "}
                We will email a link to your parent or guardian. Nobody at the library can see your
                password.
              </p>
              <p>
                Not a member yet?{" "}
                <Link href="/join" className="font-bold text-primary-deep">
                  Join the library
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
