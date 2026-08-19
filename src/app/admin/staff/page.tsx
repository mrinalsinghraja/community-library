import type { Metadata } from "next";

import { CreateStaffForm, StaffRowActions } from "@/app/admin/staff/staff-forms";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { ROLE_KEYS } from "@/lib/permissions";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listStaff } from "@/server/services/staff-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff" };

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "available",
  INVITED: "soon",
  SUSPENDED: "late",
  DEACTIVATED: "out",
  ARCHIVED: "out",
};

/**
 * Staff management, Super Admin only.
 *
 * There is no password column and no way to set one — the only power an
 * administrator has over someone else's password is to cause a fresh link to
 * be emailed to them.
 */
export default async function StaffPage() {
  const actor = await requirePermissionForPage("user.manage_staff", {
    signedOutTo: "/login?next=/admin/staff",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const staff = await listStaff();
  // Super Admin only, and refused again by `deleteStaffAccount`.
  const canDelete = actor.permissions.has("user.delete");

  return (
    <StaffShell branding={branding} actor={actor} title="Staff">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/*
          `minmax(0, 1fr)`, not `1fr`. A grid track sized `1fr` still refuses to
          go below its content's automatic minimum, and this one contains a
          table with a 46rem floor — which pushed the whole second column off
          the right of the page. The table is meant to scroll inside its own
          container; the page is never meant to.
        */}
        <div className="min-w-0">
          {/* The columns the brief asks for, in that order. "Last signed in"
              rides under Status rather than taking a seventh column: on a
              narrow desk screen the table already scrolls. */}
          <DataTable headers={["Name", "Email", "Role", "Status", "Added", "Actions"]}>
            {staff.map((person) => {
              const primaryRole = person.roleKeys.includes(ROLE_KEYS.SUPER_ADMIN)
                ? ROLE_KEYS.SUPER_ADMIN
                : ROLE_KEYS.LIBRARIAN;

              return (
                <tr key={person.id} className="border-t-2 border-hairline align-top">
                  <td className="px-4 py-3">
                    <p className="font-bold text-ink">{person.displayName}</p>
                  </td>

                  <td className="px-4 py-3 text-base text-ink-soft">
                    <span className="break-words">{person.email}</span>
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge tone={primaryRole === ROLE_KEYS.SUPER_ADMIN ? "neutral" : "out"}>
                      {primaryRole === ROLE_KEYS.SUPER_ADMIN ? "Super Admin" : "Librarian"}
                    </StatusBadge>
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge tone={STATUS_TONE[person.status] ?? "neutral"}>
                      {person.status === "INVITED" ? "Not set up yet" : person.status}
                    </StatusBadge>
                    <p className="mt-1 text-base text-ink-soft">
                      {person.lastLoginAt
                        ? `Last signed in ${formatInTimezone(person.lastLoginAt, settings.timezone, "d MMM yyyy")}`
                        : "Never signed in"}
                    </p>
                  </td>

                  <td className="px-4 py-3 text-base text-ink-soft">
                    {formatInTimezone(person.createdAt, settings.timezone, "d MMM yyyy")}
                  </td>

                  <td className="px-4 py-3">
                    <StaffRowActions
                      staffId={person.id}
                      displayName={person.displayName}
                      status={person.status}
                      mustSetPassword={person.mustSetPassword}
                      invitationEmailSent={person.invitationEmailSent}
                      isSelf={person.id === actor.userId}
                      canDelete={canDelete}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>

          <p className="mt-4 text-base text-ink-soft">
            Everyone added here is a Librarian. The library has one Super Admin, and there is no
            screen that makes a second — the last active Super Admin cannot be suspended or closed
            either, because there must always be somebody who can let everyone else back in.
          </p>
        </div>

        <CreateStaffForm />
      </div>
    </StaffShell>
  );
}
