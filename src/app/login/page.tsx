import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { getActor } from "@/server/authz";
import { formatCode } from "@/server/lib/codes";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Butterfly } from "@/components/library/library-logo";

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
  if (await getActor()) redirect("/account");

  // A worked example of this library's own card format, so the hint is right
  // whichever community is running the platform.
  let cardExample: string | undefined;
  try {
    const { settings } = await getCurrentLibrary();
    cardExample = formatCode(settings.memberCodePrefix, 42, settings.memberCodePadding);
  } catch {
    cardExample = undefined;
  }

  return (
    <PublicShell branding={branding}>
      <div className="relative mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-9 opacity-60 sm:w-12" />

        {activated ? (
          <p
            role="status"
            className="mb-6 rounded-[var(--radius-field)] bg-success-wash px-5 py-4 text-lg font-bold text-success"
          >
            All set up! Sign in with your library card and your new password. 🎉
          </p>
        ) : null}

        {changed ? (
          <p
            role="status"
            className="mb-6 rounded-[var(--radius-field)] bg-success-wash px-5 py-4 text-lg font-bold text-success"
          >
            Your new password is saved. Please sign in with it.
          </p>
        ) : null}

        {reset ? (
          <p
            role="status"
            className="mb-6 rounded-[var(--radius-field)] bg-success-wash px-5 py-4 text-lg font-bold text-success"
          >
            Your new password is saved. Sign in with it now.
          </p>
        ) : null}

        <h1 className="garden-rule inline-block text-4xl">Welcome back!</h1>
        <p className="mt-8 text-lg text-ink-soft">
          Sign in to see your books and find your next story.
        </p>

        <Card className="mt-8">
          <LoginForm next={next} cardExample={cardExample} />
        </Card>

        <div className="mt-8 flex flex-col gap-3 text-base text-ink-soft">
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
    </PublicShell>
  );
}
