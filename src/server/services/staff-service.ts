import "server-only";

import { prisma } from "@/server/db";
import { requirePermission, type Actor } from "@/server/authz";
import { revokeAllSessionsForUser } from "@/server/auth/session-store";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { EmailService } from "@/server/lib/email";
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { mintToken, revokeTokens, TOKEN_LIFETIME } from "@/server/lib/tokens";
import { ROLE_KEYS } from "@/lib/permissions";

/**
 * Staff management. This is the privilege-escalation surface, so the rules are
 * explicit and each one has a test:
 *
 *   • Only `user.manage_staff` (Super Admin) reaches any of it.
 *   • The only role this service can grant is Librarian. Version 1 has exactly
 *     one Super Admin, created by `npm run create-admin` when the library is
 *     set up, and there is no screen, action or service call anywhere that
 *     mints a second one or promotes anybody into the role.
 *   • Nobody can suspend, deactivate or demote themselves. Locking the only
 *     administrator out of their own library is a real, easy accident.
 *   • The last active Super Admin cannot be removed. There must always be
 *     someone who can let everyone else back in.
 *
 * Staff never receive a password from us either: a new librarian gets the same
 * single-use activation link a child's guardian does.
 */

/**
 * The only role this service grants.
 *
 * Not a parameter, and not a dropdown: a staff account created here is a
 * Librarian. Making that a choice would mean writing the code that can create
 * a second Super Admin, and then guarding it — so the code does not exist.
 */
const STAFF_ROLE = ROLE_KEYS.LIBRARIAN;

export interface StaffSummary {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  roleKeys: string[];
  createdAt: Date;
  lastLoginAt: Date | null;
  mustSetPassword: boolean;
}

export async function listStaff(): Promise<StaffSummary[]> {
  const actor = await requirePermission("user.manage_staff");

  const staff = await prisma.appUser.findMany({
    where: { libraryId: actor.libraryId, kind: "STAFF" },
    orderBy: [{ status: "asc" }, { displayName: "asc" }],
    select: {
      id: true,
      displayName: true,
      email: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      mustSetPassword: true,
      userRoles: { select: { role: { select: { key: true } } } },
    },
  });

  // No password hash is selected. There is no code path that reads one outside
  // the authentication service.
  return staff.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    mustSetPassword: user.mustSetPassword,
    roleKeys: user.userRoles.map((entry) => entry.role.key),
  }));
}

export interface CreateStaffInput {
  displayName: string;
  email: string;
}

/**
 * Creates a staff account in the INVITED state and emails an activation link.
 *
 * No password is chosen here, by anyone. The new librarian sets their own, and
 * the Super Admin who created the account never learns it.
 */
export async function createStaffAccount(input: CreateStaffInput): Promise<{ userId: string; emailSent: boolean }> {
  const actor = await requirePermission("user.manage_staff");

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!displayName) {
    throw new ValidationError({ displayName: "A name is required." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError({ email: "That does not look like an email address." });
  }
  const existing = await prisma.appUser.findFirst({
    where: { libraryId: actor.libraryId, email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      `Staff account already exists for ${email}`,
      "There is already an account with that email address.",
    );
  }

  const role = await prisma.role.findUnique({
    where: { libraryId_key: { libraryId: actor.libraryId, key: STAFF_ROLE } },
    select: { id: true, isAssignable: true },
  });
  if (!role) throw new NotFoundError(`Role ${STAFF_ROLE} not found`);
  if (!role.isAssignable) {
    throw new RuleViolationError(
      `Role ${STAFF_ROLE} is not assignable`,
      "That role is not available yet.",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.appUser.create({
      data: {
        libraryId: actor.libraryId,
        kind: "STAFF",
        displayName,
        email,
        status: "INVITED",
        mustSetPassword: true,
        createdById: actor.userId,
      },
    });

    await tx.userRole.create({
      data: { userId: user.id, roleId: role.id, grantedById: actor.userId },
    });

    const token = await mintToken(tx, {
      userId: user.id,
      type: "ACTIVATION",
      createdById: actor.userId,
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { kind: "STAFF", role: STAFF_ROLE },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ROLE_GRANTED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { role: STAFF_ROLE },
    });

    return { user, token };
  });

  const emailSent = await EmailService.sendStaffInvitation({
    to: email,
    name: displayName,
    roleName: "a Librarian",
    activationToken: result.token.rawToken,
    expiresInDays: Math.round(TOKEN_LIFETIME.ACTIVATION.hours / 24),
    userId: result.user.id,
  });

  return { userId: result.user.id, emailSent };
}

async function loadStaff(actor: Actor, staffUserId: string) {
  const user = await prisma.appUser.findFirst({
    where: { id: staffUserId, libraryId: actor.libraryId, kind: "STAFF" },
    select: {
      id: true,
      displayName: true,
      email: true,
      status: true,
      userRoles: { select: { role: { select: { key: true } } } },
    },
  });
  if (!user) throw new NotFoundError(`Staff user ${staffUserId} not found`);
  return user;
}

function isSuperAdmin(user: { userRoles: { role: { key: string } }[] }): boolean {
  return user.userRoles.some((entry) => entry.role.key === ROLE_KEYS.SUPER_ADMIN);
}

/**
 * Refuses to remove the library's last working Super Admin.
 *
 * Without this, one careless click leaves a community library with nobody who
 * can create staff, change settings, or restore anyone — recoverable only by
 * someone with database access.
 */
async function assertNotLastSuperAdmin(libraryId: string, targetUserId: string): Promise<void> {
  const remaining = await prisma.appUser.count({
    where: {
      libraryId,
      kind: "STAFF",
      status: "ACTIVE",
      id: { not: targetUserId },
      userRoles: { some: { role: { key: ROLE_KEYS.SUPER_ADMIN } } },
    },
  });

  if (remaining === 0) {
    throw new RuleViolationError(
      `Refusing to remove the last active Super Admin in library ${libraryId}`,
      "This is the library's only administrator. Give someone else that role first.",
    );
  }
}

export async function suspendStaff(staffUserId: string, internalReason: string): Promise<void> {
  const actor = await requirePermission("user.manage_staff");

  if (staffUserId === actor.userId) {
    throw new RuleViolationError(
      "Self-suspension attempt",
      "You cannot suspend your own account.",
    );
  }

  const staff = await loadStaff(actor, staffUserId);
  const reason = internalReason.trim();
  if (reason.length < 3) {
    throw new ValidationError({ reason: "Please note why, for the library's records." });
  }

  if (isSuperAdmin(staff)) {
    await assertNotLastSuperAdmin(actor.libraryId, staff.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: staff.id },
      data: {
        status: "SUSPENDED",
        statusReason: reason,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
    });

    await revokeTokens(tx, staff.id, "ACTIVATION");
    await revokeTokens(tx, staff.id, "PASSWORD_RESET");

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_SUSPENDED,
      entityType: "app_user",
      entityId: staff.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { reason, kind: "STAFF" },
    });
  });

  const revoked = await revokeAllSessionsForUser(staff.id);
  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.SESSIONS_REVOKED,
    entityType: "app_user",
    entityId: staff.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: { count: revoked, reason: "staff suspension" },
  });
}

