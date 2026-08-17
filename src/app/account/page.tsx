import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MemberAvatar } from "@/components/library/avatar";
import { PublicShell } from "@/components/layout/site-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Callout } from "@/components/ui/states";
import { signOutAction } from "@/server/actions/auth-actions";
import { getActor } from "@/server/authz";
import { getBrandingSafe } from "@/server/lib/settings";
import { getOwnMemberCard } from "@/server/services/account-service";

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
            <CardTitle icon="🪪">Your account</CardTitle>
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="font-bold text-ink">Kind</dt>
                <dd>{actor.kind === "STAFF" ? "Library staff" : "Reader"}</dd>

                <dt className="font-bold text-ink">Roles</dt>
                <dd className="flex flex-wrap gap-2">
                  {actor.roleKeys.length > 0 ? (
                    actor.roleKeys.map((role) => (
                      <StatusBadge key={role} tone="neutral">
                        {role}
                      </StatusBadge>
                    ))
                  ) : (
                    <span>No roles assigned</span>
                  )}
                </dd>
              </dl>
            </CardBody>
          </Card>

          <Card tone="shelf">
            <CardTitle icon="🔐">What you can do</CardTitle>
            <CardBody>
              <p className="mb-3">
                These come from your roles in the database and are re-read on every request —
                nothing is cached in your browser.
              </p>
              {permissions.length > 0 ? (
                <ul className="grid gap-1.5 font-mono text-base">
                  {permissions.map((permission) => (
                    <li key={permission}>{permission}</li>
                  ))}
                </ul>
              ) : (
                <p>No permissions.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/books" size="lg" icon="📚">
            Find a book
          </ButtonLink>
          <ButtonLink href="/account/password" variant="secondary" size="lg" icon="🔑">
            Change my secret word
          </ButtonLink>
        </div>

        <div className="mt-6">
          <form action={signOutAction}>
            <Button type="submit" variant="quiet" size="lg" icon="👋">
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
