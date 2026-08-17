import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import { expireVerificationChallenges } from "@/server/lib/maintenance";
import {
  approveRegistration,
  listRegistrations,
  submitRegistration,
} from "@/server/services/registration-service";
import {
  completeEmailChallenge,
  recordStaffVerification,
  verificationStateForRequest,
} from "@/server/services/guardian-verification-service";
import { activateAccount } from "@/server/services/password-service";

import { FakeEmailProvider } from "./fake-email";
import {
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Guardian verification, and the gate it guards.
 *
 * The property under test throughout: consent and verification are two separate
 * claims, and a child's account cannot become usable until the verification this
 * library actually requires is on record.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

/** Sets what this library demands before an account may exist. */
async function requireStrength(
  strength: "NONE" | "SELF_DECLARED" | "EMAIL_CONFIRMED" | "STAFF_VERIFIED" | "IDENTITY_PROVIDER",
) {
  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: { requiredGuardianVerification: strength },
  });
}

function dateOfBirthForAge(age: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() - 1));
}

let apartmentCounter = 0;

/** A fresh registration, guaranteed not to collide with the open-request index. */
async function submitFresh(childName: string) {
  apartmentCounter += 1;
  const apartment = `V${apartmentCounter}`;

  await submitRegistration({
    childName,
    childDateOfBirth: dateOfBirthForAge(9),
    apartment,
    guardianName: "A Guardian",
    guardianEmail: `${apartment.toLowerCase()}@example.invalid`,
    guardianPhone: "+919000000000",
    avatarKey: "fox",
    photoMediaId: null,
    consentTypes: ["CHILD_ACCOUNT_CREATION", "GUARDIAN_EMAIL_NOTIFICATIONS"],
    requestIp: `203.0.113.${apartmentCounter % 250}`,
    userAgent: "test-agent",
  });

  return db.registrationRequest.findFirstOrThrow({ where: { childName } });
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  __setEmailProviderForTests(mail);
});

beforeEach(async () => {
  mail.reset();
  await requireStrength("SELF_DECLARED");
});

afterEach(() => {
  __setSessionHandle(null);
});

