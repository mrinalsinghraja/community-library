import type { Metadata } from "next";

import { ReviewActions } from "@/app/desk/registrations/review-actions";
import { MemberAvatar } from "@/components/library/avatar";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { ageInYears, formatInTimezone } from "@/lib/dates";
import {
  DEVELOPMENT_VERIFICATION_WARNING,
  METHOD_LABELS,
  STRENGTH_LABELS,
  isDevelopmentVerificationMode,
} from "@/lib/guardian-verification";
import { CONSENT_LABELS, CURRENT_CONSENT_TYPES, REQUIRED_CONSENT_TYPES } from "@/lib/consent";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listRegistrations } from "@/server/services/registration-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New members" };

/**
 * The registration queue.
 *
 * Shows the whole submission, because the person deciding has to see what the
 * family actually sent: who the child is, how old they are, which flat, the
 * picture they chose, who the grown-up is and how to reach them, when it
 * arrived, and — separately — which consents were granted and how the guardian
 * was verified.
 *
 * Consent is listed line by line rather than reduced to one badge. "Consent:
 * complete" answers a different question from "did they agree to us keeping a
 * photograph of their child?", and this is the screen where blurring the two
 * would matter. Photo consent is shown only when a photograph was actually
 * uploaded; without one there is nothing to consent to.
 *
 * Guardian contact details render because the service returns them, and it
 * returns them only to an actor holding `member.view_contact` — the page asks
 * the service, never decides for itself.
 *
 * Both staff roles read this page. Only the Super Admin decides on it: see
 * `ReviewActions`.
 */
export default async function RegistrationsPage() {
  // The real gate. Middleware only checked that a cookie exists.
  const actor = await requirePermissionForPage("registration.view", {
    signedOutTo: "/login?next=/desk/registrations",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const requests = await listRegistrations();
  // `registration.view` opens this page; `registration.review` is a separate
  // key that only the Super Admin holds. See ADR-037.
  const canReview = actor.permissions.has("registration.review");

  return (
    <StaffShell
      branding={branding}
      actor={actor}
      pendingRegistrations={requests.length}
      title="New members"
    >
      {/* The single most likely way this system causes harm is somebody
          believing a ticked box was a check on who that person is. */}
      {isDevelopmentVerificationMode(settings.requiredGuardianVerification) ? (
        <p
          role="status"
          className="mb-6 rounded-[var(--radius-field)] bg-warn-wash px-5 py-4 text-base font-bold text-ink"
        >
          {DEVELOPMENT_VERIFICATION_WARNING}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <EmptyState illustration={<Icon name="reader" />} title="All new readers are up to date">
          When a family fills in the join form, their registration appears here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {requests.map((request) => {
            const age = ageInYears(request.childDob, settings.timezone);
            const inRange = age >= settings.ageMin && age <= settings.ageMax;

            // Photo consent is only a question when a photograph was actually
            // uploaded. Listing it as "missing" for the families who chose an
            // avatar would invent a problem that does not exist.
            const consentTypes = CURRENT_CONSENT_TYPES.filter(
              (type) => type !== "CHILD_PHOTO_STORAGE" || request.photoMediaId,
            );

            // Newest first: the current state of a verification is the last
            // thing that happened to it.
            const verifications = [...request.verifications].reverse();

            return (
              <Card key={request.id} tone="shelf">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  <MemberAvatar
                    avatarKey={request.avatarKey}
                    // Served through the authorised route, never a direct URL.
                    // A librarian holds registration.view, which is what that
                    // route checks — nobody else can load these bytes.
                    photoUrl={request.photoMediaId ? `/api/media/${request.photoMediaId}` : null}
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
                    </div>

                    {/* Two separate questions, shown as two separate answers.
                        A guardian can consent without us having any idea who
                        they are, and this is the screen where confusing the two
                        would do the damage. */}
                    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
                      <div className="flex items-center gap-2">
                        <dt className="text-base font-bold uppercase tracking-wide text-ink-soft">
                          Consent
                        </dt>
                        <dd>
                          <StatusBadge tone={request.consentComplete ? "available" : "late"}>
                            {request.consentComplete ? "Complete" : "Missing"}
                          </StatusBadge>
                        </dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="text-base font-bold uppercase tracking-wide text-ink-soft">
                          Guardian verification
                        </dt>
                        <dd className="flex items-center gap-2">
                          <StatusBadge tone={request.verification.satisfied ? "available" : "late"}>
                            {request.verification.satisfied ? "Complete" : "Missing"}
                          </StatusBadge>
                          <span className="text-base text-ink-soft">
                            {STRENGTH_LABELS[request.verification.achieved]}
                            {request.verification.satisfied
                              ? ""
                              : ` \u00b7 needs ${STRENGTH_LABELS[request.verification.required]}`}
                          </span>
                        </dd>
                      </div>
                    </dl>

                    {/* Consent, one line per thing agreed to. The person
                        deciding should be able to see which box was ticked, not
                        a summary of how many. */}
                    <ul className="mt-4 flex flex-col gap-2">
                      {consentTypes.map((type) => {
                        const granted = request.consents.some(
                          (consent) => consent.type === type && consent.status === "GRANTED",
                        );
                        const optional = !REQUIRED_CONSENT_TYPES.includes(type);
                        return (
                          <li key={type} className="flex flex-wrap items-center gap-2 text-base">
                            <StatusBadge tone={granted ? "available" : optional ? "neutral" : "late"}>
                              {granted ? "Agreed" : "Not agreed"}
                            </StatusBadge>
                            <span className="text-ink-soft">{CONSENT_LABELS[type]}</span>
                          </li>
                        );
                      })}
                    </ul>

                    {/* How the grown-up was checked, and by whom. A strength on
                        its own does not say whether somebody spoke to them or
                        whether they clicked a link in an email. */}
                    {verifications.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-1 text-base text-ink-soft">
                        {verifications.map((verification, index) => (
                          <li key={`${verification.method}-${index}`}>
                            {METHOD_LABELS[verification.method]}
                            {" \u00b7 "}
                            {verification.status === "VERIFIED" ? "confirmed" : "waiting"}
                            {verification.verifiedAt
                              ? ` on ${formatInTimezone(verification.verifiedAt, settings.timezone, "d MMM yyyy")}`
                              : ""}
                            {verification.performedBy
                              ? ` by ${verification.performedBy.displayName}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <dl className="mt-4 grid gap-x-6 gap-y-2 text-base sm:grid-cols-2">
                      <div>
                        <dt className="font-bold text-ink">Flat</dt>
                        <dd className="text-ink-soft">{request.apartment}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-ink">Status</dt>
                        <dd className="text-ink-soft">
                          {request.status === "PENDING" ? "Waiting to be reviewed" : "Being reviewed"}
                        </dd>
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
                    <ReviewActions
                      registrationId={request.id}
                      verificationSatisfied={request.verification.satisfied}
                      awaitingGuardian={request.verification.awaitingGuardian}
                      canReview={canReview}
                      canVerify={actor.permissions.has("guardian.verify")}
                    />
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
