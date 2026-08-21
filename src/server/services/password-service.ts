import "server-only";

import { prisma } from "@/server/db";
import { requireActor } from "@/server/authz";
import { revokeAllSessionsForUser } from "@/server/auth/session-store";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { EmailService } from "@/server/lib/email";
import { RateLimitedError, ValidationError } from "@/server/lib/errors";
import {
  checkPasswordPolicy,
  hashPassword,
  isPasswordBreached,
  verifyPassword,
  type PasswordAudience,
} from "@/server/lib/password";
import {
  RATE_LIMITS,
  checkActionThrottle,
  recordAction,
} from "@/server/lib/rate-limit";
import { getCurrentLibrary } from "@/server/lib/settings";
import {
  assertVerificationSufficient,
  verificationStateForMember,
} from "@/server/services/guardian-verification-service";
import {
  consumeToken,
  inspectToken,
  mintToken,
  TOKEN_LIFETIME,
} from "@/server/lib/tokens";

/**
 * Activation, password setting, changing and resetting.
 *
 * The invariant running through all of it: nobody at the library can ever see,
 * choose or receive a member's password. Staff can only ever cause a fresh
 * single-use link to be emailed to the guardian.
 */

/** The one message every failed link produces, whatever the real reason. */
export const GENERIC_LINK_FAILURE =
  "That link has expired or has already been used. Ask your librarian for a new one.";

function audienceFor(kind: "STAFF" | "MEMBER" | "GUARDIAN"): PasswordAudience {
  return kind === "STAFF" ? "staff" : "member";
}

/**
 * Words this library should refuse in a password — its own name and its
 * community's. Read from configuration, so the check travels with the tenant.
 */
async function libraryForbiddenWords(): Promise<string[]> {
  const { library, community } = await getCurrentLibrary();
  return [library.name, community.name];
}

/**
 * The single gate every new password passes through.
 *
 * Combines the synchronous policy with the optional breach check, so no entry
 * point can accidentally apply one and forget the other.
 */