export async function reactivateStaff(staffUserId: string): Promise<void> {
  const actor = await requirePermission("user.manage_staff");
  const staff = await loadStaff(actor, staffUserId);

  if (staff.status !== "SUSPENDED" && staff.status !== "DEACTIVATED") {
    throw new RuleViolationError(
      `Staff ${staffUserId} is ${staff.status}`,
      "That account is not paused.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: staff.id },
      data: {
        status: "ACTIVE",
        statusReason: null,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_REACTIVATED,
      entityType: "app_user",
      entityId: staff.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { kind: "STAFF", previousStatus: staff.status },
    });
  });
}

export async function deactivateStaff(staffUserId: string, internalReason: string): Promise<void> {
  const actor = await requirePermission("user.manage_staff");

  if (staffUserId === actor.userId) {
    throw new RuleViolationError("Self-deactivation attempt", "You cannot close your own account.");
  }

  const staff = await loadStaff(actor, staffUserId);
  const reason = internalReason.trim();
  if (reason.length < 3) {
    throw new ValidationError({ reason: "Please note why, for the library's records." });
  }

  if (isSuperAdmin(staff)) {
    await assertNotLastSuperAdmin(actor.libraryId, staff.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: staff.id },
      data: {
        status: "DEACTIVATED",
        statusReason: reason,
        statusChangedAt: new Date(),
        statusChangedById: actor.userId,
      },
    });

    await revokeTokens(tx, staff.id, "ACTIVATION");
    await revokeTokens(tx, staff.id, "PASSWORD_RESET");

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_DEACTIVATED,
      entityType: "app_user",
      entityId: staff.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { reason, kind: "STAFF" },
    });
  });

  await revokeAllSessionsForUser(staff.id);
}

/*
 * There is no `setStaffRole` here, and that is the design.
 *
 * Version 1 has three roles and one Super Admin. The only staff role that can
 * be granted is Librarian, at creation, so there is nothing left for a role
 * editor to do except create the two accidents this service exists to prevent:
 * a second administrator nobody meant to make, and a library whose only
 * administrator has demoted themselves. Handing the library over is
 * `npm run create-admin`, run deliberately, by someone with the database.
 */

/** Sends a staff member a fresh activation or reset link. Never reveals a password. */
export async function reissueStaffActivation(staffUserId: string): Promise<boolean> {
  const actor = await requirePermission("user.manage_staff");
  const staff = await loadStaff(actor, staffUserId);

  if (!staff.email) {
    throw new RuleViolationError(
      `Staff ${staffUserId} has no email`,
      "That account has no email address on file.",
    );
  }
  if (staff.status === "SUSPENDED" || staff.status === "DEACTIVATED") {
    throw new RuleViolationError(
      `Cannot reissue for ${staff.status} staff`,
      "Reactivate the account first.",
    );
  }

  const token = await prisma.$transaction(async (tx) => {
    const minted = await mintToken(tx, {
      userId: staff.id,
      type: "ACTIVATION",
      createdById: actor.userId,
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ACTIVATION_REISSUED,
      entityType: "app_user",
      entityId: staff.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { kind: "STAFF" },
    });

    return minted;
  });

  return EmailService.sendStaffInvitation({
    to: staff.email,
    name: staff.displayName,
    roleName: isSuperAdmin(staff) ? "a Super Admin" : "a Librarian",
    activationToken: token.rawToken,
    expiresInDays: Math.round(TOKEN_LIFETIME.ACTIVATION.hours / 24),
    userId: staff.id,
  });
}
