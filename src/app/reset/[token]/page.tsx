import type { Metadata } from "next";
import { headers } from "next/headers";

import { ResetForm } from "@/app/reset/[token]/reset-form";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PASSWORD_POLICY } from "@/server/lib/password";
import { inspectResetToken } from "@/server/services/password-service";
import { getBrandingSafe } from "@/server/lib/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a new secret word",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const branding = await getBrandingSafe();
  const headerList = await headers();
  const requestIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");

  const view = await inspectResetToken(token, requestIp);

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        {view.valid ? (
          <>
            <h1 className="text-4xl">Choose a new secret word</h1>
            <p className="mt-3 text-lg text-ink-soft">
              {view.displayName
                ? `This is for ${view.displayName}'s account.`
                : "Pick something only you would think of."}{" "}
              Every device that is signed in will be signed out.
            </p>

            <Card className="mt-8">
              <ResetForm token={token} minLength={PASSWORD_POLICY.member.minLength} />
            </Card>
          </>
        ) : (
          <EmptyState
            illustration="🔗"
            title="This link has expired"
            action={
              <ButtonLink href="/forgot" size="lg">
                Ask for a new link
              </ButtonLink>
            }
          >
            Reset links work once and last a couple of hours. You can ask for a fresh one at any
            time.
          </EmptyState>
        )}
      </div>
    </PublicShell>
  );
}
