import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/app/account/password/change-password-form";
import { PageBody, PageHeading, PublicShell } from "@/components/layout/site-shell";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { getActor } from "@/server/authz";
import { PASSWORD_POLICY } from "@/server/lib/password";
import { getBrandingSafe } from "@/server/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Change your password" };

export default async function ChangePasswordPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

  if (!actor) redirect("/login?next=/account/password");

  const isStaff = actor.kind === "STAFF";
  const Shell = isStaff ? StaffShell : PublicShell;
  const policy = isStaff ? PASSWORD_POLICY.staff : PASSWORD_POLICY.member;

  return (
    // Same rule as /account: a role's menu must not change with the page.
    <Shell branding={branding} actor={actor}>
      <PageBody width="form">
        <PageHeading eyebrow="My library" title="Change your password">
          You will need the current one first. Everything gets signed out afterwards — including
          here — so you will sign in again with the new one.
        </PageHeading>

        <Card className="mt-8">
          <ChangePasswordForm minLength={policy.minLength} isStaff={isStaff} />
        </Card>

        {/*
          The way out for the person this form cannot serve.

          It asks for the current password, which is the right rule -- it is what
          stops a borrowed unlocked device becoming a stolen account. But it
          leaves somebody who has forgotten theirs staring at a field they cannot
          fill, and the only remedy used to be signing out to find the link on
          the login page.
        */}
        <p className="mt-6 text-base text-ink-soft">
          Cannot remember the current one?{" "}
          <Link href="/forgot" className="font-bold text-primary-deep">
            Have a reset link emailed instead
          </Link>
          .
        </p>

        <p className="mt-6 text-base text-ink-soft">
          <Link href="/account/details" className="font-bold text-primary-deep">
            Back to account details
          </Link>
        </p>
      </PageBody>
    </Shell>
  );
}
