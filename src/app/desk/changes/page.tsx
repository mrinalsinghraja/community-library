import type { Metadata } from "next";
import Link from "next/link";

import { ChangeDecision } from "@/app/desk/changes/decision";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { Icon } from "@/components/ui/icon";
import { Callout, EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listProfileChanges } from "@/server/services/profile-change-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Detail changes" };

/**
 * Corrections readers have asked for.
 *
 * Guarded by `profile_change.review`, which the Super Admin holds alone. The
 * separation from `member.edit` is the point: a librarian correcting a misspelt
 * name is ordinary desk work, while approving what a *child* proposed for their
 * own guardian's email address moves the account's recovery path to a different
 * inbox.
 *
 * Every row shows the current value beside the proposed one. A screen that
 * rendered only what was asked for would send the reviewer to another tab to
 * find out what it replaces, and a reviewer who does that twenty times stops
 * doing it and starts pressing Apply.
 *
 * Nothing on this page has changed anything yet. That is the whole reason the
 * queue exists — see src/lib/profile-changes.ts.
 */
export default async function DeskChangesPage() {
  const actor = await requirePermissionForPage("profile_change.review", {
    signedOutTo: "/login?next=/desk/changes",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const changes = await listProfileChanges();
  const waiting = changes.filter((change) => change.status === "PENDING");

  return (
    <StaffShell branding={branding} actor={actor} title="Detail changes">
      <p className="text-base text-ink-soft">
        {changes.length === 0
          ? "No reader has asked for a correction yet."
          : waiting.length === 0
            ? "Nothing waiting."
            : `${waiting.length === 1 ? "1 reader is" : `${waiting.length} readers are`} waiting for you.`}
      </p>

      {waiting.length > 0 ? (
        <Callout tone="info" title="Nothing has changed yet" className="mt-5">
          A reader can ask for their details to be corrected, and what they typed sits here until
          you say yes. Applying writes it to the record; sending it back shows them your note and
          they can try again.
        </Callout>
      ) : null}

      <div className="mt-6">
        {changes.length === 0 ? (
          <EmptyState illustration={<Icon name="reader" />} title="Nothing to check">
            When a reader corrects something on their own account page, it appears here first.
          </EmptyState>
        ) : (
          <DataTable headers={["Reader", "What they are asking for", "Their note", "When", "", ""]}>
            {changes.map((change) => (
              <tr key={change.id} className="border-t-2 border-hairline align-top">
                <td className="px-3.5 py-2.5 align-top">
                  <Link
                    href={`/desk/members/${change.memberUserId}`}
                    className="font-bold text-primary-deep"
                  >
                    {change.memberName}
                  </Link>
                  {change.memberCode ? (
                    <p className="code text-base text-ink-soft">{change.memberCode}</p>
                  ) : null}
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <ul className="flex list-none flex-col gap-1.5 p-0">
                    {change.diff.map((entry) => (
                      <li key={entry.key} className="text-base">
                        <span className="font-semibold text-ink">{entry.label}</span>
                        <br />
                        <span className="text-ink-soft line-through">{entry.from || "—"}</span>
                        {" → "}
                        <span className="font-semibold text-ink">{entry.to}</span>
                      </li>
                    ))}
                  </ul>
                </td>

                <td className="max-w-xs px-3.5 py-2.5 align-top text-base text-ink-soft">
                  {change.note ?? "—"}
                  {change.decisionNote ? (
                    <p className="mt-1.5 text-sm">Sent back: &ldquo;{change.decisionNote}&rdquo;</p>
                  ) : null}
                </td>

                <td className="whitespace-nowrap px-3.5 py-2.5 align-top text-base text-ink-soft">
                  {formatInTimezone(change.createdAt, settings.timezone, "d MMM yyyy")}
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <ChangeStatusBadge status={change.status} />
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  {change.status === "PENDING" ? (
                    <ChangeDecision
                      requestId={change.id}
                      memberName={change.memberName}
                      affectsRecovery={change.diff.some((entry) => entry.affectsRecovery)}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </StaffShell>
  );
}

/** Where a request stands, in a word and never in a colour alone. */
function ChangeStatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") {
    return (
      <StatusBadge tone="available">
        <Icon name="check" /> Applied
      </StatusBadge>
    );
  }
  if (status === "REJECTED") {
    return (
      <StatusBadge tone="neutral">
        <Icon name="cross" /> Sent back
      </StatusBadge>
    );
  }
  if (status === "WITHDRAWN") {
    return (
      <StatusBadge tone="neutral">
        <Icon name="cross" /> Taken back
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="soon">
      <Icon name="info" /> Waiting
    </StatusBadge>
  );
}
