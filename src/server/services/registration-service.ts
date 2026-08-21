import "server-only";

import type { RegistrationStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { requirePermission, type Actor } from "@/server/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { allocateMemberCode } from "@/server/lib/codes";
import { hashIdentifier } from "@/server/lib/crypto";
import { EmailService } from "@/server/lib/email";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  RuleViolationError,
  ValidationError,
} from "@/server/lib/errors";
import {
  RATE_LIMITS,
  checkPublicFormThrottle,
  recordPublicFormSubmission,
} from "@/server/lib/rate-limit";
import { getCurrentLibrary } from "@/server/lib/settings";
import { mintToken, TOKEN_LIFETIME } from "@/server/lib/tokens";
import {
  claimUnclaimedChildPhoto,
  purgeScheduledMedia,
  scheduleMediaDeletion,
} from "@/server/services/media-service";
import {
  assertVerificationSufficient,
  attachVerificationsToMember,
  beginVerificationForRegistration,
  verificationStateForRequest,
} from "@/server/services/guardian-verification-service";
import { isEligibleBirthYear } from "@/lib/birth-year";
import { formatInTimezone } from "@/lib/dates";
import { CONSENT_TEXTS, CURRENT_CONSENT_TYPES, REQUIRED_CONSENT_TYPES } from "@/lib/consent";
import { APARTMENT_ERROR, isValidApartment, normaliseApartment } from "@/lib/apartment";
import {
  VERIFICATION_CHALLENGE_HOURS,
  highestStrength,
  meetsRequiredStrength,
} from "@/lib/guardian-verification";

/**
 * Registration: submission by a guardian, review and decision by a librarian.
 *
 * The shape of this workflow is the product's most important promise: no child
 * account exists until a human at the library has looked at the request and
 * said yes. `/join` creates a *request*, never an account.
 */

export interface SubmitRegistrationInput {
  childName: string;
  childBirthYear: number;
  apartment: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  avatarKey: string | null;
  photoMediaId: string | null;
  /** Which consents the guardian granted on the form. */
  consentTypes: readonly (typeof CURRENT_CONSENT_TYPES)[number][];
  requestIp: string | null;
  userAgent: string | null;
}

/**
 * Submits a registration.
 *
 * Returns the same success shape whatever happens downstream: a duplicate, a
 * fresh request and a rate-limited caller must be indistinguishable from
 * outside, or the form becomes a way to ask "does this family already use the
 * library?".
 */
