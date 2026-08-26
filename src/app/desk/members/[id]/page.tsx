import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CloseAccount } from "@/app/desk/members/[id]/close-account";
import { DeleteAccount } from "@/app/desk/members/[id]/delete-account";
import { EditDetails } from "@/app/desk/members/[id]/edit-details";
import { ActivationFallback } from "@/components/library/activation-fallback";
import { MemberAvatar } from "@/components/library/avatar";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { isClosed } from "@/lib/account-lifecycle";
import { Icon } from "@/components/ui/icon";
import { describeAge } from "@/lib/birth-year";
import { formatInTimezone } from "@/lib/dates";
import { CONSENT_LABELS, type ConsentTypeKey } from "@/lib/consent";
import { METHOD_LABELS, STRENGTH_LABELS } from "@/lib/guardian-verification";
import { NotFoundError } from "@/server/lib/errors";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { issueMemberActivationLinkAction } from "@/server/actions/account-actions";
import { getMemberDetail } from "@/server/services/account-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reader" };

/**
 * One reader, in full.
 *
 * The page renders what the service hands it and decides nothing itself.
 * Contact details arrive null for an actor without `member.view_contact`; the
 * consent and verification blocks arrive null for an actor without
 * `registration.review`. A librarian therefore sees the card, the flat and the
 * grown-up's phone number — what running a library needs — and does not see the
 * evidence behind an approval decision they did not make.
 *
 * Nothing on this page is a secret: there is no password field, no hash, no
 * token, no session and no internal status note, because the service never
 * selects them.
 */

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "available",
  INVITED: "soon",
  SUSPENDED: "late",
  GROWN_UP: "neutral",
  LEFT: "neutral",
  DEACTIVATED: "out",
  ARCHIVED: "out",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INVITED: "Waiting to set up",
  SUSPENDED: "Paused",
  // Neutral words, not "expired" or "removed". Both are ordinary things that
  // happen to a growing child and a moving family, and the record is kept.
  GROWN_UP: "Grown up",
  LEFT: "Left",
  DEACTIVATED: "Closed",
  ARCHIVED: "Archived",
};

/**
 * Widened to plain string keys on purpose.
 *
 * The service hands this page strings, and a page may not import Prisma's enum
 * types — components do not touch the database, not even its type surface. A
 * value with no label falls through to the raw enum name, which is ugly and
 * honest rather than a crash.
 */
const METHOD: Record<string, string> = METHOD_LABELS;
const STRENGTH: Record<string, string> = STRENGTH_LABELS;