async function assertPasswordAcceptable(
  password: string,
  audience: PasswordAudience,
  personalDetails: readonly (string | null | undefined)[],
  field = "password",
): Promise<void> {
  const policy = checkPasswordPolicy(password, audience, {
    forbiddenWords: await libraryForbiddenWords(),
    personalDetails,
  });
  if (!policy.ok) {
    throw new ValidationError({ [field]: policy.message ?? "Please choose a different one." });
  }

  // Opt-in, and fails open — see isPasswordBreached.
  if (await isPasswordBreached(password)) {
    throw new ValidationError({
      [field]:
        audience === "member"
          ? "That one has turned up in a list of leaked passwords. Please pick another."
          : "That password appears in known breach corpora. Please choose another.",
    });
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export interface ActivationView {
  valid: boolean;
  childName?: string;
  memberCode?: string;
}

/** Decides whether to render the "choose a secret word" form. Does not consume. */
export async function inspectActivationToken(
  rawToken: string,
  requestIp: string | null,
): Promise<ActivationView> {
  const throttle = await checkActionThrottle({
    bucket: "token-attempt",
    subject: requestIp,
    max: RATE_LIMITS.tokenAttemptsMax,
    windowMinutes: RATE_LIMITS.tokenAttemptsWindowMinutes,
  });
  if (!throttle.allowed) {
    throw new RateLimitedError("Activation attempts exceeded", throttle.retryAfterSeconds);
  }
  await recordAction("token-attempt", requestIp);

  const lookup = await inspectToken(rawToken, "ACTIVATION");
  if (!lookup.ok) return { valid: false };

  const user = await prisma.appUser.findUnique({
    where: { id: lookup.userId },
    select: { displayName: true, memberProfile: { select: { memberCode: true } } },
  });

  // Name and card number only — nothing about the guardian, nothing about
  // anyone else, and no internal id.
  return {
    valid: true,
    childName: user?.displayName,
    memberCode: user?.memberProfile?.memberCode,
  };
}

/**
 * Completes activation: consumes the token, sets the first password, and makes
 * the account usable.
 */
export async function activateAccount(params: {
  rawToken: string;
  newPassword: string;
  requestIp: string | null;
}): Promise<{ memberCode: string | null }> {
  const lookup = await inspectToken(params.rawToken, "ACTIVATION");
  if (!lookup.ok) {
    throw new ValidationError({ token: GENERIC_LINK_FAILURE }, `Activation rejected: ${lookup.reason}`);
  }

  const user = await prisma.appUser.findUniqueOrThrow({
    where: { id: lookup.userId },
    select: { id: true, libraryId: true, kind: true, displayName: true },
  });

  const profile = await prisma.memberProfile.findUnique({
    where: { userId: user.id },
    select: { memberCode: true },
  });

  // THE PRODUCTION SAFETY GATE (2 of 2).
  //
  // Approval already checked this, so reaching it here means the configured
  // requirement was raised while the activation email sat in an inbox. An
  // account created under the old bar must not walk through the new one: it
  // stays INVITED until the verification is on record.
  //
  // Staff accounts are exempt — this gate is about the guardian of a child, and
  // a staff member has no guardian.
  if (user.kind === "MEMBER") {
    const verification = await verificationStateForMember(user.id);
    await assertVerificationSufficient(verification, `Activation of member ${user.id}`);
  }

  await assertPasswordAcceptable(params.newPassword, audienceFor(user.kind), [
    user.displayName,
    profile?.memberCode,
  ]);

  const passwordHash = await hashPassword(params.newPassword);

  const memberCode = await prisma.$transaction(async (tx) => {
    // Atomic single-use. A double-submitted form loses the second race here.
    const consumed = await consumeToken(tx, lookup.tokenId);
    if (!consumed) {
      throw new ValidationError({ token: GENERIC_LINK_FAILURE }, "Activation token already consumed");
    }

    await tx.appUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        status: "ACTIVE",
        mustSetPassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await recordAudit(tx, {
      libraryId: user.libraryId,
      action: AUDIT_ACTIONS.ACCOUNT_ACTIVATED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: user.id,
      actorLabel: user.displayName,
      metadata: { via: "activation link" },
    });

    const profile = await tx.memberProfile.findUnique({
      where: { userId: user.id },
      select: { memberCode: true },
    });
    return profile?.memberCode ?? null;
  });

  return { memberCode };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Starts a reset.
 *
 * Always resolves successfully, whether or not the identifier matches anything.
 * The caller shows one message regardless — otherwise this endpoint answers
 * "is MJCL-R0042 a real child?" for anyone who asks.
 */
export async function requestPasswordReset(params: {
  identifier: string;
  requestIp: string | null;
}): Promise<void> {
  const throttle = await checkActionThrottle({
    bucket: "password-reset",
    subject: params.requestIp,
    max: RATE_LIMITS.passwordResetRequestsMax,
    windowMinutes: RATE_LIMITS.passwordResetWindowMinutes,
  });

  // Even the rate limit is silent: telling the caller they are being throttled
  // would leak that they had found something worth throttling.
  if (!throttle.allowed) return;
  await recordAction("password-reset", params.requestIp);

  const identifier = params.identifier.trim().toLowerCase();
  if (!identifier) return;

  const user = await findUserByIdentifier(identifier);
  if (!user || user.status !== "ACTIVE") return;

  const recipient = await recoveryEmailFor(user.id, user.kind, user.email);
  if (!recipient) return;

  const token = await prisma.$transaction(async (tx) => {
    const minted = await mintToken(tx, {
      userId: user.id,
      type: "PASSWORD_RESET",
      requestIp: params.requestIp,
    });

    await recordAudit(tx, {
      libraryId: user.libraryId,
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: null,
      actorLabel: user.displayName,
      // No token, and no email address: the audit log records that a reset was
      // requested, not how to complete it.
      metadata: { expiresAt: minted.expiresAt.toISOString() },
    });

    return minted;
  });

  await EmailService.sendPasswordReset({
    to: recipient,
    childName: user.displayName,
    resetToken: token.rawToken,
    expiresInHours: TOKEN_LIFETIME.PASSWORD_RESET.hours,
    userId: user.id,
  });
}

export async function inspectResetToken(
  rawToken: string,
  requestIp: string | null,
): Promise<{ valid: boolean; displayName?: string }> {
  const throttle = await checkActionThrottle({
    bucket: "token-attempt",
    subject: requestIp,
    max: RATE_LIMITS.tokenAttemptsMax,
    windowMinutes: RATE_LIMITS.tokenAttemptsWindowMinutes,
  });
  if (!throttle.allowed) {
    throw new RateLimitedError("Reset attempts exceeded", throttle.retryAfterSeconds);
  }
  await recordAction("token-attempt", requestIp);

  const lookup = await inspectToken(rawToken, "PASSWORD_RESET");
  if (!lookup.ok) return { valid: false };

  const user = await prisma.appUser.findUnique({
    where: { id: lookup.userId },
    select: { displayName: true },
  });
  return { valid: true, displayName: user?.displayName };
}

/** Completes a reset and signs every device out. */
export async function completePasswordReset(params: {
  rawToken: string;
  newPassword: string;
}): Promise<void> {
  const lookup = await inspectToken(params.rawToken, "PASSWORD_RESET");
  if (!lookup.ok) {
    throw new ValidationError({ token: GENERIC_LINK_FAILURE }, `Reset rejected: ${lookup.reason}`);
  }

  const user = await prisma.appUser.findUniqueOrThrow({
    where: { id: lookup.userId },
    select: { id: true, libraryId: true, kind: true, displayName: true, email: true },
  });

  await assertPasswordAcceptable(params.newPassword, audienceFor(user.kind), [
    user.displayName,
    user.email,
  ]);

  const passwordHash = await hashPassword(params.newPassword);

  await prisma.$transaction(async (tx) => {
    const consumed = await consumeToken(tx, lookup.tokenId);
    if (!consumed) {
      throw new ValidationError({ token: GENERIC_LINK_FAILURE }, "Reset token already consumed");
    }

    await tx.appUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustSetPassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await recordAudit(tx, {
      libraryId: user.libraryId,
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: user.id,
      actorLabel: user.displayName,
    });
  });

  // Whoever asked for the reset may not be who was signed in. Every existing
  // session dies, including one an attacker might already hold.
  const revoked = await revokeAllSessionsForUser(user.id);

  await recordAudit(prisma, {
    libraryId: user.libraryId,
    action: AUDIT_ACTIONS.SESSIONS_REVOKED,
    entityType: "app_user",
    entityId: user.id,
    actorUserId: user.id,
    actorLabel: user.displayName,
    metadata: { count: revoked, reason: "password reset" },
  });

  const recipient = await recoveryEmailFor(user.id, user.kind, user.email);
  if (recipient) {
    await EmailService.sendPasswordChanged({
      to: recipient,
      childName: user.displayName,
      userId: user.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Password change (signed in)
// ---------------------------------------------------------------------------

/**
 * Changes the signed-in user's own password.
 *
 * Requires the current password: a borrowed unlocked device must not be enough
 * to take an account over permanently.
 */
export async function changeOwnPassword(params: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const actor = await requireActor();

  const user = await prisma.appUser.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { id: true, libraryId: true, kind: true, displayName: true, email: true, passwordHash: true },
  });

  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, params.currentPassword))) {
    throw new ValidationError({
      currentPassword: "That is not the current secret word.",
    });
  }

  await assertPasswordAcceptable(
    params.newPassword,
    audienceFor(user.kind),
    [user.displayName, user.email],
    "newPassword",
  );

  if (params.newPassword === params.currentPassword) {
    throw new ValidationError({ newPassword: "That is the same as the old one." });
  }

  const passwordHash = await hashPassword(params.newPassword);
  const changedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.appUser.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: changedAt, mustSetPassword: false },
    });

    await recordAudit(tx, {
      libraryId: user.libraryId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: "app_user",
      entityId: user.id,
      actorUserId: user.id,
      actorLabel: user.displayName,
    });
  });

  /*
   * EVERY session ends, including the one that made this change.
   *
   * Keeping the current session alive would mean rotating its cookie, which
   * only the auth layer can do. Rather than pretend, we sign everything out and
   * ask the person to sign in again with the new password. That is also the
   * strictest reading: if the change was made by someone who should not have
   * had the device, they lose it immediately too.
   *
   * resolveSession independently refuses any session created before
   * passwordChangedAt, so this holds even if the delete below fails.
   */
  const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });

  await recordAudit(prisma, {
    libraryId: user.libraryId,
    action: AUDIT_ACTIONS.SESSIONS_REVOKED,
    entityType: "app_user",
    entityId: user.id,
    actorUserId: user.id,
    actorLabel: user.displayName,
    metadata: { count, reason: "password change" },
  });

  const recipient = await recoveryEmailFor(user.id, user.kind, user.email);
  if (recipient) {
    await EmailService.sendPasswordChanged({
      to: recipient,
      childName: user.displayName,
      userId: user.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

/**
 * Resolves either login identity: a member card code, a username, or a staff
 * email address. Mirrors the lookup used at sign-in, deliberately — a reset
 * that accepted a different set of identifiers than login would be confusing
 * and would leak the difference.
 */
async function findUserByIdentifier(identifier: string) {
  const byCode = await prisma.memberProfile.findFirst({
    where: { memberCode: { equals: identifier, mode: "insensitive" } },
    select: { user: true },
  });
  if (byCode?.user) return byCode.user;

  return prisma.appUser.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
  });
}

/**
 * Where recovery mail goes.
 *
 * For a member, that is their guardian's inbox first — a child has no email
 * address, and this is precisely why the guardian relationship exists. For
 * staff, their own address.
 *
 * The fallback to a member's own address is deliberately last and deliberately
 * present. It is not a way around the guardian: a registered child has a
 * guardian and always reaches this by the branch above. It is for the account
 * that somehow has no guardian row — an import, a link deleted by hand — where
 * the choice is between mailing the address on the account and **silently
 * sending nothing at all**, which is how somebody ends up locked out of a
 * library with no way to find out why.
 */
export async function recoveryEmailFor(
  userId: string,
  kind: "STAFF" | "MEMBER" | "GUARDIAN",
  ownEmail: string | null,
): Promise<string | null> {
  if (kind === "STAFF") return ownEmail;

  const link = await prisma.guardianMember.findFirst({
    where: { memberUserId: userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { guardian: { select: { email: true } } },
  });

  return link?.guardian.email ?? ownEmail;
}
