import "server-only";

import type { UserStatus } from "@prisma/client";

import { env } from "@/server/env";
import { prisma } from "@/server/db";
import { requireActor, requirePermission, type Actor } from "@/server/authz";
import { revokeAllSessionsForUser } from "@/server/auth/session-store";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { EmailService } from "@/server/lib/email";
import { NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { mintToken, revokeTokens, TOKEN_LIFETIME } from "@/server/lib/tokens";

/**
 * Member account lifecycle: suspend, reactivate, deactivate, reissue activation,
 * and guardian contact changes.
 *
 * Two rules shape all of it:
 *
 *   1. A status change that removes access must end live sessions in the same
 *      breath. "Suspended but still browsing" is not a state that may exist.
 *   2. The internal reason a librarian writes is for the library. The family
 *      gets a plain message and an invitation to come and talk.
 */

/** Terminal-ish states a member cannot be moved out of by ordinary staff action. */
const REACTIVATABLE_FROM: readonly UserStatus[] = ["SUSPENDED", "DEACTIVATED"];

async function loadMember(actor: Actor, memberUserId: string) {
  const user = await prisma.appUser.findFirst({
    where: { id: memberUserId, libraryId: actor.libraryId },
    select: {
      id: true,
      libraryId: true,
      kind: true,
      status: true,
      displayName: true,
      mustSetPassword: true,
      memberProfile: { select: { memberCode: true } },
    },
  });

  if (!user) throw new NotFoundError(`Member ${memberUserId} not found in library ${actor.libraryId}`);

  // Staff accounts are managed only through the staff service, which is
  // Super-Admin gated. A librarian holding member.suspend must not be able to
  // reach a colleague — or a Super Admin — through this path.
  if (user.kind === "STAFF") {
    throw new NotFoundError(
      `Refusing to manage STAFF user ${memberUserId} through the member service`,
    );
  }

  return user;
}

/** Guardian address for lifecycle notifications, if there is one. */
async function guardianEmailFor(memberUserId: string): Promise<{ email: string } | null> {
  const link = await prisma.guardianMember.findFirst({
    where: { memberUserId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { guardian: { select: { email: true } } },
  });
  return link ? { email: link.guardian.email } : null;
}

export async function suspendMember(memberUserId: string, internalReason: string): Promise<void> {
  const actor = await requirePermission("member.suspend");
  const member = await loadMember(actor, memberUserId);

  const reason = internalReason.trim();
  if (reason.length < 3) {
    throw new ValidationError(
      { reason: "Please note why, for the library's own records." },
      "Suspension attempted without an internal reason",
    );
  }

  if (member.status === "SUSPENDED") return;
  if (member.status === "ARCHIVED") {
    throw new RuleViolationError(
      `Member ${memberUserId} is archived`,
      "This account has been closed and cannot be changed.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: member.id },
      data: {
        status: "SUSPENDED",
        statusReason: reason,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_SUSPENDED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { reason, previousStatus: member.status },
    });
  });

  // In the same operation, not "soon": a suspended reader must not still be
  // holding a working session.
  const revoked = await revokeAllSessionsForUser(member.id);
  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.SESSIONS_REVOKED,
    entityType: "app_user",
    entityId: member.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: { count: revoked, reason: "suspension" },
  });

  const guardian = await guardianEmailFor(member.id);
  if (guardian) {
    // The generic message only. The internal reason never leaves the library.
    await EmailService.sendAccountSuspended({
      to: guardian.email,
      childName: member.displayName,
      userId: member.id,
    });
  }
}

export async function reactivateMember(memberUserId: string): Promise<void> {
  const actor = await requirePermission("member.suspend");
  const member = await loadMember(actor, memberUserId);

  if (!REACTIVATABLE_FROM.includes(member.status)) {
    throw new RuleViolationError(
      `Member ${memberUserId} is ${member.status} and cannot be reactivated`,
      "That account is not paused.",
    );
  }

  // A member who never chose a password returns to INVITED, not ACTIVE —
  // otherwise reactivation would hand out an account with no password at all.
  const restoredStatus: UserStatus = member.mustSetPassword ? "INVITED" : "ACTIVE";

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: member.id },
      data: {
        status: restoredStatus,
        statusReason: null,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_REACTIVATED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { previousStatus: member.status, restoredStatus },
    });
  });

  const guardian = await guardianEmailFor(member.id);
  if (guardian) {
    await EmailService.sendAccountReactivated({
      to: guardian.email,
      childName: member.displayName,
      userId: member.id,
    });
  }
}

