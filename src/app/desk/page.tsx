import type { Metadata } from "next";
import Link from "next/link";

import { StaffShell } from "@/components/layout/staff-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAnyPermissionForPage } from "@/server/page-guards";
import { getBrandingSafe } from "@/server/lib/settings";
import { countPendingRegistrations } from "@/server/services/registration-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library desk" };

/**
 * The desk landing page.
 *
 * Phase 1 shows the identity work only — registrations, readers, staff. The
 * circulation cards (books out, overdue, quick issue) arrive with Phase 4.
 */
export default async function DeskPage() {
  const actor = await requireAnyPermissionForPage(
    ["registration.view", "member.view", "user.manage_staff"],
    { signedOutTo: "/login?next=/desk" },
  );
  const branding = await getBrandingSafe();

  const pending = actor.permissions.has("registration.view")
    ? await countPendingRegistrations()
    : 0;

  return (
    <StaffShell branding={branding} actor={actor} pendingRegistrations={pending} title="Library desk">
      <p className="text-lg text-ink-soft">
        Hello {actor.displayName}. Here is what needs you today.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {actor.permissions.has("registration.view") ? (
          <Link href="/desk/registrations" className="no-underline">
            <Card tone={pending > 0 ? "shelf" : "plain"} className="h-full">
              <CardTitle icon="🙋">New members</CardTitle>
              <CardBody>
                <p className="font-display text-5xl font-extrabold text-ink">{pending}</p>
                <p className="mt-1">
                  {pending === 0
                    ? "Nothing waiting."
                    : pending === 1
                      ? "One family is waiting to hear from us."
                      : `${pending} families are waiting to hear from us.`}
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}

        {actor.permissions.has("member.view") ? (
          <Link href="/desk/members" className="no-underline">
            <Card className="h-full">
              <CardTitle icon="📇">Readers</CardTitle>
              <CardBody>Find a reader, pause an account, or send a fresh sign-in link.</CardBody>
            </Card>
          </Link>
        ) : null}

        {actor.permissions.has("user.manage_staff") ? (
          <Link href="/admin/staff" className="no-underline">
            <Card className="h-full">
              <CardTitle icon="🛠️">Staff</CardTitle>
              <CardBody>Add a librarian, change a role, or suspend an account.</CardBody>
            </Card>
          </Link>
        ) : null}
      </div>

      <Card tone="sunk" className="mt-8">
        <CardTitle icon="📚" as="h3">
          Books arrive next
        </CardTitle>
        <CardBody>
          The catalogue, issuing and returning are the next phase. Right now this desk handles
          people: registrations, readers and staff.
        </CardBody>
      </Card>
    </StaffShell>
  );
}
