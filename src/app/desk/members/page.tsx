import type { Metadata } from "next";
import Link from "next/link";

import { MemberActions } from "@/app/desk/members/member-actions";
import { PhotoActions } from "@/app/desk/members/photo-actions";
import { MemberAvatar } from "@/components/library/avatar";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ageInYears, formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listMembers } from "@/server/services/account-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Readers" };

/**
 * The reader list.
 *
 * Guardian contact details are stripped by the *service* when the actor lacks
 * `member.view_contact` — this page renders whatever it is given, so a future
 * role that should not see phone numbers gets nulls rather than relying on a
 * template remembering to check.
 */

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "available",
  INVITED: "soon",
  SUSPENDED: "late",
  DEACTIVATED: "out",
  ARCHIVED: "out",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INVITED: "Waiting to set up",
  SUSPENDED: "Paused",
  DEACTIVATED: "Closed",
  ARCHIVED: "Archived",
};

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; deleted?: string }>;
}) {
  const actor = await requirePermissionForPage("member.view", {
    signedOutTo: "/login?next=/desk/members",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const { q, deleted } = await searchParams;

  const members = await listMembers({ search: q });
  const canSeeContact = actor.permissions.has("member.view_contact");
  const canManagePhoto = actor.permissions.has("member.manage_photo");

  return (
    <StaffShell branding={branding} actor={actor} title="Readers">
      {/* Set by the redirect after a permanent deletion. The reader's own page
          no longer exists to say it on. */}
      {deleted ? (
        <p
          role="status"
          className="mb-6 rounded-[var(--radius-field)] bg-success-wash px-5 py-4 text-base font-bold text-ink"
        >
          {deleted}&rsquo;s account has been deleted.
        </p>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field id="q" label="Find a reader" hint="By name or library card number.">
            <TextInput id="q" name="q" defaultValue={q ?? ""} autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" size="md">
          Search
        </Button>
      </form>

      {members.length === 0 ? (
        <EmptyState illustration={<Icon name="card" />} title={q ? "No readers match that" : "No readers yet"}>
          {q
            ? "Try part of a name, or a card number."
            : "Approved registrations appear here as library cards."}
        </EmptyState>
      ) : (
        <DataTable
          headers={
            canSeeContact
              ? ["Reader", "Card", "Flat", "Status", "Last signed in", "Guardian", "Actions"]
              : ["Reader", "Card", "Flat", "Status", "Last signed in", "Actions"]
          }
        >
          {members.map((member) => (
            <tr key={member.id} className="border-t-2 border-hairline align-top">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <MemberAvatar
                    avatarKey={member.memberProfile?.avatarKey}
                    photoUrl={
                      member.memberProfile?.photoMediaId
                        ? `/api/media/${member.memberProfile.photoMediaId}`
                        : null
                    }
                    name={member.displayName}
                    size={40}
                  />
                  <div>
                    {/* The whole record, for whoever is allowed to see it. */}
                    <Link href={`/desk/members/${member.id}`} className="font-bold text-ink">
                      {member.displayName}
                    </Link>
                    {member.memberProfile?.dateOfBirth ? (
                      <p className="text-base text-ink-soft">
                        {ageInYears(member.memberProfile.dateOfBirth, settings.timezone)} years old
                      </p>
                    ) : null}
                  </div>
                </div>
              </td>

              <td className="px-4 py-3 font-mono text-base text-ink-soft">
                {member.memberProfile?.memberCode ?? "—"}
              </td>

              <td className="px-4 py-3 text-ink-soft">{member.memberProfile?.apartment ?? "—"}</td>

              <td className="px-4 py-3">
                <StatusBadge tone={STATUS_TONE[member.status] ?? "neutral"}>
                  {STATUS_LABEL[member.status] ?? member.status}
                </StatusBadge>
              </td>

              <td className="px-4 py-3 text-base text-ink-soft">
                {member.lastLoginAt
                  ? formatInTimezone(member.lastLoginAt, settings.timezone, "d MMM yyyy")
                  : "Never"}
              </td>

              {canSeeContact ? (
                <td className="px-4 py-3 text-base text-ink-soft">
                  {member.guardianLinks.map((link) => (
                    <div key={link.guardian.id} className="break-words">
                      <p className="font-bold text-ink">{link.guardian.fullName}</p>
                      <p>{link.guardian.email}</p>
                      <p>{link.guardian.phone}</p>
                    </div>
                  ))}
                </td>
              ) : null}

              <td className="px-4 py-3">
                <MemberActions
                  memberId={member.id}
                  status={member.status}
                  canSuspend={actor.permissions.has("member.suspend")}
                  canDeactivate={actor.permissions.has("member.deactivate")}
                  canReissue={actor.permissions.has("member.reset_password")}
                />
                {canManagePhoto ? (
                  <div className="mt-2">
                    <PhotoActions
                      memberId={member.id}
                      hasPhoto={Boolean(member.memberProfile?.photoMediaId)}
                    />
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </StaffShell>
  );
}