/**
 * Closes an account, for a family that has moved away.
 *
 * Deliberately does NOT delete anything. Loan history stays attached and
 * intact — those are the library's own records, not the member's alone. The
 * redaction pass that eventually accompanies ARCHIVED is described in
 * docs/ACCOUNT_LIFECYCLE.md and needs a community-approved retention policy
 * before it can be written.
 */
export async function deactivateMember(memberUserId: string, internalReason: string): Promise<void> {
  const actor = await requirePermission("member.deactivate");
  const member = await loadMember(actor, memberUserId);

  const reason = internalReason.trim();
  if (reason.length < 3) {
    throw new ValidationError({ reason: "Please note why, for the library's own records." });
  }

  if (member.status === "DEACTIVATED") return;

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: member.id },
      data: {
        status: "DEACTIVATED",
        statusReason: reason,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
    });

    // Any live activation or reset link dies with the account.
    await revokeTokens(tx, member.id, "ACTIVATION");
    await revokeTokens(tx, member.id, "PASSWORD_RESET");

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_DEACTIVATED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { reason, previousStatus: member.status },
    });
  });

  await revokeAllSessionsForUser(member.id);
}

/**
 * Sends a fresh activation link.
 *
 * The librarian's only power over a password: cause a new single-use link to be
 * emailed to the guardian. They never see, choose or receive the password.
 */
export async function reissueActivation(memberUserId: string): Promise<boolean> {
  const actor = await requirePermission("member.reset_password");
  const member = await loadMember(actor, memberUserId);

  if (member.status === "SUSPENDED" || member.status === "DEACTIVATED" || member.status === "ARCHIVED") {
    throw new RuleViolationError(
      `Cannot reissue activation for ${member.status} member`,
      "Reactivate the account first.",
    );
  }

  const guardian = await guardianEmailFor(member.id);
  if (!guardian) {
    throw new RuleViolationError(
      `Member ${memberUserId} has no guardian email`,
      "This reader has no guardian email on file, so there is nowhere to send the link.",
    );
  }

  const guardianRecord = await prisma.guardianMember.findFirst({
    where: { memberUserId: member.id },
    orderBy: [{ isPrimary: "desc" }],
    select: { guardian: { select: { fullName: true } } },
  });

  const token = await prisma.$transaction(async (tx) => {
    // mintToken revokes any live activation link first, so the older email in
    // the guardian's inbox stops working the moment a new one is issued.
    const minted = await mintToken(tx, {
      userId: member.id,
      type: "ACTIVATION",
      createdById: actor.userId,
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ACTIVATION_REISSUED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { expiresAt: minted.expiresAt.toISOString() },
    });

    return minted;
  });

  return EmailService.sendActivation({
    to: guardian.email,
    guardianName: guardianRecord?.guardian.fullName ?? "Parent or guardian",
    childName: member.displayName,
    memberCode: member.memberProfile?.memberCode ?? "",
    activationToken: token.rawToken,
    expiresInDays: Math.round(TOKEN_LIFETIME.ACTIVATION.hours / 24),
    memberUserId: member.id,
  });
}

/**
 * Hands the Super Admin one activation link for a reader, to deliver by hand.
 *
 * **This exists because email might not.** A family's registration can be
 * approved in a library whose mail provider is not configured yet, and in that
 * state the child's account exists and nobody can get into it. The
 * administrator copies the link and gives it to the guardian through a channel
 * they trust — at the desk, in person. The guardian still chooses the
 * password, and nobody ever sets it for them.
 *
 * The counterpart of `issueStaffActivationLink`, deliberately identical in
 * every respect that matters: the ordinary activation token, same generator,
 * same 7-day life, same single use, same hash-only storage. Nothing new was
 * invented for this, and minting revokes any live one, so at most one link is
 * ever valid.
 *
 * **The raw token exists only in the return value of this call.** Not stored,
 * not logged, not written to the audit row — the row records that a link was
 * issued, by whom, for whom, and when it expires. A lost link is replaced by
 * issuing another; there is nowhere to go and look one up.
 *
 * Two things are stricter here than in `reissueActivation` beside it:
 *
 *   1. **A librarian cannot reach it.** Reissuing *sends* a link to the address
 *      already on file, which is why `member.reset_password` is enough for it —
 *      the link lands with the guardian either way. Handing the raw URL to a
 *      person is different: whoever holds it can walk into the child's account
 *      without the family ever hearing about it. So this asks for
 *      `registration.review`, the Super-Admin-only permission that decides
 *      whether a child joins the library at all. The person who admits a reader
 *      is the person who may hand them the way in.
 *   2. **It refuses an account that has already chosen a password.** That is
 *      not a stalled activation, it is a live account, and a live account with
 *      a forgotten password uses the reset flow, which writes to the guardian.
 */
