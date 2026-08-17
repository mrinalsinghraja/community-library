import type { Metadata } from "next";

import { ReviewActions } from "@/app/desk/registrations/review-actions";
import { MemberAvatar } from "@/components/library/avatar";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { ageInYears, formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listRegistrations } from "@/server/services/registration-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New members" };

/**
 * The librarian's registration queue.
 *
 * Shows only what the decision needs: who the child is, how old they are, which
 * flat, who the grown-up is and how to reach them, and whether consent was
 * given. Guardian contact details appear because approving a registration
 * requires `registration.review`, which implies `member.view_contact` for the
 * roles that hold it — the page still asks the service, never the template.
 */
export default async function RegistrationsPage() {
  // The real gate. Middleware only checked that a cookie exists.
  const actor = await requirePermissionForPage("registration.view", {
    signedOutTo: "/login?next=/desk/registrations",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const requests = await listRegistrations();

  return (
    <StaffShell
      branding={branding}
      actor={actor}
      pendingRegistrations={requests.length}
      title="New members"
    >
      {requests.length === 0 ? (
        <EmptyState illustration="🎈" title="All new readers are up to date">
          When a family fills in the join form, their registration appears here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {requests.map((request) => {
            const age = ageInYears(request.childDob, settings.timezone);
            const inRange = age >= settings.ageMin && age <= settings.ageMax;
            const hasAccountConsent = request.consents.some(
              (consent) => consent.type === "CHILD_ACCOUNT_CREATION" && consent.status === "GRANTED",
            );

            return (
              <Card key={request.id} tone="shelf">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  <MemberAvatar
                    avatarKey={request.avatarKey}
                    name={request.childName}
                    size={64}
                    className="shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl">{request.childName}</h2>
                      <StatusBadge tone={request.status === "PENDING" ? "soon" : "neutral"}>
                        {request.status === "PENDING" ? "New" : "Being reviewed"}
                      </StatusBadge>
                      <StatusBadge tone={inRange ? "available" : "late"}>
                        {age} years old
                      </StatusBadge>
                      <StatusBadge tone={hasAccountConsent ? "available" : "late"}>
                        {hasAccountConsent ? "Consent given" : "No consent"}
                      </StatusBadge>
                    </div>

                    <dl className="mt-4 grid gap-x-6 gap-y-2 text-base sm:grid-cols-2">
                      <div>
                        <dt className="font-bold text-ink">Flat</dt>
                        <dd className="text-ink-soft">{request.apartment}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-ink">Submitted</dt>
                        <dd className="text-ink-soft">
                          {formatInTimezone(request.submittedAt, settings.timezone, "d MMM yyyy, HH:mm")}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold text-ink">Parent or guardian</dt>
                        <dd className="text-ink-soft">{request.guardianName}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-ink">Contact</dt>
                        <dd className="break-words text-ink-soft">
                          {request.guardianEmail}
                          <br />
                          {request.guardianPhone}
                        </dd>
                      </div>
                    </dl>

                    {!inRange ? (
                      <p className="mt-4 rounded-lg bg-warn-wash px-3 py-2 text-base text-ink">
                        Outside the configured range of {settings.ageMin}–{settings.ageMax}.
                        Approving will be refused.
                      </p>
                    ) : null}
                  </div>

                  <div className="sm:w-64 sm:shrink-0">
                    <ReviewActions registrationId={request.id} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </StaffShell>
  );
}