const REGISTRATION_LABEL: Record<string, string> = {
  PENDING: "Waiting to be reviewed",
  UNDER_REVIEW: "Being reviewed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-base font-bold text-ink">{label}</dt>
      <dd className="break-words text-ink-soft">{children}</dd>
    </div>
  );
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePermissionForPage("member.view", {
    signedOutTo: "/login?next=/desk/members",
  });
  const { id } = await params;
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const thisYear = Number(formatInTimezone(new Date(), settings.timezone, "yyyy"));

  // A reader id that belongs to another library, to a staff account, or to
  // nobody all arrive here the same way: as a 404. The service refuses; this
  // turns the refusal into the ordinary "no such page" rather than an error
  // screen that confirms something exists somewhere.
  let member: Awaited<ReturnType<typeof getMemberDetail>>;
  try {
    member = await getMemberDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canDelete = actor.permissions.has("user.delete");

  /*
   * The reader is approved and still cannot get in.
   *
   * Shown here as well as on the reader list because this is the page an
   * administrator opens when a family says "the link never arrived" — and the
   * answer to that has to be on the screen they are already looking at.
   *
   * `registration.review` is Super-Admin only: the person who admits a reader
   * is the person who may hand them the way in. See ADR-043.
   */
  /*
   * Written as "the account still works", not as a list of statuses to exclude.
   *
   * The old form named three statuses to refuse, so GROWN_UP and LEFT would
   * have been admitted by default and the desk would have been offered an
   * activation link for an account that can no longer be signed in to.
   */
  const showActivationFallback =
    member.mustSetPassword &&
    !isClosed(member.status) &&
    member.status !== "SUSPENDED" &&
    actor.permissions.has("registration.review");

  const canEditDetails = actor.permissions.has("member.edit");
  const canClose = actor.permissions.has("member.deactivate");

  return (
    <StaffShell branding={branding} actor={actor} title={member.displayName}>
      <p className="mb-6">
        <Link href="/desk/members" className="text-base">
          ← All readers
        </Link>
      </p>

      <div className="flex flex-col gap-6">
        {showActivationFallback ? (
          <ActivationFallback
            subjectId={member.id}
            fieldName="memberId"
            action={issueMemberActivationLinkAction}
            emailSent={member.activationEmailSent}
            waitingLabel="Waiting for the family to set a password"
            waitingDetail="They have not chosen a password yet."
          />
        ) : null}

        <Card>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <MemberAvatar
              avatarKey={member.avatarKey}
              // Served through the authorised route, never a direct URL: those
              // bytes are a child's photograph and /api/media/[id] makes its own
              // decision about who may load them.
              photoUrl={member.photoMediaId ? `/api/media/${member.photoMediaId}` : null}
              name={member.displayName}
              size={72}
              className="shrink-0"
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl">{member.displayName}</h2>
                <StatusBadge tone={STATUS_TONE[member.status] ?? "neutral"}>
                  {STATUS_LABEL[member.status] ?? member.status}
                </StatusBadge>
                {member.birthYear ? (
                  <StatusBadge tone="neutral">{describeAge(member.birthYear, thisYear)}</StatusBadge>
                ) : null}
              </div>

              <dl className="mt-5 grid gap-x-6 gap-y-3 text-base sm:grid-cols-2">
                <Row label="Library card">
                  <span className="code">{member.memberCode ?? "—"}</span>
                </Row>
                <Row label="Flat">{member.apartment ?? "—"}</Row>
                <Row label="Joined">
                  {formatInTimezone(member.createdAt, settings.timezone, "d MMM yyyy")}
                </Row>
                <Row label="Last signed in">
                  {member.lastLoginAt
                    ? formatInTimezone(member.lastLoginAt, settings.timezone, "d MMM yyyy")
                    : "Never"}
                </Row>
              </dl>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle icon={<Icon name="handshake" />}>Parent or guardian</CardTitle>
          {member.guardians.length === 0 ? (
            <p className="mt-3 text-ink-soft">No grown-up is recorded for this reader.</p>
          ) : (
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-base sm:grid-cols-2">
              {member.guardians.map((guardian) => (
                <Row key={guardian.id} label={guardian.isPrimary ? "Main contact" : "Also"}>
                  <span className="font-bold text-ink">{guardian.fullName}</span>
                  {/* Null, not hidden: the service strips contact details for an
                      actor without member.view_contact. */}
                  {guardian.email ? (
                    <>
                      <br />
                      {guardian.email}
                    </>
                  ) : null}
                  {guardian.phone ? (
                    <>
                      <br />
                      {guardian.phone}
                    </>
                  ) : null}
                </Row>
              ))}
            </dl>
          )}
        </Card>

        {/* Present only for the role that decides registrations. */}
        {member.registration ? (
          <Card>
            <CardTitle icon={<Icon name="reader" />}>How they joined</CardTitle>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-base sm:grid-cols-2">
              <Row label="Registration">
                {REGISTRATION_LABEL[member.registration.status] ?? member.registration.status}
              </Row>
              <Row label="Applied">
                {formatInTimezone(
                  member.registration.submittedAt,
                  settings.timezone,
                  "d MMM yyyy",
                )}
              </Row>
              <Row label="Decided">
                {member.registration.reviewedAt
                  ? formatInTimezone(member.registration.reviewedAt, settings.timezone, "d MMM yyyy")
                  : "—"}
              </Row>
              <Row label="Decided by">{member.registration.reviewedBy ?? "—"}</Row>
            </dl>

            <h3 className="mt-6 text-lg">What the grown-up agreed to</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {member.registration.consents.map((consent) => (
                <li key={consent.type} className="flex flex-wrap items-center gap-2 text-base">
                  <StatusBadge tone={consent.status === "GRANTED" ? "available" : "late"}>
                    {consent.status === "GRANTED" ? "Agreed" : "Withdrawn"}
                  </StatusBadge>
                  <span className="text-ink-soft">
                    {CONSENT_LABELS[consent.type as ConsentTypeKey] ?? consent.type}
                  </span>
                  <span className="text-ink-faint">wording {consent.consentVersion}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {member.verification ? (
          <Card>
            {/* A separate card from consent, deliberately. "They agreed" and "we
                checked who they are" are different questions, and the whole
                verification model exists because conflating them is the way
                this software could do real harm. */}
            <CardTitle icon={<Icon name="check" />}>How the grown-up was checked</CardTitle>
            {member.verification.length === 0 ? (
              <p className="mt-3 text-ink-soft">Nothing was recorded.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-base text-ink-soft">
                {member.verification.map((entry, index) => (
                  <li key={`${entry.method}-${index}`}>
                    {METHOD[entry.method] ?? entry.method}
                    {" · "}
                    {STRENGTH[entry.strength] ?? entry.strength}
                    {" · "}
                    {entry.status === "VERIFIED" ? "confirmed" : entry.status.toLowerCase()}
                    {entry.verifiedAt
                      ? ` on ${formatInTimezone(entry.verifiedAt, settings.timezone, "d MMM yyyy")}`
                      : ""}
                    {entry.performedBy ? ` by ${entry.performedBy}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {canEditDetails ? (
          <Card>
            <CardTitle icon={<Icon name="reader" />}>Their details</CardTitle>
            <div className="mt-4">
              <EditDetails
                memberId={member.id}
                displayName={member.displayName}
                apartment={member.apartment ?? ""}
                birthYear={member.birthYear}
              />
            </div>
          </Card>
        ) : null}

        {/*
          Closing an account, kept well away from deleting one and worded so the
          difference is unmissable. They sit next to each other on this page and
          they are the two most consequential controls on it.
        */}
        {canClose ? (
          <Card>
            <CardTitle icon={<Icon name="archive" />}>Close this account</CardTitle>
            <div className="mt-4">
              <CloseAccount
                memberId={member.id}
                displayName={member.displayName}
                currentStatus={member.status}
              />
            </div>
          </Card>
        ) : null}

        {canDelete ? (
          <Card>
            <CardTitle icon={<Icon name="trash" />}>Delete permanently</CardTitle>
            <div className="mt-4">
              <DeleteAccount memberId={member.id} displayName={member.displayName} />
            </div>
          </Card>
        ) : null}
      </div>
    </StaffShell>
  );
}
