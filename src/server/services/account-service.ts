import "server-only";

import type { UserStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { requirePermission, type Actor } from "@/server/authz";
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
        select: { memberCode: true, apartment: true, avatarKey: true, dateOfBirth: true },
      },
      guardianLinks: {
        select: { guardian: { select: { id: true, fullName: true, email: true, phone: true } } },
      },
    },
  });

  // Contact details are stripped at the service boundary, not hidden in the
  // template. A component that forgets to check must still get nothing.
  return members.map((member) => ({
    ...member,
    guardianLinks: member.guardianLinks.map((link) => ({
      guardian: canSeeContact
        ? link.guardian
        : { id: link.guardian.id, fullName: link.guardian.fullName, email: null, phone: null },
    })),
  }));
}
