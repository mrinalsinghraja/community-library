import "server-only";

import { prisma } from "@/server/db";
import { requirePermission, type Actor } from "@/server/authz";
import { revokeAllSessionsForUser } from "@/server/auth/session-store";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { EmailService } from "@/server/lib/email";
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { mintToken, revokeTokens, TOKEN_LIFETIME } from "@/server/lib/tokens";
import { ROLE_KEYS, type RoleKey } from "@/lib/permissions";

/**
 * Staff management. This is the privilege-escalation surface, so the rules are
 * explicit and each one has a test:
 *
 *   • Only `user.manage_staff` (Super Admin) reaches any of it.
 *   • A librarian cannot be created as, or promoted to, Super Admin by anyone
 *     without that permission — and nobody can grant themselves anything.
 *   • Nobody can suspend, deactivate or demote themselves. Locking the only
 *     administrator out of their own library is a real, easy accident.
 *   • The last active Super Admin cannot be removed. There must always be
 *     someone who can let everyone else back in.
 *
 * Staff never receive a password from us either: a new librarian gets the same
 * single-use activation link a child's guardian does.
 */

/** Roles that may be granted to a staff account through this service. */
const ASSIGNABLE_STAFF_ROLES: readonly RoleKey[] = [ROLE_KEYS.LIBRARIAN, ROLE_KEYS.SUPER_ADMIN];

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
  roleKey: RoleKey;
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
  if (!ASSIGNABLE_STAFF_ROLES.includes(input.roleKey)) {
    throw new ValidationError(
      { roleKey: "Choose a valid role." },
      `Attempt to assign non-staff role ${input.roleKey}`,
    );
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
    where: { libraryId_key: { libraryId: actor.libraryId, key: input.roleKey } },
    select: { id: true, isAssignable: true },
  });
  if (!role) throw new NotFoundError(`Role ${input.roleKey} not found`);
  if (!role.isAssignable) {
    throw new RuleViolationError(
      `Role ${input.roleKey} is not assignable`,
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
      metadata: { kind: "STAFF", role: input.roleKey },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ROLE_GRANTED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { role: input.roleKey },
    });

    return { user, token };
  });

  const emailSent = await EmailService.sendStaffInvitation({
    to: email,
    name: displayName,
    roleName: input.roleKey === ROLE_KEYS.SUPER_ADMIN ? "a Super Admin" : "a Librarian",
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

/**
 * Changes a staff member's role.
 *
 * The self-check is the important line: without it, a librarian who somehow
 * reached this service could promote themselves, and a Super Admin could demote
 * themselves out of the ability to undo it.
 */
export async function setStaffRole(staffUserId: string, roleKey: RoleKey): Promise<void> {
  const actor = await requirePermission("role.manage");

  if (staffUserId === actor.userId) {
    throw new RuleViolationError(
      "Self role change attempt",
      "You cannot change your own role. Ask another administrator.",
    );
  }

  if (!ASSIGNABLE_STAFF_ROLES.includes(roleKey)) {
    throw new ValidationError({ roleKey: "Choose a valid role." });
  }

  const staff = await loadStaff(actor, staffUserId);

  // Demoting the last Super Admin is the same accident as suspending them.
  if (isSuperAdmin(staff) && roleKey !== ROLE_KEYS.SUPER_ADMIN) {
    await assertNotLastSuperAdmin(actor.libraryId, staff.id);
  }

  const role = await prisma.role.findUniqueOrThrow({
    where: { libraryId_key: { libraryId: actor.libraryId, key: roleKey } },
    select: { id: true },
  });

  const previousRoles = staff.userRoles.map((entry) => entry.role.key);

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: staff.id } });
    await tx.userRole.create({
      data: { userId: staff.id, roleId: role.id, grantedById: actor.userId },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ROLE_GRANTED,
      entityType: "app_user",
      entityId: staff.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { from: previousRoles, to: roleKey },
    });
  });

  // Permissions are read from the database on every request, so the change is
  // live immediately — no session needs to be destroyed for it to take effect.
}

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
