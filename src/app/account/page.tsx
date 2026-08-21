import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MemberAvatar } from "@/components/library/avatar";
import { PublicShell } from "@/components/layout/site-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Callout } from "@/components/ui/states";
import { formatInTimezone } from "@/lib/dates";
import { isDormantPermission, roleDescription, roleLabel } from "@/lib/permissions";
import { signOutAction } from "@/server/actions/auth-actions";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnAccountSummary, getOwnMemberCard } from "@/server/services/account-service";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "My library" };

/**
 * The signed-in landing page.
 *
 * In Phase 0 this exists to demonstrate that authentication and the RBAC model
 * work end to end: it shows who the database says you are and exactly which
 * permissions your roles resolve to. The reader, desk and admin experiences
 * replace it in later phases.
 */
export default async function AccountPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

  // Middleware redirects when the cookie is absent, but middleware cannot check
  // validity. This is the check that actually counts.
  if (!actor) redirect("/login?next=/account");

  // Ownership from the session, never from the request. There is no id in the
  // URL to tamper with here, and that is the point.
  const profile = await getOwnMemberCard();
  const account = await getOwnAccountSummary();
  const { settings } = await getCurrentLibrary();
  const timezone = settings.timezone;
  const permissions = [...actor.permissions].sort();

  return (
    <PublicShell branding={branding} signedIn>
      <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8">
        <div className="flex items-center gap-4">
          {/*
            The child's own card picture.

            Showing a child their own photograph is deliberate. It is a picture
            of them, they (or their parent) chose it, and it appears here and on
            the librarian's screen and nowhere else. Hiding it from its own
            subject would be strange to a nine-year-old and would protect
            nobody — the protection that matters is that no OTHER child can load
            these bytes, which /api/media/[id] enforces per request.
          */}
          <MemberAvatar
            avatarKey={profile?.avatarKey}
            photoUrl={profile?.photoMediaId ? `/api/media/${profile.photoMediaId}` : null}
            name={actor.displayName}
            size={72}
          />
          <div>
            <p className="text-lg font-bold text-accent-ink">Signed in</p>
            <h1 className="mt-1 text-4xl">Hello, {actor.displayName}! 👋</h1>
          </div>
        </div>

        {actor.mustSetPassword ? (
          <Callout tone="warn" title="Your account still needs a secret word" className="mt-6">
            An activation link was created for this account but a password has not been chosen yet.
          </Callout>
        ) : null}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Card tone="shelf">
            <CardTitle icon={<Icon name="card" />}>Your account</CardTitle>
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="font-bold text-ink">Kind</dt>
                <dd>{actor.kind === "STAFF" ? "Library staff" : "Reader"}</dd>

                {/*
                  The name, not the database key. This is the screen that tells
                  a volunteer what they are, and SUPER_ADMIN is an identifier
                  being shouted at somebody rather than an answer.
                */}
                <dt className="font-bold text-ink">Roles</dt>
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

                <dt className="font-bold text-ink">Signing in</dt>
                <dd>{account.email ?? account.username ?? "Ask a librarian"}</dd>
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

          <Card tone="shelf">
            <CardTitle icon={<Icon name="key" />}>What you can do</CardTitle>
            <CardBody>
              <p className="mb-3">
                These come from your roles in the database and are re-read on every request —
                nothing is cached in your browser.
              </p>
              {permissions.length > 0 ? (
                <ul className="grid gap-1.5 code text-base">
                  {permissions.map((permission) => (
                    <li key={permission}>
                      {permission}
                      {/*
                       * A few of these keys are seeded and read by nothing.
                       * This is the only screen that shows them, and a heading
                       * of "What you can do" above an inert permission is a
                       * promise the software does not keep — so it says so.
                       */}
                      {isDormantPermission(permission) ? (
                        <span className="ml-2 font-sans text-sm text-ink-soft">
                          — not in use yet
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No permissions.</p>
              )}
            </CardBody>
          </Card>
        </div>

        {/*
          Everything about the password in one place, including the two things
          somebody in trouble actually needs: where the email lands, and what to
          do when they cannot remember the current one. Both used to be
          discoverable only by signing out and finding the link on /login, which
          is a strange thing to ask of somebody who is already signed in.
        */}
        <Card tone="shelf" className="mt-6">
          <CardTitle icon={<Icon name="key" />}>Your secret word</CardTitle>
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
              <p>This account has not changed its secret word yet.</p>
            )}

            {account.recoveryEmail ? (
              <p className="mt-3">
                {account.recoveryIsGuardian
                  ? "If you ask for a reset link, it goes to the grown-up who signed you up — at "
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
                Change my secret word
              </ButtonLink>
              {account.recoveryEmail ? (
                <ButtonLink href="/forgot" variant="secondary" size="md" icon={<Icon name="mail" />}>
                  Email me a reset link
                </ButtonLink>
              ) : null}
            </div>

            <p className="mt-4 text-base">
              Whenever it changes, we send a note to that address so somebody always knows it
              happened. Changing it signs out every other device.
            </p>
          </CardBody>
        </Card>

        <div className="mt-10 flex flex-wrap gap-3">
          {/*
            The administrator's way back to their own library.
            
            This page renders the public shell, so before this existed somebody
            signing in as the owner landed here with no door to the desk at all
            and had to know the URL. Guarded by the same permission that guards
            the page it opens — a librarian and a reader do not hold it.
          */}
          {actor.permissions.has("user.manage_staff") ? (
            <ButtonLink href="/admin/staff" size="lg" icon={<Icon name="staff" />}>
              Staff
            </ButtonLink>
          ) : null}
          {actor.kind === "MEMBER" ? (
            <ButtonLink href="/my-books" size="lg" icon={<Icon name="shelf" />}>
              My books
            </ButtonLink>
          ) : null}
          {/* One primary action per row: Staff takes it when there is one. */}
          <ButtonLink
            href="/books"
            variant={
              actor.kind === "MEMBER" || actor.permissions.has("user.manage_staff")
                ? "secondary"
                : "primary"
            }
            size="lg"
            icon={<Icon name="search" />}
          >
            Find a book
          </ButtonLink>
        </div>

        <div className="mt-6">
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
    </PublicShell>
  );
}
