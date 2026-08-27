import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MemberAvatar } from "@/components/library/avatar";
import { PublicShell } from "@/components/layout/site-shell";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { describeCapabilities } from "@/lib/permissions";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnMemberCard } from "@/server/services/account-service";
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
  const { settings } = await getCurrentLibrary();

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
          <Callout tone="warn" title="Your account still needs a password" className="mt-6">
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
        <nav aria-label="Where to next" className="mt-10 grid gap-4 sm:grid-cols-2">
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
          <QuickDoor
            href="/account/details"
            icon="settings"
            title="Account details"
            body="Your details, your password, and signing out."
          />
        </nav>

        {/* ---------------------------------------------------------------- */}
        {/* What this person can do                                           */}
        {/*                                                                   */}
        {/* The account's own settings — the details on file, the password and */}
        {/* the way out — used to run on down this page under here. They are   */}
        {/* on /account/details now: a landing page is for going somewhere,    */}
        {/* and almost nobody arrives here to edit a phone number.             */}
        {/* ---------------------------------------------------------------- */}
        <Card tone="shelf" className="mt-8">
          <CardTitle icon={<Icon name="key" />}>What you can do</CardTitle>
          <CardBody>
            {/*
              Sentences grouped by what they are about, from the same
              `PERMISSIONS` table the server checks — so this cannot drift from
              what the software will actually let this person do. It just says
              it in English.
            */}
            {capabilities.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
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
