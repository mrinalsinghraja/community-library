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
/**
 * The person who decides. In Version 1 `registration.review` belongs to the
 * Super Admin alone — a librarian sees the queue and meets the family, and the
 * owner of the library says yes or no. Tests that approve or reject therefore
 * act as this one; everything else stays with the librarian, because everything
 * else is still their job.
 */
let admin: Awaited<ReturnType<typeof createStaff>>;
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
    childBirthYear: birthYearForAge(9),
    guardianEmail: `${apartment.toLowerCase()}@example.invalid`,
  });

  const request = await db.registrationRequest.findFirstOrThrow({ where: { childName } });

  await actingAs(admin.id);
  const result = await approveRegistration(request.id);

  return { ...result, rawToken: mail.tokenFrom(TEMPLATE_IDS.ACTIVATION) };
}

/**
 * A birth year for a child who is `age` this year.
 *
 * Year only -- the library asks for nothing more (ADR-051) -- so this is exact
 * arithmetic rather than a date pinned to an arbitrary day, and it cannot drift
 * across a birthday while the suite runs.
 */
function birthYearForAge(age: number): number {
  return new Date().getUTCFullYear() - age;
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
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
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
      childBirthYear: birthYearForAge(9),
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
      childBirthYear: birthYearForAge(8),
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
        childBirthYear: birthYearForAge(3),
      }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });

    expect(await db.registrationRequest.count({ where: { childName: "Too Young" } })).toBe(0);
  });

  it("refuses a child above the configured maximum age", async () => {
    await expect(
      submitRegistration({
        ...BASE_INPUT,
        childName: "Too Old",
        /*
         * 18, not 17. The eligibility check is deliberately generous by a year
         * at each edge, because the library holds a birth year and not a
         * birthday — a child turning 17 this year is 16 until their birthday,
         * and refusing them in January on the strength of a fact the library
         * chose not to collect is the behaviour `isEligibleBirthYear` exists to
         * prevent. With the range now ending at 16, 17 is inside that pad.
         */
        childBirthYear: birthYearForAge(18),
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
        childBirthYear: birthYearForAge(17),
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
        childBirthYear: birthYearForAge(9),
        consentTypes: ["GUARDIAN_EMAIL_NOTIFICATIONS"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("swallows a duplicate silently rather than confirming the child exists", async () => {
    const input = {
      ...BASE_INPUT,
      childName: "Duplicate Child",
      childBirthYear: birthYearForAge(10),
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
      childBirthYear: birthYearForAge(7),
      guardianEmail: "approve@example.invalid",
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Approve Me" },
    });

    await actingAs(admin.id);
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

    await actingAs(admin.id);
    await expect(approveRegistration(request.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("re-checks the age at approval time, not just at submission", async () => {
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Aged Out",
      childBirthYear: birthYearForAge(14),
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

    await actingAs(admin.id);
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
      childBirthYear: birthYearForAge(11),
      apartment: "F12",
      guardianEmail: "reject@example.invalid",
    });

    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Reject Me" },
    });

    await actingAs(admin.id);
    await expect(rejectRegistration(request.id, "")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps the reason internal and sends the family a soft note", async () => {
    const request = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "Reject Me" },
    });

    await actingAs(admin.id);
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

describe("who may decide a registration", () => {
  /*
   * The Version 1 rule, asserted from both sides.
   *
   * A librarian meets the family, sees the queue, and can tell a parent where
   * things stand. What they cannot do is create — or refuse — a child's
   * membership. That decision belongs to the owner of the library, and a form
   * submitted by a parent never becomes an account on its own.
   */
  async function pendingRequest(childName: string) {
    await submitRegistration({
      ...BASE_INPUT,
      childName,
      childBirthYear: birthYearForAge(9),
    });
    return db.registrationRequest.findFirstOrThrow({ where: { childName } });
  }

  it("lets a librarian see the queue but not answer it", async () => {
    const request = await pendingRequest("Queue Watcher");

    await actingAs(librarian.id);
    await expect(listRegistrations()).resolves.toBeDefined();

    await expect(approveRegistration(request.id)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    await expect(rejectRegistration(request.id, "not this one")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    // Nothing happened: no member, and the request is exactly as it was.
    const untouched = await db.registrationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(untouched.status).toBe("PENDING");
    expect(untouched.createdMemberUserId).toBeNull();
  });

  it("does not turn a parent's form into an account on its own", async () => {
    const request = await pendingRequest("Not An Account");

    // Submitting is the family asking. Until somebody answers, there is a row
    // in a queue and nothing else — no account, no card, no way in.
    expect(request.status).toBe("PENDING");
    expect(request.createdMemberUserId).toBeNull();
    expect(
      await db.appUser.count({ where: { displayName: "Not An Account" } }),
    ).toBe(0);
  });

  it("is not something a reader can do", async () => {
    const request = await pendingRequest("Reader Cannot");
    const child = await createMember(fixture.libraryId);

    await actingAs(child.id, "MEMBER");
    await expect(approveRegistration(request.id)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });
});

// ---------------------------------------------------------------------------

describe("a flat is an address, not an account", () => {
  /*
   * 140 flats, and families that change. Every question this building has asked
   * about registration turns out to be the same one -- "must the flat number be
   * unique?" -- and the answer is no. The only thing refused is a child already
   * sitting in the queue, and only while they are still in it.
   *
   * Pinned because the rule is a partial unique index written in raw SQL three
   * files from the service. An edit that dropped `child_name` from it would
   * lock every second child in the building out of the library without failing
   * a single other test in this suite.
   *
   * Each test uses its own flat: `resetDatabase` runs once for the file, so
   * counting rows globally would count the rest of the suite's work too.
   */

  it("takes two children living in the same flat", async () => {
    for (const childName of ["Sibling One", "Sibling Two"]) {
      await submitRegistration({
        ...BASE_INPUT,
        childName,
        apartment: "T101",
        childBirthYear: birthYearForAge(9),
      });
    }

    const queued = await db.registrationRequest.findMany({
      where: { apartment: "T101" },
      select: { childName: true },
      orderBy: { childName: "asc" },
    });

    expect(queued.map((request) => request.childName)).toEqual(["Sibling One", "Sibling Two"]);
  });

  it("gives four siblings on one parent's email four separate cards", async () => {
    const siblings = ["Quad One", "Quad Two", "Quad Three", "Quad Four"];

    for (const childName of siblings) {
      await approveFresh(childName, "T102");
    }

    const members = await db.memberProfile.findMany({
      where: { apartment: "T102" },
      select: { memberCode: true },
    });

    expect(members).toHaveLength(siblings.length);
    // Four distinct cards, not one card shared by a flat.
    expect(new Set(members.map((member) => member.memberCode)).size).toBe(siblings.length);

    // One guardian row, reused across all four -- the parent is one person
    // however many children they register.
    expect(await db.guardian.count({ where: { email: "t102@example.invalid" } })).toBe(1);
  });

  it("takes a new tenant in a flat the last family used", async () => {
    // The previous tenant's child, registered and approved.
    await approveFresh("Old Tenant Child", "T103");

    // A different family rents T103 later. Different child, different parent,
    // same door number -- and the old registration is not in the way.
    await submitRegistration({
      ...BASE_INPUT,
      childName: "New Tenant Child",
      apartment: "T103",
      childBirthYear: birthYearForAge(7),
      guardianName: "A New Tenant",
      guardianEmail: "new-tenant@example.invalid",
    });

    const queued = await db.registrationRequest.findFirstOrThrow({
      where: { childName: "New Tenant Child" },
      select: { apartment: true, status: true },
    });

    expect(queued.apartment).toBe("T103");
    expect(queued.status).toBe("PENDING");
    expect(await db.registrationRequest.count({ where: { apartment: "T103" } })).toBe(2);
  });

  it("still refuses the same child twice while they are waiting", async () => {
    // The one thing the flat does constrain, and only inside the queue.
    await submitRegistration({
      ...BASE_INPUT,
      childName: "Twice Sent",
      apartment: "T104",
      childBirthYear: birthYearForAge(9),
    });

    // Case and stray whitespace must not defeat it either.
    await submitRegistration({
      ...BASE_INPUT,
      childName: "  twice sent ",
      apartment: "t104",
      childBirthYear: birthYearForAge(9),
    });

    expect(await db.registrationRequest.count({ where: { apartment: "T104" } })).toBe(1);
  });

  it("takes the same child name in two different flats", async () => {
    // Two children called the same thing is not a collision; it is a building.
    for (const apartment of ["T105", "T106"]) {
      await submitRegistration({
        ...BASE_INPUT,
        childName: "Same Name",
        apartment,
        childBirthYear: birthYearForAge(9),
        guardianEmail: `${apartment.toLowerCase()}@example.invalid`,
      });
    }

    expect(await db.registrationRequest.count({ where: { childName: "Same Name" } })).toBe(2);
  });
});
