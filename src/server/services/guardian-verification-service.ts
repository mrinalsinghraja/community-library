import "server-only";

import type {
  GuardianVerificationMethod,
  GuardianVerificationStrength,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/server/db";
import { requirePermission } from "@/server/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { generateToken, hashIdentifier, hashToken } from "@/server/lib/crypto";
import { NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import {
  STRENGTH_BY_METHOD,
  VERIFICATION_CHALLENGE_HOURS,
  highestStrength,
  meetsRequiredStrength,
  selfServiceMethodFor,
} from "@/lib/guardian-verification";

/**
 * Guardian verification.
 *
 * ⚠️  This module records evidence. It does not, and cannot, decide whether that
 * evidence satisfies any law. What a deployment requires lives in
 * `library_settings.required_guardian_verification`, and the decision to set it
 * is a legal one. See docs/GUARDIAN_VERIFICATION.md.
 *
 * Consent and verification are kept apart throughout — see src/lib/consent.ts
 * for the other half. A guardian ticking a box produces a consent record and a
 * SELF_DECLARED verification. Those are two different claims, and only one of
 * them is about identity.
 *
 * Nothing here stores or requests an identity document, a government
 * identifier, or an Aadhaar number, and nothing here implements KYC. The
 * strongest evidence this module holds is "a named member of staff says they
 * confirmed it" or "somebody opened a single-use link sent to the guardian's
 * inbox".
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface VerificationState {
  /** The best VERIFIED, unexpired verification on record. */
  achieved: GuardianVerificationStrength;
  required: GuardianVerificationStrength;
  satisfied: boolean;
  /** A challenge has been sent and is waiting on the guardian. */
  awaitingGuardian: boolean;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Records the weakest thing there is: a box was ticked on a form.
 *
 * Written as an explicit row rather than left implicit, because "we have no
 * record" and "we have a record that this was never verified" are different
 * states, and only the second one survives an audit.
 *
 * Called inside the registration transaction.
 */
export async function recordSelfDeclaration(
  db: Db,
  params: {
    libraryId: string;
    registrationRequestId: string;
    verificationVersion: string;
    ipHash: string | null;
    userAgentHash: string | null;
  },
): Promise<void> {
  await db.guardianVerification.create({
    data: {
      libraryId: params.libraryId,
      registrationRequestId: params.registrationRequestId,
      method: "SELF_DECLARED",
      // The method completed — somebody did tick the box. What it is *worth* is
      // the strength field's job, and the database will not let it be anything
      // other than SELF_DECLARED.
      status: "VERIFIED",
      strength: STRENGTH_BY_METHOD.SELF_DECLARED,
      verificationVersion: params.verificationVersion,
      verifiedAt: new Date(),
      ipHash: params.ipHash,
      userAgentHash: params.userAgentHash,
    },
  });
}

/**
 * Creates a pending EMAIL_CONFIRMATION challenge and returns the raw token.
 *
 * Only the SHA-256 is stored, exactly as for activation and reset links. The
 * raw value exists in one email and nowhere else — not in the database, not in
 * the audit log, not in any log line.
 */
export async function createEmailChallenge(
  db: Db,
  params: {
    libraryId: string;
    registrationRequestId: string;
    verificationVersion: string;
    ipHash: string | null;
  },
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateToken(32);
  const expiresAt = new Date(Date.now() + VERIFICATION_CHALLENGE_HOURS * 3_600_000);

  await db.guardianVerification.create({
    data: {
      libraryId: params.libraryId,
      registrationRequestId: params.registrationRequestId,
      method: "EMAIL_CONFIRMATION",
      status: "PENDING",
      strength: STRENGTH_BY_METHOD.EMAIL_CONFIRMATION,
      verificationVersion: params.verificationVersion,
      challengeTokenHash: hashToken(rawToken),
      challengeExpiresAt: expiresAt,
      ipHash: params.ipHash,
    },
  });

  return { rawToken, expiresAt };
}

export type ChallengeOutcome =
  | { ok: true; childName: string }
  | { ok: false; reason: "unknown" | "expired" | "already_used" | "revoked" };

/**
 * Completes an emailed confirmation.
 *
 * Single use, enforced the same way tokens are: one conditional UPDATE, so two
 * simultaneous clicks cannot both win. Public entry point — the token is the
 * only credential, which is why it is 256 bits and short-lived.
 */
export async function completeEmailChallenge(params: {
  rawToken: string;
  requestIp: string | null;
}): Promise<ChallengeOutcome> {
  const tokenHash = hashToken(params.rawToken);

  const record = await prisma.guardianVerification.findUnique({
    where: { challengeTokenHash: tokenHash },
    select: {
      id: true,
      libraryId: true,
      status: true,
      challengeExpiresAt: true,
      registrationRequest: { select: { id: true, childName: true, guardianName: true } },
    },
  });

  if (!record) return { ok: false, reason: "unknown" };

  // Count the attempt whatever happens: a spike against a spent challenge is
  // exactly the signal worth being able to see.
  await prisma.guardianVerification.update({
    where: { id: record.id },
    data: { challengeAttempts: { increment: 1 } },
  });

  if (record.status === "REVOKED") return { ok: false, reason: "revoked" };
  if (record.status === "VERIFIED") return { ok: false, reason: "already_used" };
  if (record.challengeExpiresAt && record.challengeExpiresAt < new Date()) {
    await prisma.guardianVerification.update({
      where: { id: record.id },
      data: { status: "EXPIRED" },
    });
    return { ok: false, reason: "expired" };
  }

  const now = new Date();
  const { count } = await prisma.guardianVerification.updateMany({
    where: { id: record.id, status: "PENDING" },
    data: {
      status: "VERIFIED",
      verifiedAt: now,
      // The challenge is spent. Clearing the hash means a replay finds nothing
      // at all, rather than finding a used record to reason about.
      challengeTokenHash: null,
      ipHash: params.requestIp ? hashIdentifier(params.requestIp) : undefined,
    },
  });

  if (count !== 1) return { ok: false, reason: "already_used" };

  await recordAudit(prisma, {
    libraryId: record.libraryId,
    action: AUDIT_ACTIONS.VERIFICATION_COMPLETED,
    entityType: "guardian_verification",
    entityId: record.id,
    actorUserId: null,
    actorLabel: record.registrationRequest?.guardianName ?? "guardian",
    // Records that the method completed. Never the token.
    metadata: { method: "EMAIL_CONFIRMATION", strength: "EMAIL_CONFIRMED" },
    ipHash: params.requestIp ? hashIdentifier(params.requestIp) : null,
  });

  return { ok: true, childName: record.registrationRequest?.childName ?? "your child" };
}

/**
 * A named member of staff records that they confirmed the guardian themselves.
 *
 * The note is a sentence, not a document: "spoke to her at the desk on
 * Saturday". A CHECK constraint caps its length, and this system stores no
 * identity documents of any kind.
 */
export async function recordStaffVerification(params: {
  registrationRequestId: string;
  method: Extract<GuardianVerificationMethod, "STAFF_VERIFIED" | "OTHER">;
  evidenceNote: string;
  otherStrength?: GuardianVerificationStrength;
}): Promise<void> {
  const actor = await requirePermission("guardian.verify");
  const { settings } = await getCurrentLibrary();

  const note = params.evidenceNote.trim();
  if (note.length < 3) {
    throw new ValidationError(
      { evidenceNote: "Please note briefly how you confirmed this — for the library's records." },
      "Staff verification attempted without a note",
    );
  }
  if (note.length > 500) {
    throw new ValidationError({
      evidenceNote: "Please keep this to a short note. Do not record identity documents here.",
    });
  }

  const request = await prisma.registrationRequest.findFirst({
    where: { id: params.registrationRequestId, libraryId: actor.libraryId },
    select: { id: true, childName: true, status: true },
  });
  if (!request) {
    throw new NotFoundError(`Registration ${params.registrationRequestId} not found`);
  }

  const strength =
    params.method === "OTHER"
      ? (params.otherStrength ?? "NONE")
      : STRENGTH_BY_METHOD[params.method];

  await prisma.$transaction(async (tx) => {
    const created = await tx.guardianVerification.create({
      data: {
        libraryId: actor.libraryId,
        registrationRequestId: request.id,
        method: params.method,
        status: "VERIFIED",
        strength,
        verificationVersion: settings.guardianVerificationVersion,
        verifiedAt: new Date(),
        performedById: actor.userId,
        evidenceNote: note,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.VERIFICATION_RECORDED,
      entityType: "guardian_verification",
      entityId: created.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { method: params.method, strength, registrationRequestId: request.id },
    });
  });
}

// ---------------------------------------------------------------------------
// Reading the state
// ---------------------------------------------------------------------------

/**
 * The verification state of a registration request.
 *
 * Expiry is applied at read time, deliberately: a verification that lapsed
 * yesterday must read as lapsed today even if no job has run since. Same
 * principle as overdue loans never being a stored column.
 */
export async function verificationStateForRequest(
  registrationRequestId: string,
  requiredOverride?: GuardianVerificationStrength,
): Promise<VerificationState> {
  const required = requiredOverride ?? (await getCurrentLibrary()).settings.requiredGuardianVerification;

  const records = await prisma.guardianVerification.findMany({
    where: { registrationRequestId },
    select: { status: true, strength: true, expiresAt: true },
  });

  const now = new Date();
  const achieved = highestStrength(
    records
      .filter(
        (record) =>
          record.status === "VERIFIED" && (!record.expiresAt || record.expiresAt > now),
      )
      .map((record) => record.strength),
  );

  return {
    achieved,
    required,
    satisfied: meetsRequiredStrength(achieved, required),
    awaitingGuardian: records.some((record) => record.status === "PENDING"),
  };
}

/** The same question, asked of a member account that already exists. */
export async function verificationStateForMember(
  memberUserId: string,
): Promise<VerificationState> {
  const { settings } = await getCurrentLibrary();

  const records = await prisma.guardianVerification.findMany({
    where: {
      OR: [
        { memberUserId },
        { registrationRequest: { createdMemberUserId: memberUserId } },
      ],
    },
    select: { status: true, strength: true, expiresAt: true },
  });

  const now = new Date();
  const achieved = highestStrength(
    records
      .filter(
        (record) =>
          record.status === "VERIFIED" && (!record.expiresAt || record.expiresAt > now),
      )
      .map((record) => record.strength),
  );

  return {
    achieved,
    required: settings.requiredGuardianVerification,
    satisfied: meetsRequiredStrength(achieved, settings.requiredGuardianVerification),
    awaitingGuardian: records.some((record) => record.status === "PENDING"),
  };
}

/**
 * THE PRODUCTION SAFETY GATE.
 *
 * Called before a registration may be approved and again before an account may
 * become ACTIVE. Two checks rather than one, because the configured requirement
 * can be raised while a request sits in the queue or while an activation email
 * sits unread in an inbox — and when it is raised, the accounts it was raised
 * for must not slip through behind it.
 */
export async function assertVerificationSufficient(
  state: VerificationState,
  context: string,
): Promise<void> {
  if (state.satisfied) return;

  throw new RuleViolationError(
    `${context}: guardian verification ${state.achieved} does not meet required ${state.required}`,
    state.awaitingGuardian
      ? "We are still waiting for the parent or guardian to confirm. This will be ready once they do."
      : "Guardian verification is not complete for this reader yet.",
  );
}

/**
 * Starts whatever verification the library's configuration can begin on its own.
 *
 * Always records the self-declaration. If the requirement is higher and can be
 * met without a staff member — today that means an emailed confirmation — the
 * challenge is created here and the email is sent by the caller after commit.
 *
 * If the requirement can only be met by a person (STAFF_VERIFIED,
 * IDENTITY_PROVIDER), nothing further is started and the request simply waits.
 * That is the designed outcome, not a failure: §9 of the brief says a
 * registration may remain pending until the requirement is met.
 */
export async function beginVerificationForRegistration(
  db: Db,
  params: {
    libraryId: string;
    registrationRequestId: string;
    required: GuardianVerificationStrength;
    verificationVersion: string;
    ipHash: string | null;
    userAgentHash: string | null;
  },
): Promise<{ emailChallenge: { rawToken: string; expiresAt: Date } | null }> {
  await recordSelfDeclaration(db, {
    libraryId: params.libraryId,
    registrationRequestId: params.registrationRequestId,
    verificationVersion: params.verificationVersion,
    ipHash: params.ipHash,
    userAgentHash: params.userAgentHash,
  });

  const method = selfServiceMethodFor(params.required);
  if (method !== "EMAIL_CONFIRMATION") return { emailChallenge: null };

  const challenge = await createEmailChallenge(db, {
    libraryId: params.libraryId,
    registrationRequestId: params.registrationRequestId,
    verificationVersion: params.verificationVersion,
    ipHash: params.ipHash,
  });

  return { emailChallenge: challenge };
}

/**
 * Moves verification records onto the people they concern once the account
 * exists, mirroring what approval already does for consent records. Evidence
 * has to survive independently of the request row.
 */
export async function attachVerificationsToMember(
  db: Db,
  params: { registrationRequestId: string; memberUserId: string; guardianId: string },
): Promise<void> {
  await db.guardianVerification.updateMany({
    where: { registrationRequestId: params.registrationRequestId },
    data: { memberUserId: params.memberUserId, guardianId: params.guardianId },
  });
}
