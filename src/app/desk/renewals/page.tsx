import type { Metadata } from "next";

import { DecisionActions } from "@/app/desk/renewals/decision-actions";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import {
  countDeskLoans,
  listPendingRenewalRequests,
} from "@/server/services/circulation-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Asks to keep" };

/**
 * The questions children have asked, waiting for an answer.
 *
 * Guarded by `loan.renew`, which is the authority to extend a loan — and so is
 * exactly the authority to say yes to one of these. Not `loan.view`, which
 * every reader holds and which would put this list, with every borrower's name
 * on it, in front of a nine-year-old.
 *
 * Each row carries the four things a decision needs: who, which book, when it
 * is due now, and whether the rules allow it. Nothing about the family, no
 * contact details, no account status — a request to keep a book for a fortnight
 * is not an occasion to show a librarian somebody's phone number.
 */
export default async function DeskRenewalsPage() {
  const actor = await requirePermissionForPage("loan.renew", {
    signedOutTo: "/login?next=/desk/renewals",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const [requests, loans] = await Promise.all([
    listPendingRenewalRequests(),
    countDeskLoans(),
  ]);

  return (
    <StaffShell
      branding={branding}
      actor={actor}
      overdueLoans={loans.overdue}
      pendingRenewals={requests.length}
      title="Asks to keep"
    >
      <p className="text-base text-ink-soft">
        {requests.length === 0
          ? "Nothing waiting."
          : requests.length === 1
            ? "One reader has asked to keep a book longer."
            : `${requests.length} readers have asked to keep a book longer.`}
      </p>

      <div className="mt-6">
        {requests.length === 0 ? (
          <EmptyState
            illustration="📖"
            title="No one is asking"
            action={
              <ButtonLink href="/desk/loans" variant="secondary" icon="📕">
                See what is out
              </ButtonLink>
            }
          >
            When a reader asks to keep a book for longer, it appears here for you to say yes or no.
          </EmptyState>
        ) : (
          <DataTable headers={["Reader", "Book", "Book ID", "Due now", "Asked", "Answer"]}>
            {requests.map((request) => (
              <tr key={request.requestId} className="border-t-2 border-hairline align-top">
                <td className="px-4 py-3">
                  <p className="font-bold text-ink">{request.readerName}</p>
                  <p className="font-mono text-base text-ink-soft">{request.memberCode}</p>
                </td>

                <td className="px-4 py-3">
                  <p className="font-bold text-ink">{request.title}</p>
                  {request.renewalCount > 0 ? (
                    <p className="text-base text-ink-soft">
                      {request.renewalCount === 1
                        ? "kept longer once already"
                        : `kept longer ${request.renewalCount} times already`}
                    </p>
                  ) : null}
                </td>

                <td className="px-4 py-3 font-mono">{request.copyCode}</td>

                <td className="px-4 py-3">
                  <span className="text-ink">
                    {formatInTimezone(request.dueAt, settings.timezone)}
                  </span>
                  {/*
                    The rule, in the row. A librarian who can see why a request
                    cannot be granted can tell the child; one who only finds a
                    greyed-out button has to guess.
                  */}
                  {request.blockedReason ? (
                    <p className="mt-1 text-base font-bold text-danger">{request.blockedReason}</p>
                  ) : (
                    <StatusBadge tone="available">Can be extended</StatusBadge>
                  )}
                </td>

                <td className="px-4 py-3 text-ink-soft">
                  {formatInTimezone(request.requestedAt, settings.timezone)}
                </td>

                <td className="px-4 py-3">
                  <DecisionActions
                    requestId={request.requestId}
                    readerName={request.readerName}
                    title={request.title}
                    canApprove={request.blockedReason === null}
                  />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </StaffShell>
  );
}
