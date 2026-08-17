import type { Metadata } from "next";
import { headers } from "next/headers";

import { ActivateForm } from "@/app/activate/[token]/activate-form";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PASSWORD_POLICY } from "@/server/lib/password";
import { inspectActivationToken } from "@/server/services/password-service";
import { getBrandingSafe } from "@/server/lib/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your account",
  // The token is in the path. `no-referrer` stops it leaking through the
  // Referer header if the page ever links anywhere.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ActivatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const branding = await getBrandingSafe();
  const headerList = await headers();
  const requestIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");

  // Looks the token up without consuming it: a parent who opens the email twice
  // should see the form twice, not be told they have used their one chance.
  const view = await inspectActivationToken(token, requestIp);

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        {view.valid ? (
          <>
            <p className="text-lg font-bold text-accent-ink">Almost there</p>
            <h1 className="mt-2 text-4xl">
              {view.childName ? `Hello, ${view.childName}!` : "Set up your account"}
            </h1>
            <p className="mt-3 text-lg text-ink-soft">
              {view.memberCode && view.memberCode !== "—" ? (
                <>
                  Your library card is <strong className="text-ink">{view.memberCode}</strong>. Now
                  choose a secret word so only you can sign in.
                </>
              ) : (
                "Choose a password to finish setting up your account."
              )}
            </p>

            <Card className="mt-8">
              <ActivateForm token={token} minLength={PASSWORD_POLICY.member.minLength} />
            </Card>

            <p className="mt-6 text-base text-ink-soft">
              Grown-ups: please choose this together and keep it somewhere safe. Nobody at the
              library can see it — if it is forgotten we send a new link rather than telling you the
              old one.
            </p>
          </>
        ) : (
          <EmptyState
            illustration="🔗"
            title="This link has expired"
            action={
              <ButtonLink href="/" size="lg">
                Back to the library
              </ButtonLink>
            }
          >
            {/* One message for every failure — expired, already used, cancelled
                or never real. Distinguishing them would tell a stranger which
                links exist. */}
            Activation links work once and do not last forever. Ask your librarian and they will
            send a fresh one to your family&rsquo;s email.
          </EmptyState>
        )}
      </div>
    </PublicShell>
  );
}
