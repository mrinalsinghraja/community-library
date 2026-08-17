import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import {
  approveRegistration,
  listRegistrations,
  rejectRegistration,
  submitRegistration,
} from "@/server/services/registration-service";

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
 * The registration workflow, end to end against a real database.
 *
 * The property under test throughout: no child account exists until a human at
 * the library has said yes.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

/** Signs the service layer in as a given user. */
async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

/** Submits and approves a fresh registration, returning the live token. */
async function approveFresh(childName: string, apartment: string) {
  await submitRegistration({
    ...BASE_INPUT,
    childName,
    apartment,
    childDateOfBirth: dateOfBirthForAge(9),
    guardianEmail: `${apartment.toLowerCase()}@example.invalid`,
  });

  const request = await db.registrationRequest.findFirstOrThrow({ where: { childName } });

  await actingAs(librarian.id);
  const result = await approveRegistration(request.id);

  return { ...result, rawToken: mail.tokenFrom(TEMPLATE_IDS.ACTIVATION) };
}

function dateOfBirthForAge(age: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() - 1));
}

const BASE_INPUT = {
  apartment: "P15",
  guardianName: "A Guardian",
  guardianEmail: "guardian@example.invalid",
  guardianPhone: "+919000000000",
  avatarKey: "fox",
  photoMediaId: null,
  consentTypes: ["CHILD_ACCOUNT_CREATION", "GUARDIAN_EMAIL_NOTIFICATIONS"] as const,
  requestIp: "203.0.113.10",
  userAgent: "test-agent",
};

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  __setEmailProviderForTests(mail);
});

beforeEach(() => {
  mail.reset();
});

afterEach(() => {
  __setSessionHandle(null);
});

afterAll(async () => {
  __setEmailProviderForTests(null);
  await db.$disconnect();
});

