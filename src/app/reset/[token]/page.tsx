import type { Metadata } from "next";
import { headers } from "next/headers";

import { ResetForm } from "@/app/reset/[token]/reset-form";
import { AuthRoom } from "@/components/layout/auth-room";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { PASSWORD_POLICY } from "@/server/lib/password";
import { inspectResetToken } from "@/server/services/password-service";
import { getBrandingSafe } from "@/server/lib/settings";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a new password",
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
      {view.valid ? (
        <AuthRoom
          branding={branding}
          title="Choose a new password"
          lede={
            <>
              {view.displayName
                ? `This is for ${view.displayName}'s account.`
                : "Pick something only you would think of."}{" "}
              Every device that is signed in will be signed out.
            </>
          }
          panelHeading="A fresh start."
          panelLede="Two words joined together is a good password. Nobody at the library will ever see it."
        >
          <ResetForm token={token} minLength={PASSWORD_POLICY.member.minLength} />
        </AuthRoom>
      ) : (
        <AuthRoom
          branding={branding}
          panelHeading="A fresh start."
          panelLede="Reset links work once and last a couple of hours. A new one is a click away."
        >
          <EmptyState
            illustration={<Icon name="key" />}
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
        </AuthRoom>
      )}
    </PublicShell>
  );
}
