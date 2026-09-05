import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { AuthRoom } from "@/components/layout/auth-room";
import { PublicShell } from "@/components/layout/site-shell";
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
      <AuthRoom
        branding={branding}
        title="Welcome back!"
        notice={notice}
        footer={
          <>
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
          </>
        }
      >
        <LoginForm next={next} cardExample={cardExample} defaultAudience={audienceFor(next)} />
      </AuthRoom>
    </PublicShell>
  );
}
