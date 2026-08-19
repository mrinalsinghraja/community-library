import type { Metadata } from "next";
import Link from "next/link";

import { StaffShell } from "@/components/layout/staff-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { requireAnyPermissionForPage } from "@/server/page-guards";
import { getBrandingSafe } from "@/server/lib/settings";
import { countPendingRegistrations } from "@/server/services/registration-service";
import {
  countDeskLoans,
  countPendingBorrowRequests,
  countPendingRenewalRequests,
} from "@/server/services/circulation-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library desk" };

/**
 * The desk landing page: what needs somebody today.
 *
 * Every card is behind the permission that its screen requires, so a role that
 * cannot issue books does not see a door to issuing them. That is a courtesy,
 * not the control — each page behind these links calls requirePermission again.
 */
export default async function DeskPage() {
  const actor = await requireAnyPermissionForPage(
    ["registration.view", "member.view", "user.manage_staff", "loan.issue", "loan.return"],
    { signedOutTo: "/login?next=/desk" },
  );
  const branding = await getBrandingSafe();

  const pending = actor.permissions.has("registration.view")
    ? await countPendingRegistrations()
    : 0;

  // Counted only for somebody who works the desk. The count itself is derived —
  // `status = 'ACTIVE' AND due_at < now()` — never read from a stored flag.
  const loans =
    actor.permissions.has("loan.return") || actor.permissions.has("loan.issue")
      ? await countDeskLoans()
      : { active: 0, overdue: 0 };

  // Children waiting for an answer. Counted only for whoever can give one.
  const renewalAsks = actor.permissions.has("loan.renew")
    ? await countPendingRenewalRequests()
    : 0;

  // Children waiting for a book. Same rule: counted only for whoever can hand
  // one over, because `loan.issue` is what answering these actually is.
  const borrowAsks = actor.permissions.has("loan.issue")
    ? await countPendingBorrowRequests()
    : 0;

  return (
    <StaffShell
      branding={branding}
      actor={actor}
      pendingRegistrations={pending}
      overdueLoans={loans.overdue}
      pendingRenewals={renewalAsks}
      pendingBorrowRequests={borrowAsks}
      title="Library desk"
    >
      <p className="text-lg text-ink-soft">
        Hello {actor.displayName}. Here is what needs you today.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {actor.permissions.has("loan.return") ? (
          <Link href="/desk/loans" className="no-underline">
            <Card tone={loans.overdue > 0 ? "shelf" : "plain"} className="h-full">
              <CardTitle icon={<Icon name="book" />}>Books out</CardTitle>
              <CardBody>
                <p className="font-display text-5xl font-extrabold text-ink">{loans.active}</p>
                <p className="mt-1">
                  {loans.overdue === 0
                    ? loans.active === 0
                      ? "Everything is on the shelf."
                      : "All within their dates."
                    : loans.overdue === 1
                      ? "One is past its date."
                      : `${loans.overdue} are past their date.`}
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}

        {actor.permissions.has("loan.issue") ? (
          <Link href="/desk/requests" className="no-underline">
            <Card tone={borrowAsks > 0 ? "shelf" : "plain"} className="h-full">
              <CardTitle icon={<Icon name="shelf" />}>Books asked for</CardTitle>
              <CardBody>
                <p className="font-display text-5xl font-extrabold text-ink">{borrowAsks}</p>
                <p className="mt-1">
                  {borrowAsks === 0
                    ? "No one is waiting."
                    : borrowAsks === 1
                      ? "A reader is waiting for a book."
                      : `${borrowAsks} readers are waiting for a book.`}
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}

        {actor.permissions.has("loan.renew") ? (
          <Link href="/desk/renewals" className="no-underline">
            <Card tone={renewalAsks > 0 ? "shelf" : "plain"} className="h-full">
              <CardTitle icon={<Icon name="renew" />}>Asks to keep</CardTitle>
              <CardBody>
                <p className="font-display text-5xl font-extrabold text-ink">{renewalAsks}</p>
                <p className="mt-1">
                  {renewalAsks === 0
                    ? "No one is asking."
                    : renewalAsks === 1
                      ? "A reader is waiting to hear back."
                      : `${renewalAsks} readers are waiting to hear back.`}
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}

        {actor.permissions.has("registration.view") ? (
          <Link href="/desk/registrations" className="no-underline">
            <Card tone={pending > 0 ? "shelf" : "plain"} className="h-full">
              <CardTitle icon={<Icon name="reader" />}>New members</CardTitle>
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
              <CardTitle icon={<Icon name="card" />}>Readers</CardTitle>
              <CardBody>Find a reader, pause an account, or send a fresh sign-in link.</CardBody>
            </Card>
          </Link>
        ) : null}

        {actor.permissions.has("user.manage_staff") ? (
          <Link href="/admin/staff" className="no-underline">
            <Card className="h-full">
              <CardTitle icon={<Icon name="staff" />}>Staff</CardTitle>
              <CardBody>Add a librarian, or pause an account.</CardBody>
            </Card>
          </Link>
        ) : null}
      </div>

      {actor.permissions.has("loan.issue") ? (
        <Card tone="sunk" className="mt-8">
          <CardTitle icon={<Icon name="shelf" />} as="h3">
            Someone at the desk?
          </CardTitle>
          <CardBody>
            <p>Find the reader, find the book, check the date, hand it over.</p>
            <div className="mt-4">
              <ButtonLink href="/desk/circulation" size="lg" icon={<Icon name="shelf" />}>
                Issue a book
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </StaffShell>
  );
}
