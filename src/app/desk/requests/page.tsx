import type { Metadata } from "next";

import { DecisionActions } from "@/app/desk/requests/decision-actions";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import {
  countDeskLoans,
  countPendingRenewalRequests,
  listPendingBorrowRequests,
} from "@/server/services/circulation-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Books asked for" };

/**
 * The books children have asked for, waiting for a librarian.
 *
 * Guarded by `loan.issue` — the authority to give a book to a child, which is
 * exactly the authority to say yes to one of these. Not `loan.view`, which
 * every reader holds and which would put this list, with every asker's name on
 * it, in front of a nine-year-old.
 *
 * Each row carries what a decision needs: who asked, which book, when, and
 * whether the rules allow it today. Nothing about the family and no contact
 * details — a child asking for a picture book is not an occasion to show a
 * librarian somebody's phone number.
 */
export default async function DeskRequestsPage() {
  const actor = await requirePermissionForPage("loan.issue", {
    signedOutTo: "/login?next=/desk/requests",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const [requests, loans, renewals] = await Promise.all([
    listPendingBorrowRequests(),
    countDeskLoans(),
    countPendingRenewalRequests(),
  ]);

  return (
    <StaffShell
      branding={branding}
      actor={actor}
      overdueLoans={loans.overdue}
      pendingRenewals={renewals}
      pendingBorrowRequests={requests.length}
      title="Books asked for"
    >
      <p className="text-base text-ink-soft">
        {requests.length === 0
          ? "Nothing waiting."
          : requests.length === 1
            ? "One reader has asked for a book."
            : `${requests.length} readers have asked for a book.`}
      </p>

      <div className="mt-6">
        {requests.length === 0 ? (
          <EmptyState
            illustration={<Icon name="book" />}
            title="No one is waiting"
            action={
              <ButtonLink href="/desk/circulation" variant="secondary" icon={<Icon name="book" />}>
                Give a book out
              </ButtonLink>
            }
          >
            When a reader finds a book in the catalogue and asks for it, it appears here. Saying yes
            gives the book out, exactly as the desk does — then hand it over in the library room.
          </EmptyState>
        ) : (
          <DataTable headers={["Reader", "Book", "Book ID", "Asked", "Answer"]}>
            {requests.map((request) => (
              <tr key={request.requestId} className="border-t-2 border-hairline align-top">
                <td className="px-3.5 py-2.5 align-top">
                  <p className="font-bold text-ink">{request.readerName}</p>
                  <p className="code text-base text-ink-soft">{request.memberCode}</p>
                </td>

                <td className="px-3.5 py-2.5 align-top">
                  <div className="flex items-start gap-3">
                    <span className="w-11 shrink-0">
                      <CoverThumbnail
                        coverMediaId={request.coverMediaId}
                        title={request.title}
                        variant="thumb"
                        sizes="44px"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{request.title}</p>
                      {/*
                        The rule, in the row. A librarian who can see why a
                        request cannot be granted can tell the child; one who
                        only finds a greyed-out button has to guess.
                      */}
                      {request.blockedReason ? (
                        <p className="mt-1 text-base font-bold text-danger">
                          {request.blockedReason}
                        </p>
                      ) : (
                        <StatusBadge tone="available">Ready to give out</StatusBadge>
                      )}
                    </div>
                  </div>
                </td>

                <td className="px-3.5 py-2.5 align-top code">{request.copyCode}</td>

                <td className="px-3.5 py-2.5 align-top text-ink-soft">
                  {formatInTimezone(request.requestedAt, settings.timezone)}
                </td>

                <td className="px-3.5 py-2.5 align-top">
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
