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

  return (
    <StaffShell branding={branding} actor={actor} title="Staff">
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          <DataTable headers={["Name", "Role", "Status", "Added", "Last signed in", "Actions"]}>
            {staff.map((person) => {
              const primaryRole = person.roleKeys.includes(ROLE_KEYS.SUPER_ADMIN)
                ? ROLE_KEYS.SUPER_ADMIN
                : ROLE_KEYS.LIBRARIAN;

              return (
                <tr key={person.id} className="border-t-2 border-hairline align-top">
                  <td className="px-4 py-3">
                    <p className="font-bold text-ink">{person.displayName}</p>
                    <p className="break-words text-base text-ink-soft">{person.email}</p>
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
                  </td>

                  <td className="px-4 py-3 text-base text-ink-soft">
                    {formatInTimezone(person.createdAt, settings.timezone, "d MMM yyyy")}
                  </td>

                  <td className="px-4 py-3 text-base text-ink-soft">
                    {person.lastLoginAt
                      ? formatInTimezone(person.lastLoginAt, settings.timezone, "d MMM yyyy")
                      : "Never"}
                  </td>

                  <td className="px-4 py-3">
                    <StaffRowActions
                      staffId={person.id}
                      status={person.status}
                      roleKey={primaryRole}
                      isSelf={person.id === actor.userId}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>

          <p className="mt-4 text-base text-ink-soft">
            The library&rsquo;s last active Super Admin cannot be suspended, closed or demoted —
            there must always be somebody who can let everyone else back in.
          </p>
        </div>

        <CreateStaffForm />
      </div>
    </StaffShell>
  );
}