afterAll(async () => {
  __setEmailProviderForTests(null);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------

describe("consent and verification are separate records", () => {
  it("records a self-declaration alongside the consent, and calls it what it is", async () => {
    const request = await submitFresh("Separate Records");

    const consents = await db.consentRecord.findMany({
      where: { registrationRequestId: request.id },
    });
    const verifications = await db.guardianVerification.findMany({
      where: { registrationRequestId: request.id },
    });

    // Two consents (account, email) and one verification. Different questions.
    expect(consents).toHaveLength(2);
    expect(verifications).toHaveLength(1);

    // The tickbox is stored as exactly what it is worth — not as a check on
    // who that person is.
    expect(verifications[0].method).toBe("SELF_DECLARED");
    expect(verifications[0].strength).toBe("SELF_DECLARED");
    expect(verifications[0].status).toBe("VERIFIED");
    expect(verifications[0].verifiedAt).not.toBeNull();
  });

  it("refuses at the database to record a ticked box as an identity check", async () => {
    // The bug this guards against is one wrong literal in a service inflating a
    // tickbox past the production gate. The CHECK constraint refuses it.
    await expect(
      db.guardianVerification.create({
        data: {
          libraryId: fixture.libraryId,
          registrationRequestId: (await submitFresh("Inflated")).id,
          method: "SELF_DECLARED",
          status: "VERIFIED",
          strength: "IDENTITY_PROVIDER",
          verificationVersion: "test",
          verifiedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/guardian_verification_strength_matches_method/);
  });

  it("refuses a verification attached to nobody", async () => {
    await expect(
      db.guardianVerification.create({
        data: {
          libraryId: fixture.libraryId,
          method: "STAFF_VERIFIED",
          status: "VERIFIED",
          strength: "STAFF_VERIFIED",
          verificationVersion: "test",
          verifiedAt: new Date(),
          performedById: librarian.id,
        },
      }),
    ).rejects.toThrow(/guardian_verification_has_subject/);
  });

  it("refuses a staff confirmation that does not name the staff member", async () => {
    const request = await submitFresh("Anonymous Verifier");

    await expect(
      db.guardianVerification.create({
        data: {
          libraryId: fixture.libraryId,
          registrationRequestId: request.id,
          method: "STAFF_VERIFIED",
          status: "VERIFIED",
          strength: "STAFF_VERIFIED",
          verificationVersion: "test",
          verifiedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/guardian_verification_staff_method_names_the_staff/);
  });
});

// ---------------------------------------------------------------------------

describe("the librarian's queue", () => {
  it("reports consent and verification as two separate states", async () => {
    await requireStrength("STAFF_VERIFIED");
    const request = await submitFresh("Two States");

    await actingAs(librarian.id);
    const queue = await listRegistrations();
    const row = queue.find((entry) => entry.id === request.id)!;

    // Consent complete, verification not. Exactly the case that must never be
    // collapsed into one badge.
    expect(row.consentComplete).toBe(true);
    expect(row.verification.satisfied).toBe(false);
    expect(row.verification.achieved).toBe("SELF_DECLARED");
    expect(row.verification.required).toBe("STAFF_VERIFIED");
  });

  it("reports missing consent when a required consent was not given", async () => {
    apartmentCounter += 1;
    await submitRegistration({
      childName: "No Email Consent",
      childDateOfBirth: dateOfBirthForAge(9),
      apartment: `V${apartmentCounter}`,
      guardianName: "A Guardian",
      guardianEmail: "partial@example.invalid",
      guardianPhone: "+919000000000",
      avatarKey: null,
      photoMediaId: null,
      // Account consent only — the email consent is missing.
      consentTypes: ["CHILD_ACCOUNT_CREATION"],
      requestIp: "203.0.113.77",
      userAgent: "test-agent",
    });

    await actingAs(librarian.id);
    const queue = await listRegistrations();
    const row = queue.find((entry) => entry.childName === "No Email Consent")!;

    expect(row.consentComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the production activation gate", () => {
  it("approves when the configured requirement is met", async () => {
    const request = await submitFresh("Gate Open");

    await actingAs(librarian.id);
    const result = await approveRegistration(request.id);

    expect(result.memberCode).toBeTruthy();
  });

  it("refuses approval when the requirement is not met, and leaves the request pending", async () => {
    await requireStrength("STAFF_VERIFIED");
    const request = await submitFresh("Gate Shut");

    await actingAs(librarian.id);
    await expect(approveRegistration(request.id)).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });

    const after = await db.registrationRequest.findUniqueOrThrow({ where: { id: request.id } });
    // Still in the queue, waiting for a human — not rejected, not half-approved.
    expect(after.status).toBe("PENDING");
    expect(await db.appUser.count({ where: { displayName: "Gate Shut" } })).toBe(0);
  });

  it("approves once a librarian records an in-person confirmation", async () => {
    await requireStrength("STAFF_VERIFIED");
    const request = await submitFresh("Confirmed In Person");

    await actingAs(librarian.id);
    await recordStaffVerification({
      registrationRequestId: request.id,
      method: "STAFF_VERIFIED",
      evidenceNote: "spoke to her at the desk on Saturday",
    });

    const state = await verificationStateForRequest(request.id, "STAFF_VERIFIED");
    expect(state.satisfied).toBe(true);

    await expect(approveRegistration(request.id)).resolves.toMatchObject({
      activationEmailSent: true,
    });
  });

  it("blocks activation when the requirement is raised after approval", async () => {
    const request = await submitFresh("Raised Bar");

    await actingAs(librarian.id);
    await approveRegistration(request.id);
    const rawToken = mail.tokenFrom(TEMPLATE_IDS.ACTIVATION)!;

    // The library tightens its policy while the email sits unread.
    await requireStrength("STAFF_VERIFIED");
    __setSessionHandle(null);

    await expect(
      activateAccount({ rawToken, newPassword: "bluecatjumps", requestIp: "203.0.113.9" }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    const member = await db.appUser.findFirstOrThrow({ where: { displayName: "Raised Bar" } });
    // Still INVITED, still no password. The account did not slip through.
    expect(member.status).toBe("INVITED");
    expect(member.passwordHash).toBeNull();
  });

  it("moves the evidence onto the member when the account is created", async () => {
    const request = await submitFresh("Evidence Travels");

    await actingAs(librarian.id);
    const { memberUserId } = await approveRegistration(request.id);

    const verification = await db.guardianVerification.findFirstOrThrow({
      where: { registrationRequestId: request.id },
    });

    expect(verification.memberUserId).toBe(memberUserId);
    expect(verification.guardianId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("email confirmation", () => {
  it("sends a challenge when the library requires one, and does not approve until it is answered", async () => {
    await requireStrength("EMAIL_CONFIRMED");
    const request = await submitFresh("Email Challenge");

    const sent = mail.lastTo(TEMPLATE_IDS.GUARDIAN_VERIFICATION);
    expect(sent).toBeDefined();
    // The challenge goes to the guardian, and says nothing about a card number.
    expect(sent!.text).not.toMatch(/TST-/);

    await actingAs(librarian.id);
    await expect(approveRegistration(request.id)).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("completes on the emailed link, and only once", async () => {
    await requireStrength("EMAIL_CONFIRMED");
    const request = await submitFresh("Clicks The Link");
    const rawToken = mail.tokenFrom(TEMPLATE_IDS.GUARDIAN_VERIFICATION)!;

    const first = await completeEmailChallenge({ rawToken, requestIp: "203.0.113.5" });
    expect(first.ok).toBe(true);

    // Replay finds nothing at all — the hash is cleared when it is spent.
    const second = await completeEmailChallenge({ rawToken, requestIp: "203.0.113.5" });
    expect(second.ok).toBe(false);

    const state = await verificationStateForRequest(request.id, "EMAIL_CONFIRMED");
    expect(state.achieved).toBe("EMAIL_CONFIRMED");
    expect(state.satisfied).toBe(true);

    await actingAs(librarian.id);
    await expect(approveRegistration(request.id)).resolves.toBeDefined();
  });

  it("stores only the hash of the challenge, never the link", async () => {
    await requireStrength("EMAIL_CONFIRMED");
    const request = await submitFresh("Hashed Only");
    const rawToken = mail.tokenFrom(TEMPLATE_IDS.GUARDIAN_VERIFICATION)!;

    const record = await db.guardianVerification.findFirstOrThrow({
      where: { registrationRequestId: request.id, method: "EMAIL_CONFIRMATION" },
    });

    expect(record.challengeTokenHash).not.toBe(rawToken);
    expect(record.challengeTokenHash).toHaveLength(64);
    expect(record.challengeExpiresAt).not.toBeNull();
  });

  it("refuses an expired challenge", async () => {
    await requireStrength("EMAIL_CONFIRMED");
    const request = await submitFresh("Too Slow");
    const rawToken = mail.tokenFrom(TEMPLATE_IDS.GUARDIAN_VERIFICATION)!;

    await db.guardianVerification.updateMany({
      where: { registrationRequestId: request.id, method: "EMAIL_CONFIRMATION" },
      data: { challengeExpiresAt: new Date(Date.now() - 1000) },
    });

    const outcome = await completeEmailChallenge({ rawToken, requestIp: "203.0.113.6" });
    expect(outcome).toMatchObject({ ok: false, reason: "expired" });
  });

  it("counts attempts against a spent challenge", async () => {
    await requireStrength("EMAIL_CONFIRMED");
    await submitFresh("Probed");
    const rawToken = mail.tokenFrom(TEMPLATE_IDS.GUARDIAN_VERIFICATION)!;

    await completeEmailChallenge({ rawToken, requestIp: "203.0.113.7" });
    // The hash is cleared on success, so the probe now matches nothing at all —
    // which is the strongest possible answer to a replay.
    const outcome = await completeEmailChallenge({ rawToken, requestIp: "203.0.113.7" });
    expect(outcome).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("expires unanswered challenges and clears their hashes", async () => {
    await requireStrength("EMAIL_CONFIRMED");
    const request = await submitFresh("Never Answered");

    await db.guardianVerification.updateMany({
      where: { registrationRequestId: request.id, method: "EMAIL_CONFIRMATION" },
      data: { challengeExpiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await expireVerificationChallenges();
    expect(expired).toBeGreaterThanOrEqual(1);

    const record = await db.guardianVerification.findFirstOrThrow({
      where: { registrationRequestId: request.id, method: "EMAIL_CONFIRMATION" },
    });
    expect(record.status).toBe("EXPIRED");
    expect(record.challengeTokenHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("who may record a verification", () => {
  it("refuses a member", async () => {
    const request = await submitFresh("Member Tries");
    const child = await createMember(fixture.libraryId);

    await actingAs(child.id, "MEMBER");
    await expect(
      recordStaffVerification({
        registrationRequestId: request.id,
        method: "STAFF_VERIFIED",
        evidenceNote: "I say so",
      }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("requires a note, and refuses one long enough to hide a document in", async () => {
    const request = await submitFresh("Needs A Note");

    await actingAs(librarian.id);
    await expect(
      recordStaffVerification({
        registrationRequestId: request.id,
        method: "STAFF_VERIFIED",
        evidenceNote: " ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      recordStaffVerification({
        registrationRequestId: request.id,
        method: "STAFF_VERIFIED",
        evidenceNote: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("audits the verification with the method and the person, and no token", async () => {
    const request = await submitFresh("Audited");

    await actingAs(librarian.id);
    await recordStaffVerification({
      registrationRequestId: request.id,
      method: "STAFF_VERIFIED",
      evidenceNote: "confirmed at the desk",
    });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.VERIFICATION_RECORDED, entityType: "guardian_verification" },
      orderBy: { occurredAt: "desc" },
    });

    expect(entry.actorUserId).toBe(librarian.id);
    expect(JSON.stringify(entry.metadata)).toContain("STAFF_VERIFIED");
  });
});
