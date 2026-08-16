import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/app/login/login-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { formatCode } from "@/server/lib/codes";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const branding = await getBrandingSafe();
  const { next } = await searchParams;

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
      <div className="mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        <h1 className="text-4xl">Welcome back!</h1>
        <p className="mt-3 text-lg text-ink-soft">
          Sign in to see your books and find your next story.
        </p>

        <Card className="mt-8">
          <LoginForm next={next} cardExample={cardExample} />
        </Card>

        <div className="mt-8 flex flex-col gap-3 text-base text-ink-soft">
          <p>
            Forgotten your secret word? Ask a grown-up to speak to the librarian — they will send a
            fresh link to your family&rsquo;s email. Nobody at the library can see your password.
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