export async function submitRegistration(input: SubmitRegistrationInput): Promise<void> {
  const { library, settings } = await getCurrentLibrary();

  // --- Age, from configuration, never a literal ------------------------------
  /*
   * The library knows the year, not the birthday, so a child is one of two ages
   * on any given day. `isEligibleBirthYear` accepts the year when either of
   * them fits -- see src/lib/birth-year.ts for why that generosity is the
   * point rather than a compromise.
   */
  const thisYear = Number(formatInTimezone(new Date(), settings.timezone, "yyyy"));

  if (!isEligibleBirthYear(input.childBirthYear, settings.ageMin, settings.ageMax, thisYear)) {
    // This one IS told to the parent: it is about their own child's age, it
    // reveals nothing about anyone else, and silently swallowing it would leave
    // a family waiting for an approval that is never coming.
    throw new RuleViolationError(
      `Birth year ${input.childBirthYear} outside configured range ${settings.ageMin}-${settings.ageMax}`,
      `Our library is for readers aged ${settings.ageMin} to ${settings.ageMax}. ` +
        `We would still love to see you — do come and talk to the librarian.`,
    );
  }

  // --- Flat number ----------------------------------------------------------
  //
  // Checked here and not only in the form's schema. The action is one caller;
  // this service is the boundary, and a value that never passed through a zod
  // schema — a seed, a script, a future import — must be refused in the same
  // way. See src/lib/apartment.ts for what the shape is and why it is narrow.
  if (!isValidApartment(input.apartment)) {
    throw new ValidationError({ apartment: APARTMENT_ERROR }, "Registration submitted with an invalid flat number");
  }

  // --- Consent must be present ----------------------------------------------
  if (!input.consentTypes.includes("CHILD_ACCOUNT_CREATION")) {
    throw new ValidationError(
      { consent: "A parent or guardian needs to agree before we can create an account." },
      "Registration submitted without CHILD_ACCOUNT_CREATION consent",
    );
  }

  // --- Abuse control --------------------------------------------------------
  const throttle = await checkPublicFormThrottle(input.requestIp);
  if (!throttle.allowed) {
    throw new RateLimitedError(
      "Public registration form rate limit exceeded",
      throttle.retryAfterSeconds,
    );
  }

  const guardianEmail = input.guardianEmail.trim().toLowerCase();

  type SubmissionResult = {
    request: { id: string; childName: string; guardianName: string };
    emailChallenge: { rawToken: string; expiresAt: Date } | null;
  };
  let submission: SubmissionResult;

  try {
    submission = await prisma.$transaction(async (tx) => {
      const request = await tx.registrationRequest.create({
        data: {
          libraryId: library.id,
          status: "PENDING",
          childName: input.childName.trim(),
          childBirthYear: input.childBirthYear,
          apartment: normaliseApartment(input.apartment),
          guardianName: input.guardianName.trim(),
          guardianEmail,
          guardianPhone: input.guardianPhone.trim(),
          avatarKey: input.avatarKey,
          photoMediaId: input.photoMediaId,
          submittedIpHash: input.requestIp ? hashIdentifier(input.requestIp) : null,
        },
      });

      // The photograph, if there is one, is claimed in the same transaction that
      // links it. Until this line it carries an "unclaimed" deadline, so a form
      // that never arrives leaves nothing behind in storage.
      if (input.photoMediaId) {
        await claimUnclaimedChildPhoto(tx, {
          mediaId: input.photoMediaId,
          libraryId: library.id,
        });
      }

      // Consent is captured with the wording actually shown, so a later edit to
      // that wording cannot rewrite what this family agreed to.
      for (const type of input.consentTypes) {
        await tx.consentRecord.create({
          data: {
            libraryId: library.id,
            type,
            status: "GRANTED",
            method: "WEB_FORM",
            consentVersion: settings.consentVersion,
            consentTextSnapshot: CONSENT_TEXTS[type],
            registrationRequestId: request.id,
            ipHash: input.requestIp ? hashIdentifier(input.requestIp) : null,
            userAgentHash: input.userAgent ? hashIdentifier(input.userAgent) : null,
          },
        });
      }

      await recordAudit(tx, {
        libraryId: library.id,
        action: AUDIT_ACTIONS.REGISTRATION_SUBMITTED,
        entityType: "registration_request",
        entityId: request.id,
        actorUserId: null,
        actorLabel: "guardian (public form)",
        metadata: { apartment: request.apartment, consentTypes: input.consentTypes },
        ipHash: input.requestIp ? hashIdentifier(input.requestIp) : null,
      });

      await recordAudit(tx, {
        libraryId: library.id,
        action: AUDIT_ACTIONS.CONSENT_RECORDED,
        entityType: "registration_request",
        entityId: request.id,
        actorUserId: null,
        actorLabel: input.guardianName,
        metadata: { version: settings.consentVersion, method: "WEB_FORM" },
      });

      // Consent captured. Now the separate question of who that was: this
      // records the self-declaration explicitly, and starts an emailed
      // confirmation if the library's configured requirement calls for one.
      const { emailChallenge } = await beginVerificationForRegistration(tx, {
        libraryId: library.id,
        registrationRequestId: request.id,
        required: settings.requiredGuardianVerification,
        verificationVersion: settings.guardianVerificationVersion,
        ipHash: input.requestIp ? hashIdentifier(input.requestIp) : null,
        userAgentHash: input.userAgent ? hashIdentifier(input.userAgent) : null,
      });

      await recordAudit(tx, {
        libraryId: library.id,
        action: AUDIT_ACTIONS.VERIFICATION_RECORDED,
        entityType: "registration_request",
        entityId: request.id,
        actorUserId: null,
        actorLabel: input.guardianName,
        metadata: {
          method: "SELF_DECLARED",
          requiredStrength: settings.requiredGuardianVerification,
          challengeSent: emailChallenge !== null,
        },
      });

      // Inside the transaction so a failed insert cannot leave a family with an
      // acknowledgement for a request that does not exist.
      await recordPublicFormSubmission(input.requestIp);

      return {
        request: {
          id: request.id,
          childName: request.childName,
          guardianName: request.guardianName,
        },
        emailChallenge,
      };
    });
  } catch (error) {
    // The database refuses a second open request for the same child and flat.
    // From outside, that is indistinguishable from success — otherwise the form
    // answers "is this child already registered?" for anyone who asks.
    if (isUniqueViolation(error)) {
      // The photograph uploaded a moment ago now belongs to nothing. It is still
      // unclaimed, so this removes it immediately rather than leaving a private
      // picture of a child sitting in storage until the nightly sweep.
      if (input.photoMediaId) await purgeScheduledMedia(input.photoMediaId);
      return;
    }
    throw error;
  }

  await EmailService.sendRegistrationReceived({
    to: guardianEmail,
    guardianName: submission.request.guardianName,
    childName: submission.request.childName,
    registrationId: submission.request.id,
  });

  // Sent after commit, deliberately: a mail server having a bad minute must not
  // roll back a family's registration.
  if (submission.emailChallenge) {
    await EmailService.sendGuardianVerification({
      to: guardianEmail,
      guardianName: submission.request.guardianName,
      childName: submission.request.childName,
      verificationToken: submission.emailChallenge.rawToken,
      expiresInHours: VERIFICATION_CHALLENGE_HOURS,
      registrationId: submission.request.id,
    });
  }
}