describe("submitting a registration", () => {
  it("creates a pending request and acknowledges it to the guardian", async () => {
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Aarav",
      childDateOfBirth: dateOfBirthForAge(9),
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Aarav" },
    });

    expect(request.status).toBe("PENDING");
    // Crucially: no account yet.
    expect(await db.appUser.count({ where: { kind: "MEMBER" } })).toBe(0);

    const received = mail.lastTo(TEMPLATE_IDS.REGISTRATION_RECEIVED);
    expect(received?.to).toBe(BASE_INPUT.guardianEmail);
  });

  it("records consent with the wording that was actually shown", async () => {
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Consent Child",
      childDateOfBirth: dateOfBirthForAge(8),
      guardianEmail: "consent@example.invalid",
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Consent Child" },
      include: { consents: true },
    });

    expect(request.consents).toHaveLength(2);
    for (const consent of request.consents) {
      expect(consent.status).toBe("GRANTED");
      expect(consent.method).toBe("WEB_FORM");
      expect(consent.consentVersion).toBeTruthy();
      // The snapshot is the evidence. An empty one would be worthless.
      expect(consent.consentTextSnapshot.length).toBeGreaterThan(50);
      expect(consent.ipHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("refuses a child below the configured minimum age", async () => {
    await expect(
      submitRegistration({
        ...BASE_INPUT,
        childName: "Too Young",
        childDateOfBirth: dateOfBirthForAge(3),
      }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    expect(await db.registrationRequest.count({ where: { childName: "Too Young" } })).toBe(0);
  });

  it("refuses a child above the configured maximum age", async () => {
    await expect(
      submitRegistration({
        ...BASE_INPUT,
        childName: "Too Old",
        childDateOfBirth: dateOfBirthForAge(17),
      }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });
  });

  it("follows the configured range rather than a hard-coded one", async () => {
    // Widen the range and the same submission becomes acceptable.
    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { ageMax: 18 },
    });
    await expect(
      submitRegistration({
        ...BASE_INPUT,
        childName: "Now Allowed",
        childDateOfBirth: dateOfBirthForAge(17),
        guardianEmail: "wider@example.invalid",
      }),
    ).resolves.toBeUndefined();

    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { ageMax: 14 },
    });
  });

  it("refuses a submission without account-creation consent", async () => {
    await expect(
      submitRegistration({
        ...BASE_INPUT,
        childName: "No Consent",
        childDateOfBirth: dateOfBirthForAge(9),
        consentTypes: ["GUARDIAN_EMAIL_NOTIFICATIONS"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("swallows a duplicate silently rather than confirming the child exists", async () => {
    const input = {
      ...BASE_INPUT,
      childName: "Duplicate Child",
      childDateOfBirth: dateOfBirthForAge(10),
      apartment: "D42",
      guardianEmail: "dup@example.invalid",
    };

    await submitRegistration(input);
    // Same child, same flat, different case and spacing — must not throw, and
    // must not create a second row. From outside it looks identical to success,
    // because otherwise this form answers "is this child already registered?".
    await expect(
      submitRegistration({ ...input, childName: "  duplicate child " }),
    ).resolves.toBeUndefined();

    expect(
      await db.registrationRequest.count({
        where: { apartment: "D42", status: { in: ["PENDING", "UNDER_REVIEW"] } },
      }),
    ).toBe(1);
  });
});

describe("approving a registration", () => {
  it("creates the member, card, guardian link and activation email", async () => {
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Approve Me",
      childDateOfBirth: dateOfBirthForAge(7),
      guardianEmail: "approve@example.invalid",
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Approve Me" },
    });

    await actingAs(librarian.id);
    const result = await approveRegistration(request.id);

    expect(result.memberCode).toMatch(/^TST-R\d{4}$/);
    expect(result.activationEmailSent).toBe(true);

    const member = await db.appUser.findUniqueOrThrow({
      where: { id: result.memberUserId },
      include: { memberProfile: true, userRoles: { include: { role: true } } },
    });

    // INVITED, not ACTIVE: an account with no password must not be usable.
    expect(member.status).toBe("INVITED");
    expect(member.mustSetPassword).toBe(true);
    expect(member.passwordHash).toBeNull();
    // A child has no email address, by design.
    expect(member.email).toBeNull();
    expect(member.userRoles.map((entry) => entry.role.key)).toEqual(["MEMBER"]);
    expect(member.memberProfile?.apartment).toBe("P15");

    // Consent moved from the request onto the real people.
    const consents = await db.consentRecord.findMany({ where: { memberUserId: member.id } });
    expect(consents.length).toBeGreaterThan(0);
    expect(consents[0].guardianId).not.toBeNull();

    // The activation email went to the guardian, and carries a link.
    const activation = mail.lastTo(TEMPLATE_IDS.ACTIVATION);
    expect(activation?.to).toBe("approve@example.invalid");
    expect(mail.tokenFrom(TEMPLATE_IDS.ACTIVATION)).toBeTruthy();
  });

  it("stores only a hash of the activation token, and never logs the token", async () => {
    const { rawToken, memberUserId } = await approveFresh("Hash Check", "E01");

    expect(rawToken).toBeTruthy();

    // The raw token exists in the email and nowhere else.
    const tokens = await db.authToken.findMany({ where: { userId: memberUserId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).not.toBe(rawToken);
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const logs = await db.auditLog.findMany({ where: { entityId: memberUserId } });
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      const serialised = JSON.stringify(log.metadata ?? {});
      expect(serialised).not.toContain(rawToken!);
      expect(serialised.toLowerCase()).not.toContain("token");
    }
  });

  it("refuses to approve the same registration twice", async () => {
    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Approve Me" },
    });

    await actingAs(librarian.id);
    await expect(approveRegistration(request.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("re-checks the age at approval time, not just at submission", async () => {
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Aged Out",
      childDateOfBirth: dateOfBirthForAge(14),
      apartment: "E11",
      guardianEmail: "agedout@example.invalid",
    });

    // The library narrows its range while the request sits in the queue.
    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { ageMax: 12 },
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Aged Out" },
    });

    await actingAs(librarian.id);
    await expect(approveRegistration(request.id)).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    await db.librarySettings.update({
      where: { libraryId: fixture.libraryId },
      data: { ageMax: 14 },
    });
  });
});

describe("rejecting a registration", () => {
  it("requires an internal reason", async () => {
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Reject Me",
      childDateOfBirth: dateOfBirthForAge(11),
      apartment: "F12",
      guardianEmail: "reject@example.invalid",
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Reject Me" },
    });

    await actingAs(librarian.id);
    await expect(rejectRegistration(request.id, "")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps the reason internal and sends the family a soft note", async () => {
    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Reject Me" },
    });

    await actingAs(librarian.id);
    await rejectRegistration(request.id, "duplicate of an existing card");

    const updated = await db.registrationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(updated.status).toBe("REJECTED");
    expect(updated.reviewNote).toBe("duplicate of an existing card");

    // The internal reason must never reach the family.
    const message = mail.lastTo(TEMPLATE_IDS.REGISTRATION_REJECTED);
    expect(message?.to).toBe("reject@example.invalid");
    expect(message?.text).not.toContain("duplicate of an existing card");
    expect(message?.html).not.toContain("duplicate of an existing card");
  });

  it("creates no member account", async () => {
    expect(await db.appUser.count({ where: { displayName: "Reject Me" } })).toBe(0);
  });
});

describe("authorization on the queue", () => {
  it("refuses a member trying to review registrations", async () => {
    const child = await createMember(fixture.libraryId);
    await actingAs(child.id, "MEMBER");

    await expect(listRegistrations()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("refuses an unauthenticated caller", async () => {
    __setSessionHandle(null);
    await expect(listRegistrations()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});
