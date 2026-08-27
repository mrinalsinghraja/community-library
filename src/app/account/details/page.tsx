import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/app/account/profile-form";
import { PublicShell } from "@/components/layout/site-shell";
import { StaffShell } from "@/components/layout/staff-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { roleDescription, roleLabel } from "@/lib/permissions";
import { signOutAction } from "@/server/actions/auth-actions";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnAccountSummary, getOwnMemberCard } from "@/server/services/account-service";
import { getOwnProfile } from "@/server/services/profile-change-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account details" };

/**
 * Everything about this account in one place: who the library has on file, the
 * password, and the way out.
 *
 * These three panels used to sit at the foot of `/account`, under the doors and
 * the list of what a person can do — so the signed-in landing page ended with a
 * long tail of settings that almost nobody had come for, and the two things
 * somebody in trouble needs (their guardian's email address, and how to change
 * a password) were the furthest thing from the top of the page.
 *
 * Splitting them off is the ordinary shape of every account area a parent
 * already uses: a landing that takes you somewhere, and a details page you open
 * on purpose. Nothing here changed except where it lives — the same server
 * actions, the same approval rule on a reader's own corrections.
 */
export default async function AccountDetailsPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

  // Middleware redirects when the cookie is absent, but middleware cannot check
  // validity. This is the check that actually counts.
  if (!actor) redirect("/login?next=/account/details");

  // Ownership from the session, never from the request. There is no id in the
  // URL to tamper with here, and that is the point.
  const profile = await getOwnMemberCard();
  const account = await getOwnAccountSummary();
  // Null for staff, who hold no library card and have nothing to correct here.
  const ownProfile = await getOwnProfile();
  const { settings } = await getCurrentLibrary();
  const timezone = settings.timezone;

  // Same rule as /account: a role's menu must not change with the page.
  const Shell = actor.kind === "STAFF" ? StaffShell : PublicShell;

  return (
    <Shell branding={branding} actor={actor} title="Account details">
      <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8">
        <p className="text-base text-ink-soft">
          <Link href="/account" className="font-bold text-primary-deep no-underline">
            ← My library
          </Link>
        </p>
        <h1 className="garden-rule mt-3 inline-block text-4xl">Account details</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft">
          What the library has on file for you, your password, and the way to sign out.
        </p>

        <Card tone="shelf" className="mt-8">
          <CardTitle icon={<Icon name="card" />}>Who you are here</CardTitle>
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-bold text-ink">You are</dt>
              <dd className="flex flex-wrap gap-2">
                {actor.roleKeys.length > 0 ? (
                  actor.roleKeys.map((role) => (
                    <StatusBadge key={role} tone="neutral">
                      {roleLabel(role)}
                    </StatusBadge>
                  ))
                ) : (
                  <span>No roles assigned</span>
                )}
              </dd>

              {/*
                A reader signs in with the code printed on their card, so that
                is what this says. It used to fall through to "Ask a librarian"
                for every child, because children hold neither an email address
                nor a username — the field was answering a staff question on a
                child's page.
              */}
              <dt className="font-bold text-ink">You sign in with</dt>
              <dd>
                {profile?.memberCode ?? account.email ?? account.username ?? "Ask a librarian"}
              </dd>
            </dl>

            {actor.roleKeys.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2 border-t border-hairline pt-4">
                {actor.roleKeys.map((role) => {
                  const description = roleDescription(role);
                  return description ? (
                    <li key={role} className="list-none text-base">
                      <span className="font-bold text-ink">{roleLabel(role)}</span> — {description}
                    </li>
                  ) : null;
                })}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        {/* A reader's own corrections. Staff have no library card, so no form. */}
        {ownProfile ? (
          <div className="mt-6">
            <ProfileForm profile={ownProfile} />
          </div>
        ) : null}

        {/*
          Everything about the password in one place, including the two things
          somebody in trouble actually needs: where the email lands, and what to
          do when they cannot remember the current one. Both used to be
          discoverable only by signing out and finding the link on /login, which
          is a strange thing to ask of somebody who is already signed in.
        */}
        <Card tone="shelf" className="mt-6">
          <CardTitle icon={<Icon name="key" />}>Your password</CardTitle>
          <CardBody>
            {account.lastPasswordChangeAt ? (
              <p>
                Last changed on{" "}
                <span className="font-bold text-ink">
                  {formatInTimezone(account.lastPasswordChangeAt, timezone, "d MMM yyyy")}
                </span>
                . If that was not you, change it now and tell a librarian.
              </p>
            ) : (
              <p>This account has not changed its password yet.</p>
            )}

            {account.recoveryEmail ? (
              <p className="mt-3">
                {account.recoveryIsGuardian
                  ? "If you ask for a reset link, it goes to the guardian who signed you up — at "
                  : "A reset link would be sent to "}
                <span className="font-bold text-ink">{account.recoveryEmail}</span>.
              </p>
            ) : (
              <p className="mt-3">
                There is no email address on this account, so a reset link cannot be sent. A
                librarian can set one up for you.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <ButtonLink href="/account/password" size="md" icon={<Icon name="key" />}>
                Change my password
              </ButtonLink>
              {account.recoveryEmail ? (
                <ButtonLink href="/forgot" variant="secondary" size="md" icon={<Icon name="mail" />}>
                  Email me a reset link
                </ButtonLink>
              ) : null}
            </div>

            {/*
              "That address" needs an address to point at. On an account with no
              email on file the sentence above it says a reset link cannot be
              sent, and this one then promised a note to nobody.
            */}
            <p className="mt-4 text-base">
              {account.recoveryEmail
                ? "Whenever it changes, we send a note to that address so somebody always knows it happened. "
                : null}
              Changing it signs out every other device.
            </p>
          </CardBody>
        </Card>

        {/*
          Still here, even though the masthead now carries one in the corner of
          every page. The corner button is for the person leaving a shared
          machine in a hurry; this one comes with the sentence explaining what
          signing out actually does, which is the thing worth reading once.
        */}
        <div className="mt-10 border-t border-hairline pt-6">
          <form action={signOutAction}>
            <Button type="submit" variant="quiet" size="lg" icon={<Icon name="signOut" />}>
              Sign out
            </Button>
          </form>
          <p className="mt-3 text-base text-ink-soft">
            Signing out deletes this session on the server, not just in this browser. If you are on
            a shared device in the library, always use this button.
          </p>
        </div>
      </div>
    </Shell>
  );
}