/**
 * The librarian's queue. Only what the decision actually needs.
 *
 * Returns consent and guardian verification as two separate, explicitly
 * labelled states. They are not the same question, and the screen that decides
 * whether a child gets an account is the last place they should be blurred
 * together.
 */
export async function listRegistrations(statuses: RegistrationStatus[] = ["PENDING", "UNDER_REVIEW"]) {
  const actor = await requirePermission("registration.view");
  const { settings } = await getCurrentLibrary();

  const requests = await prisma.registrationRequest.findMany({
    where: { libraryId: actor.libraryId, status: { in: statuses } },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      status: true,
      childName: true,
      childBirthYear: true,
      apartment: true,
      guardianName: true,
      guardianEmail: true,
      guardianPhone: true,
      avatarKey: true,
      photoMediaId: true,
      submittedAt: true,
      reviewedAt: true,
      consents: {
        select: { type: true, status: true, consentVersion: true, grantedAt: true },
      },
      verifications: {
        select: {
          method: true,
          status: true,
          strength: true,
          verifiedAt: true,
          expiresAt: true,
          evidenceNote: true,
          performedBy: { select: { displayName: true } },
        },
        orderBy: { requestedAt: "asc" },
      },
    },
  });

  const now = new Date();

  return requests.map((request) => {
    const achieved = highestStrength(
      request.verifications
        .filter((v) => v.status === "VERIFIED" && (!v.expiresAt || v.expiresAt > now))
        .map((v) => v.strength),
    );

    return {
      ...request,
      consentComplete: REQUIRED_CONSENT_TYPES.every((type) =>
        request.consents.some(
          (consent) => consent.type === type && consent.status === "GRANTED",
        ),
      ),
      verification: {
        achieved,
        required: settings.requiredGuardianVerification,
        satisfied: meetsRequiredStrength(achieved, settings.requiredGuardianVerification),
        awaitingGuardian: request.verifications.some((v) => v.status === "PENDING"),
      },
    };
  });
}

export async function countPendingRegistrations(): Promise<number> {
  const actor = await requirePermission("registration.view");
  return prisma.registrationRequest.count({
    where: { libraryId: actor.libraryId, status: { in: ["PENDING", "UNDER_REVIEW"] } },
  });
}