export async function issueMemberActivationLink(
  memberUserId: string,
): Promise<{ url: string; expiresAt: Date; displayName: string }> {
  const actor = await requirePermission("registration.review");
  const member = await loadMember(actor, memberUserId);

  if (member.status === "SUSPENDED" || member.status === "DEACTIVATED" || member.status === "ARCHIVED") {
    throw new RuleViolationError(
      `Cannot issue an activation link for ${member.status} member`,
      "Reactivate the account first.",
    );
  }

  if (!member.mustSetPassword) {
    throw new RuleViolationError(
      `Member ${memberUserId} has already chosen a password`,
      "They have already set a password. Send them a reset link instead.",
    );
  }

  const token = await prisma.$transaction(async (tx) => {
    const minted = await mintToken(tx, {
      userId: member.id,
      type: "ACTIVATION",
      createdById: actor.userId,
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ACTIVATION_LINK_ISSUED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // No token, and no URL. Deliberately: an audit log is read by more people
      // and kept for longer than the thing it describes.
      metadata: { kind: "MEMBER", delivery: "manual", expiresAt: minted.expiresAt.toISOString() },
    });

    return minted;
  });

  return {
    url: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/activate/${token.rawToken}`,
    expiresAt: token.expiresAt,
    displayName: member.displayName,
  };
}

/**
 * Updates guardian contact details.
 *
 * Staff-only, always. The guardian's email is the *recovery channel* for a
 * child's account: anyone who can change it can take the account over on the
 * next reset. A child must therefore never be able to change it, and neither
 * should an unauthenticated "update your details" link exist.
 *
 * Changing the email additionally revokes live reset and activation tokens, so
 * a link already sent to the old address cannot be completed afterwards.
 */
export async function updateGuardianContact(params: {
  guardianId: string;
  fullName?: string;
  email?: string;
  phone?: string;
  apartment?: string;
}): Promise<void> {
  const actor = await requirePermission("guardian.edit");

  const guardian = await prisma.guardian.findFirst({
    where: { id: params.guardianId, libraryId: actor.libraryId },
    select: { id: true, fullName: true, email: true, memberLinks: { select: { memberUserId: true } } },
  });
  if (!guardian) throw new NotFoundError(`Guardian ${params.guardianId} not found`);

  const nextEmail = params.email?.trim().toLowerCase();
  const emailChanged = Boolean(nextEmail && nextEmail !== guardian.email);

  await prisma.$transaction(async (tx) => {
    await tx.guardian.update({
      where: { id: guardian.id },
      data: {
        fullName: params.fullName?.trim() ?? undefined,
        email: nextEmail ?? undefined,
        phone: params.phone?.trim() ?? undefined,
        apartment: params.apartment?.trim() ?? undefined,
      },
    });

    if (emailChanged) {
      for (const link of guardian.memberLinks) {
        await revokeTokens(tx, link.memberUserId, "PASSWORD_RESET");
        await revokeTokens(tx, link.memberUserId, "ACTIVATION");
      }
    }

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.GUARDIAN_UPDATED,
      entityType: "guardian",
      entityId: guardian.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // Records *that* the recovery address changed, not the addresses.
      metadata: {
        emailChanged,
        fieldsChanged: Object.keys(params).filter((key) => key !== "guardianId"),
      },
    });
  });
}

/**
 * The signed-in member's own library card.
 *
 * Takes no id, by design. Ownership comes from the session and there is nothing
 * in the request to tamper with — the strongest form of the rule that a child
 * reaches their own record and no other.
 *
 * Returns null for staff, who have no library card.
 */
export async function getOwnMemberCard(): Promise<{
  memberCode: string;
  avatarKey: string | null;
  photoMediaId: string | null;
} | null> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return null;

  return prisma.memberProfile.findUnique({
    where: { userId: actor.userId },
    select: { memberCode: true, avatarKey: true, photoMediaId: true },
  });
}

/** The member list for the desk. Contact details only if the actor may see them. */
export async function listMembers(options: { search?: string } = {}) {
  const actor = await requirePermission("member.view");
  const canSeeContact = actor.permissions.has("member.view_contact");
  const search = options.search?.trim();

  const members = await prisma.appUser.findMany({
    where: {
      libraryId: actor.libraryId,
      kind: "MEMBER",
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: "insensitive" as const } },
              { memberProfile: { memberCode: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { displayName: "asc" },
    take: 200,
    select: {
      id: true,
      displayName: true,
      status: true,
      mustSetPassword: true,
      lastLoginAt: true,
      memberProfile: {
        select: {
          memberCode: true,
          apartment: true,
          avatarKey: true,
          dateOfBirth: true,
          // The id only. The bytes come from /api/media/[id], which makes its
          // own authorization decision for the person actually looking.
          photoMediaId: true,
        },
      },
      guardianLinks: {
        select: { guardian: { select: { id: true, fullName: true, email: true, phone: true } } },
      },
    },
  });

  const activationEmailSent = await latestActivationDelivery(
    actor.libraryId,
    members.filter((member) => member.mustSetPassword).map((member) => member.id),
  );

  // Contact details are stripped at the service boundary, not hidden in the
  // template. A component that forgets to check must still get nothing.
  return members.map((member) => ({
    ...member,
    activationEmailSent: activationEmailSent.get(member.id) ?? null,
    guardianLinks: member.guardianLinks.map((link) => ({
      guardian: canSeeContact
        ? link.guardian
        : { id: link.guardian.id, fullName: link.guardian.fullName, email: null, phone: null },
    })),
  }));
}

/**
 * Did the activation email actually reach a provider?
 *
 * Reads `email_event`, which the mailer already writes for every attempt —
 * not a new column, and not an assumption. `false` is the difference between
 * "waiting for the family to choose a password" and "nobody was ever written
 * to", and the desk has to be able to tell an administrator which of the two
 * it is looking at. Null when no activation email has ever been attempted.
 *
 * One query for the whole page, mirroring `listStaff`.
 */
async function latestActivationDelivery(
  libraryId: string,
  memberUserIds: string[],
): Promise<Map<string, boolean>> {
  const latest = new Map<string, boolean>();
  if (memberUserIds.length === 0) return latest;

  const events = await prisma.emailEvent.findMany({
    where: {
      libraryId,
      template: "activation",
      relatedEntityType: "app_user",
      relatedEntityId: { in: memberUserIds },
    },
    select: { relatedEntityId: true, status: true },
    orderBy: { createdAt: "desc" },
  });

  for (const event of events) {
    if (!event.relatedEntityId) continue;
    // Ordered newest first, so the first one seen for a reader is the latest.
    if (!latest.has(event.relatedEntityId)) {
      latest.set(event.relatedEntityId, event.status === "SENT");
    }
  }

  return latest;
}

// ---------------------------------------------------------------------------
// One reader, in full
// ---------------------------------------------------------------------------

/**
 * Everything the library holds about one reader, shaped for the person looking.
 *
 * Three blocks, and two of them can be null:
 *
 *   - **The card.** Name, age, flat, picture, card code, status. Operational —
 *     every staff member who can see the reader list can see this.
 *   - **Contact.** The guardian's name, phone and email. Present only for an
 *     actor holding `member.view_contact`.
 *   - **The decision.** How the family joined: when they applied, what they
 *     consented to, and how the guardian was verified. Present only for an
 *     actor holding `registration.review` — the person who makes that decision
 *     is the person who needs to see the evidence behind it. A librarian runs
 *     the library day to day and does not need to know, months later, which
 *     consent boxes a parent ticked.
 *
 * Nothing here is a secret: no password hash, no token, no token hash, no
 * session, no internal status reason. The select lists columns explicitly for
 * that reason — a `include: { user: true }` would ship `passwordHash` to a
 * React component the day somebody adds a spread.
 */
export interface MemberDetail {
  id: string;
  displayName: string;
  status: UserStatus;
  mustSetPassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  memberCode: string | null;
  apartment: string | null;
  dateOfBirth: Date | null;
  avatarKey: string | null;
  photoMediaId: string | null;
  /**
   * Whether the last activation email reached a provider. Null when none was
   * ever attempted, and null for a reader who has already set a password —
   * there is nothing waiting, so there is nothing to report.
   */
  activationEmailSent: boolean | null;
  guardians: { id: string; fullName: string; email: string | null; phone: string | null; isPrimary: boolean }[];
  /** Null when the actor may not see how the joining decision was made. */
  registration: {
    status: string;
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    consents: { type: string; status: string; consentVersion: string; grantedAt: Date | null }[];
  } | null;
  /** Null for the same reason, and separately from consent: they are not the same question. */
  verification: {
    method: string;
    status: string;
    strength: string;
    verifiedAt: Date | null;
    performedBy: string | null;
  }[] | null;
}

export async function getMemberDetail(memberUserId: string): Promise<MemberDetail> {
  const actor = await requirePermission("member.view");
  const canSeeContact = actor.permissions.has("member.view_contact");
  const canSeeDecision = actor.permissions.has("registration.review");

  const user = await prisma.appUser.findFirst({
    where: { id: memberUserId, libraryId: actor.libraryId, kind: "MEMBER" },
    select: {
      id: true,
      displayName: true,
      status: true,
      mustSetPassword: true,
      lastLoginAt: true,
      createdAt: true,
      memberProfile: {
        select: {
          memberCode: true,
          apartment: true,
          dateOfBirth: true,
          avatarKey: true,
          // The id only. The bytes come from /api/media/[id], which makes its
          // own authorization decision for the person actually looking.
          photoMediaId: true,
        },
      },
      guardianLinks: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          isPrimary: true,
          guardian: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      },
    },
  });

  // `kind: "MEMBER"` is in the where clause, so a staff id resolves to nothing
  // here rather than leaking a colleague's record through the reader screen.
  if (!user) {
    throw new NotFoundError(`Reader ${memberUserId} not found in library ${actor.libraryId}`);
  }

  const registration = canSeeDecision
    ? await prisma.registrationRequest.findFirst({
        where: { libraryId: actor.libraryId, createdMemberUserId: user.id },
        select: {
          status: true,
          submittedAt: true,
          reviewedAt: true,
          reviewedBy: { select: { displayName: true } },
          consents: {
            select: { type: true, status: true, consentVersion: true, grantedAt: true },
            orderBy: { grantedAt: "asc" },
          },
        },
      })
    : null;

  const verifications = canSeeDecision
    ? await prisma.guardianVerification.findMany({
        where: { memberUserId: user.id },
        orderBy: { requestedAt: "asc" },
        select: {
          method: true,
          status: true,
          strength: true,
          verifiedAt: true,
          performedBy: { select: { displayName: true } },
        },
      })
    : null;

  const activationEmailSent = user.mustSetPassword
    ? (await latestActivationDelivery(actor.libraryId, [user.id])).get(user.id) ?? null
    : null;

  return {
    id: user.id,
    displayName: user.displayName,
    status: user.status,
    mustSetPassword: user.mustSetPassword,
    activationEmailSent,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    memberCode: user.memberProfile?.memberCode ?? null,
    apartment: user.memberProfile?.apartment ?? null,
    dateOfBirth: user.memberProfile?.dateOfBirth ?? null,
    avatarKey: user.memberProfile?.avatarKey ?? null,
    photoMediaId: user.memberProfile?.photoMediaId ?? null,
    // Stripped at the service boundary, not in the template. A component that
    // forgets to check must still get nothing.
    guardians: user.guardianLinks.map((link) => ({
      id: link.guardian.id,
      fullName: link.guardian.fullName,
      email: canSeeContact ? link.guardian.email : null,
      phone: canSeeContact ? link.guardian.phone : null,
      isPrimary: link.isPrimary,
    })),
    registration: registration
      ? {
          status: registration.status,
          submittedAt: registration.submittedAt,
          reviewedAt: registration.reviewedAt,
          reviewedBy: registration.reviewedBy?.displayName ?? null,
          consents: registration.consents.map((consent) => ({
            type: consent.type,
            status: consent.status,
            consentVersion: consent.consentVersion,
            grantedAt: consent.grantedAt,
          })),
        }
      : null,
    verification: verifications
      ? verifications.map((entry) => ({
          method: entry.method,
          status: entry.status,
          strength: entry.strength,
          verifiedAt: entry.verifiedAt,
          performedBy: entry.performedBy?.displayName ?? null,
        }))
      : null,
  };
}

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

/**
 * The one message a member of staff ever sees when a deletion is refused.
 *
 * Deliberately the same sentence whatever the reason. Which of eight checks
 * caught it is the library's business, not a hint to be read off a screen; the
 * audit row records the actual reasons, and the answer for the person standing
 * there is the same in every case: archive it instead.
 */
export const DELETE_REFUSED_MESSAGE =
  "This account has library history and cannot be permanently deleted. Deactivate/archive it instead.";

/**
 * Erases a reader's account.
 *
 * This is the only operation in the application that removes a person, and it
 * exists for exactly one situation: a duplicate card that was created and never
 * used. Anything that has been *lived in* — a book borrowed, a book asked for,
 * a photograph held, a single sign-in — is refused and archived instead, because
 * the library's account of what happened must not develop holes.
 *
 * What survives a deletion, and why:
 *
 *   - **The registration request.** It is the family's application and the home
 *     of their consent records. The account goes; the library's record that
 *     somebody applied, and what they agreed to, stays. `createdMemberUserId`
 *     is cleared so it does not point at a row that no longer exists.
 *   - **Guardian verifications.** Detached from the member and left attached to
 *     the registration, because the FK would otherwise cascade and delete the
 *     library's evidence that a grown-up was ever checked. A verification that
 *     could not survive the detach is itself a refusal.
 *   - **The guardian.** Only the join row is removed. A parent is usually the
 *     contact for more than one child.
 *   - **The audit row.** Written inside the same transaction as the delete, and
 *     carrying the name and card code, because afterwards it is the only record
 *     the library has that this account existed at all.
 *
 * Cascades handle the rest: profile, roles, sessions and any live tokens.
 */
export async function deleteMemberAccount(
  memberUserId: string,
  reason: string,
): Promise<{ displayName: string }> {
  const actor = await requirePermission("user.delete");

  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ValidationError(
      { reason: "Please note why, for the library's records." },
      "Member deletion attempted without a reason",
    );
  }

  // Reuses the member loader, which refuses a STAFF id outright: a colleague is
  // never reachable through the reader path, whatever id is posted.
  const member = await loadMember(actor, memberUserId);

  const [
    loans,
    borrowRequests,
    renewalRequests,
    loanEvents,
    donations,
    auditRows,
    profile,
    account,
    strandedVerifications,
  ] = await Promise.all([
    prisma.loan.count({ where: { memberUserId: member.id } }),
    prisma.borrowRequest.count({ where: { memberUserId: member.id } }),
    prisma.renewalRequest.count({ where: { requestedById: member.id } }),
    prisma.loanEvent.count({ where: { actorUserId: member.id } }),
    prisma.donation.count({ where: { donorUserId: member.id } }),
    prisma.auditLog.count({ where: { actorUserId: member.id } }),
    prisma.memberProfile.findUnique({
      where: { userId: member.id },
      select: { photoMediaId: true },
    }),
    prisma.appUser.findUnique({ where: { id: member.id }, select: { lastLoginAt: true } }),
    // A verification carrying neither a guardian nor a registration would break
    // its own "always about somebody" CHECK the moment the member is detached.
    prisma.guardianVerification.count({
      where: { memberUserId: member.id, guardianId: null, registrationRequestId: null },
    }),
  ]);

  const history: string[] = [];
  if (loans > 0) history.push("they have borrowed a book");
  if (borrowRequests > 0) history.push("they have asked for a book");
  if (renewalRequests > 0) history.push("they have asked to keep a book longer");
  if (loanEvents > 0) history.push("the desk has recorded something for them");
  if (donations > 0) history.push("they gave a book to the library");
  if (auditRows > 0) history.push("they have acted in the library's records");
  if (profile?.photoMediaId) history.push("the library holds a photograph of them");
  if (account?.lastLoginAt) history.push("they have signed in");
  if (strandedVerifications > 0) history.push("a guardian check is attached only to this account");

  if (history.length > 0) {
    await recordAudit(prisma, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_DELETE_REFUSED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { kind: "MEMBER", because: history },
    }).catch(() => undefined);

    throw new RuleViolationError(
      `Refusing to delete member ${member.id}: ${history.join(", ")}`,
      DELETE_REFUSED_MESSAGE,
    );
  }

  // Before, not after: if the delete then fails, the account has been signed
  // out unnecessarily, which is the harmless direction to be wrong in.
  await revokeAllSessionsForUser(member.id);

  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_DELETED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        kind: "MEMBER",
        displayName: member.displayName,
        memberCode: member.memberProfile?.memberCode ?? null,
        previousStatus: member.status,
        reason: trimmed.slice(0, 500),
      },
    });

    await tx.registrationRequest.updateMany({
      where: { createdMemberUserId: member.id },
      data: { createdMemberUserId: null },
    });

    await tx.guardianVerification.updateMany({
      where: { memberUserId: member.id },
      data: { memberUserId: null },
    });

    await tx.appUser.delete({ where: { id: member.id } });
  });

  return { displayName: member.displayName };
}
