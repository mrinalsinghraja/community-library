import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MemberAvatar } from "@/components/library/avatar";
import { PublicShell } from "@/components/layout/site-shell";
import { StaffShell } from "@/components/layout/staff-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Callout } from "@/components/ui/states";
import { formatInTimezone } from "@/lib/dates";
import { describeCapabilities, roleDescription, roleLabel } from "@/lib/permissions";
import { signOutAction } from "@/server/actions/auth-actions";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnAccountSummary, getOwnMemberCard } from "@/server/services/account-service";
import { getOwnProfile } from "@/server/services/profile-change-service";
import { ProfileForm } from "@/app/account/profile-form";
import { ageStage, LIFECYCLE_MESSAGES } from "@/lib/account-lifecycle";
import { Icon, type IconName } from "@/components/ui/icon";

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
  const memberBirthYear = profile?.birthYear ?? null;
  const account = await getOwnAccountSummary();
  // Null for staff, who hold no library card and have nothing to correct here.
  const ownProfile = await getOwnProfile();
  const { settings } = await getCurrentLibrary();
  const timezone = settings.timezone;

  /*
   * Whether this reader is in their last year inside the library's range.
   *
   * Computed here rather than stored, because it changes on 1 January without
   * anybody touching the row — and a stored flag would need a job to keep it
   * true, which is a job that can fail silently.
   */
  const growingUp =
    memberBirthYear !== null &&
    ageStage(memberBirthYear, settings.ageMax, new Date().getUTCFullYear()) === "lastYear";
  /*
   * What this person can do, in sentences.
   *
   * This used to be `[...actor.permissions].sort()` rendered as a monospace
   * column of keys — `loan.request_renewal` and friends — on the page every
   * signed-in person lands on. It read as a debugging view because that is
   * what it was: this page's original job was proving the RBAC model resolved.
   * The model still resolves; it no longer has to be shouted at a child.
   */
  const capabilities = describeCapabilities(
    [...actor.permissions],
    actor.kind === "MEMBER" ? "reader" : "staff",
  );

  /*
   * Staff get the desk's shell, readers get the reader's.
   *
   * This page was the seam where a librarian's navigation visibly changed. It
   * is the only screen staff reach that lives on the reader side, so signing in
   * as Super Admin and opening your own account swapped the desk's menu for the
   * children's masthead. Choosing the shell by `kind` means a role now sees one
   * menu everywhere without either shell having to grow a special case for this
   * page. See ADR-059.
   */
  const Shell = actor.kind === "STAFF" ? StaffShell : PublicShell;

  return (
    <Shell branding={branding} actor={actor} title="My library">
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
            {/*
              The eyebrow says where you are, not that you are authenticated.
              "Signed in" is a status the masthead already carries; on the page
              itself it was the loudest thing above a child's own name.
            */}
            <p className="text-lg font-bold text-accent-ink">
              {actor.kind === "STAFF" ? "Library staff" : "My library"}
            </p>
            <h1 className="mt-1 text-4xl">Hello, {actor.displayName}! 👋</h1>
          </div>
        </div>

        {/*
          The quiet note in the corner, during the year a reader might pass the
          top of the library's range.

          Deliberately not a warning and deliberately not an email. Nothing
          changes on the day it appears, the reader has done nothing wrong, and
          the next step is a conversation with a person rather than an action in
          software. It shows for a year before anything is closed — see
          `ageStage` for why the two edges are drawn where they are.
        */}
        {growingUp ? (
          <Callout tone="info" title={LIFECYCLE_MESSAGES.growingUpTitle} className="mt-6">
            {LIFECYCLE_MESSAGES.growingUp(settings.ageMin, settings.ageMax)}
          </Callout>
        ) : null}

        {actor.mustSetPassword ? (
          <Callout tone="warn" title="Your account still needs a secret word" className="mt-6">
            An activation link was created for this account but a password has not been chosen yet.
          </Callout>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* The doors, first                                                  */}
        {/*                                                                   */}
        {/* A person who has just signed in is going somewhere. This card used */}
        {/* to be three buttons at the very bottom of the page, under the      */}
        {/* password panel and a column of permission keys — so the one thing  */}
        {/* everybody wanted was the last thing they could reach.              */}
        {/* ---------------------------------------------------------------- */}
        <nav aria-label="Where to next" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {actor.kind === "STAFF" ? (
            <QuickDoor
              href="/desk"
              icon="staff"
              title="The library desk"
              body="Issue and take back books, answer asks, and see what is waiting today."
            />
          ) : (
            <QuickDoor
              href="/my-books"
              icon="shelf"
              title="My books"
              body="What you have at home, when each one is due, and what to read next."
            />
          )}
          <QuickDoor
            href="/books"
            icon="search"
            title="Find a book"
            body="Every book on our shelves. Search, or sort by what readers love most."
          />
          {actor.kind === "MEMBER" ? (
            <QuickDoor
              href="/my-card"
              icon="card"
              title="My library card"
              body="Your card, ready to show at the desk or print at home."
            />
          ) : (
            <QuickDoor
              href="/admin/books"
              icon="book"
              title="The book list"
              body="Add a book, edit its details, or print a fresh label."
            />
          )}
        </nav>

        {/* ---------------------------------------------------------------- */}
        {/* Who the library thinks you are                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Card tone="shelf">
            <CardTitle icon={<Icon name="card" />}>Your account</CardTitle>
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
                  is what this says. It used to fall through to "Ask a
                  librarian" for every child, because children hold neither an
                  email address nor a username — the field was answering a staff
                  question on a child's page.
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

          <Card tone="shelf">
            <CardTitle icon={<Icon name="key" />}>What you can do</CardTitle>
            <CardBody>
              {/*
                Sentences grouped by what they are about, from the same
                `PERMISSIONS` table the server checks — so this cannot drift
                from what the software will actually let this person do. It
                just says it in English.
              */}
              {capabilities.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {capabilities.map((group) => (
                    <div key={group.category}>
                      <h3 className="text-base font-bold uppercase tracking-[0.1em] text-ink-soft">
                        {group.label}
                      </h3>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {group.items.map((item) => (
                          <li key={item} className="flex items-start gap-2 text-base">
                            <span aria-hidden="true" className="mt-1 text-accent-ink">
                              <Icon name="check" />
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p>Nothing yet. A librarian can give this account what it needs.</p>
              )}

              <p className="mt-4 border-t border-hairline pt-3 text-base text-ink-soft">
                This comes from your roles and is re-read on every request — nothing about what you
                are allowed to do is kept in your browser.
              </p>
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
        {ownProfile ? <ProfileForm profile={ownProfile} /> : null}

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

/**
 * One door out of this page.
 *
 * A card rather than a button because the label alone is not enough: "My
 * books" and "Find a book" are both true of half the site, and a volunteer
 * signing in for the first time needs the sentence under the heading more than
 * the heading. The whole card is the link, so there is no small target.
 */
function QuickDoor({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: IconName;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="lift group flex h-full flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-5 no-underline shadow-lift"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-accent-wash text-accent-ink">
        <Icon name={icon} />
      </span>
      <span className="font-display text-xl font-bold text-ink group-hover:text-accent-ink">
        {title}
      </span>
      <span className="text-base text-ink-soft">{body}</span>
      <span className="mt-auto flex items-center gap-1.5 pt-2 text-base font-bold text-primary-deep">
        Open
        <Icon name="arrowRight" />
      </span>
    </Link>
  );
}