/** Marks a request as being looked at, so two librarians do not both work it. */
export async function markUnderReview(registrationId: string): Promise<void> {
  const actor = await requirePermission("registration.review");
  const request = await loadRequest(actor, registrationId);

  if (request.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.registrationRequest.update({
      where: { id: request.id },
      data: { status: "UNDER_REVIEW", reviewedById: actor.userId },
    });
    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.REGISTRATION_REVIEWED,
      entityType: "registration_request",
      entityId: request.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
    });
  });
}

export interface ApprovalResult {
  memberUserId: string;
  memberCode: string;
  activationEmailSent: boolean;
}

/**
 * Approves a registration and creates the member account.
 *
 * Everything that must be true together happens in one transaction: the member,
 * their card, the guardian link, the consent re-attachment, the activation
 * token and the audit trail. The email is sent afterwards, deliberately — a mail
 * server having a bad minute must not roll back an approval.
 */
export async function approveRegistration(registrationId: string): Promise<ApprovalResult> {
  const actor = await requirePermission("registration.review");
  const { settings } = await getCurrentLibrary();
  const request = await loadRequest(actor, registrationId);

  if (request.status === "APPROVED") {
    throw new ConflictError(
      `Registration ${registrationId} already approved`,
      "This reader has already been approved.",
    );
  }
  if (request.status === "REJECTED" || request.status === "WITHDRAWN") {
    throw new RuleViolationError(
      `Registration ${registrationId} is ${request.status}`,
      "This registration has already been closed.",
    );
  }

  // Re-check the age at approval time: a request can sit in the queue, and the
  // configured range can change while it does.
  const thisYear = Number(formatInTimezone(new Date(), settings.timezone, "yyyy"));
  if (!isEligibleBirthYear(request.childBirthYear, settings.ageMin, settings.ageMax, thisYear)) {
    const turns = thisYear - request.childBirthYear;
    throw new RuleViolationError(
      `Birth year ${request.childBirthYear} outside range at approval time`,
      `This reader turns ${turns} this year, and the library is currently for ages ${settings.ageMin} to ${settings.ageMax}.`,
    );
  }

  // THE PRODUCTION SAFETY GATE (1 of 2).
  //
  // No account is created until the guardian verification this library requires
  // is on record. The request stays exactly where it is — PENDING or
  // UNDER_REVIEW — so a librarian can come back to it once the parent has
  // confirmed, or record an in-person confirmation themselves.
  const verification = await verificationStateForRequest(
    request.id,
    settings.requiredGuardianVerification,
  );
  await assertVerificationSufficient(verification, `Approval of registration ${request.id}`);

  const result = await prisma.$transaction(async (tx) => {
    const memberCode = await allocateMemberCode(
      tx,
      actor.libraryId,
      settings.memberCodePrefix,
      settings.memberCodePadding,
    );

    const member = await tx.appUser.create({
      data: {
        libraryId: actor.libraryId,
        kind: "MEMBER",
        displayName: request.childName,
        // No email and no password: the account is INVITED until the guardian
        // follows the activation link and a secret word is chosen.
        status: "INVITED",
        mustSetPassword: true,
        createdById: actor.userId,
        memberProfile: {
          create: {
            libraryId: actor.libraryId,
            memberCode,
            birthYear: request.childBirthYear,
            apartment: request.apartment,
            avatarKey: request.avatarKey,
            photoMediaId: request.photoMediaId,
          },
        },
      },
    });

    const memberRole = await tx.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: actor.libraryId, key: "MEMBER" } },
      select: { id: true },
    });
    await tx.userRole.create({
      data: { userId: member.id, roleId: memberRole.id, grantedById: actor.userId },
    });

    // One guardian row per email, reused across siblings.
    const guardian = await tx.guardian.upsert({
      where: {
        libraryId_email: { libraryId: actor.libraryId, email: request.guardianEmail },
      },
      create: {
        libraryId: actor.libraryId,
        fullName: request.guardianName,
        email: request.guardianEmail,
        phone: request.guardianPhone,
        apartment: request.apartment,
      },
      update: { phone: request.guardianPhone },
    });

    await tx.guardianMember.create({
      data: { guardianId: guardian.id, memberUserId: member.id, isPrimary: true },
    });

    // Move the consent captured at submission onto the real people it concerns,
    // so the evidence survives independently of the request row.
    await tx.consentRecord.updateMany({
      where: { registrationRequestId: request.id },
      data: { memberUserId: member.id, guardianId: guardian.id },
    });

    // The verification evidence travels the same way, and for the same reason.
    await attachVerificationsToMember(tx, {
      registrationRequestId: request.id,
      memberUserId: member.id,
      guardianId: guardian.id,
    });

    await tx.registrationRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedById: actor.userId,
        createdMemberUserId: member.id,
      },
    });

    const token = await mintToken(tx, {
      userId: member.id,
      type: "ACTIVATION",
      createdById: actor.userId,
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.REGISTRATION_APPROVED,
      entityType: "registration_request",
      entityId: request.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // The member code identifies the card, not the child. No token, ever.
      metadata: { memberCode, memberUserId: member.id },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { kind: "MEMBER", via: "registration approval" },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ACTIVATION_SENT,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { expiresAt: token.expiresAt.toISOString(), channel: "guardian email" },
    });

    return {
      memberUserId: member.id,
      memberCode,
      rawToken: token.rawToken,
      guardianEmail: guardian.email,
      guardianName: guardian.fullName,
      childName: member.displayName,
    };
  });

  const activationEmailSent = await EmailService.sendActivation({
    to: result.guardianEmail,
    guardianName: result.guardianName,
    childName: result.childName,
    memberCode: result.memberCode,
    activationToken: result.rawToken,
    expiresInDays: Math.round(TOKEN_LIFETIME.ACTIVATION.hours / 24),
    memberUserId: result.memberUserId,
  });

  return {
    memberUserId: result.memberUserId,
    memberCode: result.memberCode,
    activationEmailSent,
  };
}

/**
 * Rejects a registration. The internal reason is required and is never sent to
 * the family — the email is deliberately soft and points them at the librarian.
 */
export async function rejectRegistration(
  registrationId: string,
  internalReason: string,
): Promise<void> {
  const actor = await requirePermission("registration.review");
  const request = await loadRequest(actor, registrationId);

  const reason = internalReason.trim();
  if (reason.length < 3) {
    throw new ValidationError(
      { reason: "Please note why, for the library's own records." },
      "Rejection attempted without an internal reason",
    );
  }

  if (request.status === "APPROVED") {
    throw new ConflictError(
      `Registration ${registrationId} already approved`,
      "This reader has already been approved.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.registrationRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedById: actor.userId,
        reviewNote: reason,
      },
    });

    // A closed request has no reason to keep a private photograph of a child.
    // The request row keeps its reference until the sweeper clears the object,
    // which is the point: the row is the ledger.
    if (request.photoMediaId) await scheduleMediaDeletion(tx, request.photoMediaId);

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.REGISTRATION_REJECTED,
      entityType: "registration_request",
      entityId: request.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // The reason belongs in the audit trail, which only Super Admin reads.
      metadata: { reason },
    });
  });

  if (request.photoMediaId) await purgeScheduledMedia(request.photoMediaId);

  await EmailService.sendRegistrationRejected({
    to: request.guardianEmail,
    guardianName: request.guardianName,
    childName: request.childName,
    registrationId: request.id,
  });
}

async function loadRequest(actor: Actor, registrationId: string) {
  const request = await prisma.registrationRequest.findFirst({
    // Scoped by library: an id from elsewhere resolves to nothing.
    where: { id: registrationId, libraryId: actor.libraryId },
  });

  if (!request) {
    throw new NotFoundError(`Registration ${registrationId} not found for actor ${actor.userId}`);
  }
  return request;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export { RATE_LIMITS };
