import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { APARTMENT_ERROR } from "@/lib/apartment";
import {
  deleteMemberAccount,
  getMemberDetail,
  DELETE_REFUSED_MESSAGE,
} from "@/server/services/account-service";
import {
  createStaffAccount,
  deleteStaffAccount,
  listStaff,
} from "@/server/services/staff-service";
import {
  approveRegistration,
  listRegistrations,
  rejectRegistration,
  submitRegistration,
} from "@/server/services/registration-service";
import { issueBook, requestBorrow } from "@/server/services/circulation-service";

import { FakeEmailProvider } from "./fake-email";
import {
  attachGuardian,
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Version 1 people management, against a real database.
 *
 * Three questions, and the answers are the point of the release:
 *
 *   1. **Who decides whether a child joins?** The Super Admin, and nobody else.
 *      A librarian sees the family's whole submission — they are the one who
 *      will meet them — and cannot approve or refuse it.
 *   2. **What may be erased?** Only an account with no history at all. Anything
 *      lived in is archived instead, and the refusal is audited.
 *   3. **What does each role see of a reader?** The card and the contact for a
 *      librarian; the evidence behind the joining decision only for the person
 *      who makes that decision.
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/**
 * A birth year for a child who is `age` this year. Year only -- the library asks
 * for nothing more (ADR-051).
 */
function birthYearForAge(age: number): number {
  return new Date().getUTCFullYear() - age;
}

const BASE_INPUT = {
  childName: "A Child",
  apartment: "P-15",
  guardianName: "A Guardian",
  guardianEmail: "guardian@example.invalid",
  guardianPhone: "+919000000000",
  avatarKey: "fox",
  photoMediaId: null,
  consentTypes: ["CHILD_ACCOUNT_CREATION", "GUARDIAN_EMAIL_NOTIFICATIONS"] as const,
  requestIp: "203.0.113.10",
  userAgent: "test-agent",
};

/** Submits one registration and returns its row. */
async function submitFresh(overrides: Partial<typeof BASE_INPUT> = {}) {
  const input = {
    ...BASE_INPUT,
    ...overrides,
    childBirthYear: birthYearForAge(9),
  };
  await submitRegistration(input);
  return db.registrationRequest.findFirstOrThrow({
    where: { childName: input.childName },
    orderBy: { submittedAt: "desc" },
  });
}

afterAll(async () => {
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  mail.reset();
  __setEmailProviderForTests(mail);
  __setSessionHandle(null);
});

// ---------------------------------------------------------------------------
// The role model
// ---------------------------------------------------------------------------

describe("the role model this version hands out", () => {
  it("has exactly three assignable roles, and they are the three named", async () => {
    const assignable = await db.role.findMany({
      where: { libraryId: fixture.libraryId, isAssignable: true },
      select: { key: true },
      orderBy: { sortOrder: "asc" },
    });

    expect(assignable.map((role) => role.key)).toEqual([
      "SUPER_ADMIN",
      "LIBRARIAN",
      "MEMBER",
    ]);
  });

  it("keeps Junior Librarian seeded but unassignable", async () => {
    const junior = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "JUNIOR_LIBRARIAN" } },
    });
    expect(junior.isAssignable).toBe(false);
  });

  it("keeps Guardian unassignable, and grants it nothing", async () => {
    const guardian = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "GUARDIAN" } },
      include: { rolePermissions: true },
    });
    expect(guardian.isAssignable).toBe(false);
    expect(guardian.rolePermissions).toHaveLength(0);

    // And nobody holds it. A guardian is somebody the library writes to.
    expect(
      await db.userRole.count({ where: { role: { key: "GUARDIAN" } } }),
    ).toBe(0);
  });

  it("gives user.delete to the Super Admin and to nobody else", async () => {
    const holders = await db.rolePermission.findMany({
      where: { permissionKey: "user.delete" },
      select: { role: { select: { key: true } } },
    });
    expect(holders.map((entry) => entry.role.key)).toEqual(["SUPER_ADMIN"]);
  });
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

describe("staff management", () => {
  it("lets the Super Admin create a Librarian, who chooses their own password", async () => {
    await actingAs(admin.id);
    const created = await createStaffAccount({
      displayName: "New Librarian",
      email: "new.librarian@example.invalid",
    });

    const user = await db.appUser.findUniqueOrThrow({
      where: { id: created.userId },
      include: { userRoles: { include: { role: true } } },
    });

    expect(user.kind).toBe("STAFF");
    expect(user.status).toBe("INVITED");
    expect(user.userRoles.map((entry) => entry.role.key)).toEqual(["LIBRARIAN"]);
    // Nobody set it, and there is nothing to set: the account carries no
    // password until the invited person chooses one.
    expect(user.mustSetPassword).toBe(true);
    expect(user.passwordHash).toBeNull();
  });

  it("refuses a librarian who tries to create staff", async () => {
    await actingAs(librarian.id);
    await expect(
      createStaffAccount({ displayName: "Sneaky", email: "sneaky@example.invalid" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    expect(await db.appUser.count({ where: { email: "sneaky@example.invalid" } })).toBe(0);
  });

  it("offers no way to create a second Super Admin, from any role", async () => {
    await actingAs(admin.id);
    const created = await createStaffAccount({
      displayName: "Only A Librarian",
      email: "only.librarian@example.invalid",
    });

    const roles = await db.userRole.findMany({
      where: { userId: created.userId },
      select: { role: { select: { key: true } } },
    });
    expect(roles.map((entry) => entry.role.key)).toEqual(["LIBRARIAN"]);

    // And the library still has exactly one administrator.
    expect(
      await db.appUser.count({
        where: {
          libraryId: fixture.libraryId,
          userRoles: { some: { role: { key: "SUPER_ADMIN" } } },
        },
      }),
    ).toBe(1);
  });

  it("shows the Super Admin the columns the staff screen needs", async () => {
    await actingAs(admin.id);
    const rows = await listStaff();
    const row = rows.find((entry) => entry.id === librarian.id);

    expect(row).toBeDefined();
    expect(row).toMatchObject({ displayName: expect.any(String), email: expect.any(String) });
    expect(row?.roleKeys).toEqual(["LIBRARIAN"]);
    // No password, hash or token reaches the screen.
    expect(JSON.stringify(rows)).not.toMatch(/passwordHash|tokenHash|argon2/i);
  });
});

// ---------------------------------------------------------------------------
// Registration: who may decide
// ---------------------------------------------------------------------------

describe("approving a new reader", () => {
  it("lets a librarian see the whole submission", async () => {
    await submitFresh({ childName: "Seen By Librarian" });

    await actingAs(librarian.id);
    const queue = await listRegistrations();
    const request = queue.find((entry) => entry.childName === "Seen By Librarian");

    expect(request).toBeDefined();
    expect(request?.apartment).toBe("P-15");
    expect(request?.guardianName).toBe("A Guardian");
    // Contact details: a librarian holds member.view_contact, and needs them.
    expect(request?.guardianEmail).toBe("guardian@example.invalid");
    expect(request?.guardianPhone).toBe("+919000000000");
    expect(request?.consents.length).toBeGreaterThan(0);
    expect(request?.verification).toBeDefined();
  });

  it("refuses a librarian who tries to approve", async () => {
    const request = await submitFresh({ childName: "Not Yours To Approve" });

    await actingAs(librarian.id);
    await expect(approveRegistration(request.id)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    // Nothing moved: no account, and the request is untouched.
    expect(await db.appUser.count({ where: { displayName: "Not Yours To Approve" } })).toBe(0);
    const after = await db.registrationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe("PENDING");
    expect(after.createdMemberUserId).toBeNull();
  });

  it("refuses a librarian who tries to reject", async () => {
    const request = await submitFresh({ childName: "Not Yours To Refuse" });

    await actingAs(librarian.id);
    await expect(rejectRegistration(request.id, "no reason")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    const after = await db.registrationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe("PENDING");
  });

  it("refuses a reader who tries to approve", async () => {
    const request = await submitFresh({ childName: "Definitely Not" });
    const reader = await createMember(fixture.libraryId);

    await actingAs(reader.id, "MEMBER");
    await expect(approveRegistration(request.id)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    // A reader cannot even see the queue.
    await expect(listRegistrations()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("lets the Super Admin approve, and a card comes into existence", async () => {
    const request = await submitFresh({ childName: "Welcome Aboard" });

    await actingAs(admin.id);
    const result = await approveRegistration(request.id);

    const after = await db.registrationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.createdMemberUserId).toBe(result.memberUserId);
    expect(after.reviewedById).toBe(admin.id);

    const member = await db.appUser.findUniqueOrThrow({
      where: { id: result.memberUserId },
      include: { memberProfile: true },
    });
    expect(member.kind).toBe("MEMBER");
    expect(member.memberProfile?.apartment).toBe("P-15");
  });

  it("lets the Super Admin reject, and no account is created", async () => {
    const request = await submitFresh({ childName: "Sent Twice" });

    await actingAs(admin.id);
    await rejectRegistration(request.id, "duplicate of an existing card");

    const after = await db.registrationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe("REJECTED");
    expect(after.createdMemberUserId).toBeNull();
    expect(await db.appUser.count({ where: { displayName: "Sent Twice" } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Flat numbers, at the service boundary
// ---------------------------------------------------------------------------

describe("the flat number, enforced server-side", () => {
  for (const apartment of ["P-15", "A-102", "B12", "Tower-A-15"]) {
    it(`accepts ${apartment} and stores it as typed`, async () => {
      const request = await submitFresh({
        childName: `Child ${apartment}`,
        apartment,
        guardianEmail: `${apartment.toLowerCase()}@example.invalid`,
      });
      expect(request.apartment).toBe(apartment);
    });
  }

  it("trims a value that arrived with stray whitespace", async () => {
    const request = await submitFresh({ childName: "Spaced Out", apartment: "  C-3  " });
    expect(request.apartment).toBe("C-3");
  });

  /**
   * The important one. These calls do not pass through the form's zod schema at
   * all — they are the service being called directly, the way a script or a
   * future import would call it. The refusal has to live here, not only in the
   * action.
   */
  for (const apartment of ["P@15", "P/15", "<P-15>", "", "   ", "<script>alert(1)</script>"]) {
    it(`refuses ${JSON.stringify(apartment)} even when the form is bypassed`, async () => {
      await expect(
        submitRegistration({
          ...BASE_INPUT,
          childName: "Should Not Exist",
          apartment,
          childBirthYear: birthYearForAge(9),
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        fieldErrors: { apartment: APARTMENT_ERROR },
      });

      expect(
        await db.registrationRequest.count({ where: { childName: "Should Not Exist" } }),
      ).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Reader detail
// ---------------------------------------------------------------------------

describe("what each role sees of one reader", () => {
  async function approvedReader(childName: string, apartment: string) {
    const request = await submitFresh({
      childName,
      apartment,
      guardianEmail: `${apartment.toLowerCase()}@example.invalid`,
    });
    await actingAs(admin.id);
    const result = await approveRegistration(request.id);
    return result.memberUserId;
  }

  it("shows the Super Admin the card, the contact and the joining decision", async () => {
    const memberId = await approvedReader("Full Record", "D-4");

    await actingAs(admin.id);
    const detail = await getMemberDetail(memberId);

    expect(detail.displayName).toBe("Full Record");
    expect(detail.apartment).toBe("D-4");
    expect(detail.memberCode).toMatch(/^TST-R/);
    expect(detail.birthYear).toBe(birthYearForAge(9));
    expect(detail.guardians[0]?.fullName).toBe("A Guardian");
    expect(detail.guardians[0]?.email).toBe("d-4@example.invalid");
    expect(detail.guardians[0]?.phone).toBe("+919000000000");

    // The evidence behind the approval.
    expect(detail.registration?.status).toBe("APPROVED");
    expect(detail.registration?.reviewedBy).toBe(admin.displayName);
    expect(detail.registration?.consents.length).toBeGreaterThan(0);
    expect(detail.verification?.length).toBeGreaterThan(0);
  });

  it("shows a librarian the operational record, and not the joining evidence", async () => {
    const memberId = await approvedReader("Operational Only", "D-5");

    await actingAs(librarian.id);
    const detail = await getMemberDetail(memberId);

    // What running a library needs.
    expect(detail.displayName).toBe("Operational Only");
    expect(detail.apartment).toBe("D-5");
    expect(detail.memberCode).toMatch(/^TST-R/);
    expect(detail.guardians[0]?.phone).toBe("+919000000000");

    // What deciding a registration needs, and they did not decide it.
    expect(detail.registration).toBeNull();
    expect(detail.verification).toBeNull();
  });

  it("tells nobody a password, a hash or a token", async () => {
    const memberId = await approvedReader("No Secrets", "D-6");

    await actingAs(admin.id);
    const detail = await getMemberDetail(memberId);

    const serialised = JSON.stringify(detail);
    expect(serialised).not.toMatch(/passwordHash|password_hash|argon2/i);
    expect(serialised).not.toMatch(/tokenHash|token_hash/i);
    expect(serialised).not.toMatch(/statusReason/i);
    expect(Object.keys(detail)).not.toContain("passwordHash");
  });

  it("refuses a reader asking about anybody, including themselves", async () => {
    const memberId = await approvedReader("Private Life", "D-7");
    const reader = await createMember(fixture.libraryId);

    await actingAs(reader.id, "MEMBER");
    // No member.view: this screen is staff-only, and a child's own information
    // reaches them through their own pages, which take no id at all.
    await expect(getMemberDetail(memberId)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(getMemberDetail(reader.id)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("will not hand a staff account back through the reader screen", async () => {
    await actingAs(admin.id);
    await expect(getMemberDetail(librarian.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

describe("permanent deletion of a reader", () => {
  it("is refused for a reader", async () => {
    const target = await createMember(fixture.libraryId, { displayName: "Target" });
    const reader = await createMember(fixture.libraryId);

    await actingAs(reader.id, "MEMBER");
    await expect(deleteMemberAccount(target.id, "because")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    expect(await db.appUser.count({ where: { id: target.id } })).toBe(1);
  });

  it("is refused for a librarian", async () => {
    const target = await createMember(fixture.libraryId, { displayName: "Also Target" });

    await actingAs(librarian.id);
    await expect(deleteMemberAccount(target.id, "because")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    expect(await db.appUser.count({ where: { id: target.id } })).toBe(1);
  });

  it("removes an account nobody ever used, and keeps the family's application", async () => {
    const request = await submitFresh({ childName: "Registered Twice", apartment: "E-1" });
    await actingAs(admin.id);
    const { memberUserId } = await approveRegistration(request.id);

    await actingAs(admin.id);
    const result = await deleteMemberAccount(memberUserId, "registered twice by mistake");

    expect(result.displayName).toBe("Registered Twice");
    expect(await db.appUser.count({ where: { id: memberUserId } })).toBe(0);

    // The application survives, with nothing pointing at a row that is gone.
    const application = await db.registrationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(application.createdMemberUserId).toBeNull();
    expect(application.status).toBe("APPROVED");

    // And so does the consent the guardian gave, and the guardian check.
    expect(
      await db.consentRecord.count({ where: { registrationRequestId: request.id } }),
    ).toBeGreaterThan(0);
    expect(
      await db.guardianVerification.count({ where: { registrationRequestId: request.id } }),
    ).toBeGreaterThan(0);
  });

  it("writes an audit row that outlives the account", async () => {
    const request = await submitFresh({ childName: "Gone But Recorded", apartment: "E-2" });
    await actingAs(admin.id);
    const { memberUserId } = await approveRegistration(request.id);

    await actingAs(admin.id);
    await deleteMemberAccount(memberUserId, "duplicate card");

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.USER_DELETED, entityId: memberUserId },
    });
    expect(entry.actorUserId).toBe(admin.id);
    expect(entry.metadata).toMatchObject({
      kind: "MEMBER",
      displayName: "Gone But Recorded",
      reason: "duplicate card",
    });
  });

  it("refuses an account that has borrowed a book, and says to archive it", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "Has Borrowed" });
    await attachGuardian(fixture.libraryId, reader.id);
    const copy = await createBookCopy(fixture.libraryId);

    await actingAs(librarian.id);
    await issueBook({ memberUserId: reader.id, copyId: copy.id });

    await actingAs(admin.id);
    await expect(deleteMemberAccount(reader.id, "tidying up")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
      friendlyMessage: DELETE_REFUSED_MESSAGE,
    });

    expect(await db.appUser.count({ where: { id: reader.id } })).toBe(1);
  });

  it("refuses an account that has only asked for a book", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "Has Asked" });
    const copy = await createBookCopy(fixture.libraryId);

    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.copyCode });

    await actingAs(admin.id);
    await expect(deleteMemberAccount(reader.id, "tidying up")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
      friendlyMessage: DELETE_REFUSED_MESSAGE,
    });
    expect(await db.appUser.count({ where: { id: reader.id } })).toBe(1);
  });

  it("audits a refusal, with the reasons", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "Refused" });
    const copy = await createBookCopy(fixture.libraryId);
    await actingAs(reader.id, "MEMBER");
    await requestBorrow({ code: copy.copyCode });

    await actingAs(admin.id);
    await expect(deleteMemberAccount(reader.id, "tidying up")).rejects.toThrow();

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.USER_DELETE_REFUSED, entityId: reader.id },
    });
    expect(entry.metadata).toMatchObject({ kind: "MEMBER" });
  });

  it("refuses without a reason written down", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "No Reason" });
    await actingAs(admin.id);
    await expect(deleteMemberAccount(reader.id, "  ")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await db.appUser.count({ where: { id: reader.id } })).toBe(1);
  });
});

describe("permanent deletion of a staff account", () => {
  async function invitedLibrarian(email: string) {
    await actingAs(admin.id);
    const created = await createStaffAccount({ displayName: "Mistyped Invite", email });
    return created.userId;
  }

  it("is refused for a librarian, even against another librarian", async () => {
    const targetId = await invitedLibrarian("mistyped@example.invalid");

    await actingAs(librarian.id);
    await expect(deleteStaffAccount(targetId, "typo")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    expect(await db.appUser.count({ where: { id: targetId } })).toBe(1);
  });

  it("removes an invitation that was never used", async () => {
    const targetId = await invitedLibrarian("wrong.address@example.invalid");

    await actingAs(admin.id);
    const result = await deleteStaffAccount(targetId, "sent to the wrong address");

    expect(result.displayName).toBe("Mistyped Invite");
    expect(await db.appUser.count({ where: { id: targetId } })).toBe(0);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.USER_DELETED, entityId: targetId },
    });
    expect(entry.metadata).toMatchObject({ kind: "STAFF", roles: ["LIBRARIAN"] });
  });

  it("refuses a colleague who has worked the desk", async () => {
    const reader = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, reader.id);
    const copy = await createBookCopy(fixture.libraryId);

    await actingAs(librarian.id);
    await issueBook({ memberUserId: reader.id, copyId: copy.id });

    await actingAs(admin.id);
    await expect(deleteStaffAccount(librarian.id, "left the building")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
      friendlyMessage: DELETE_REFUSED_MESSAGE,
    });
    expect(await db.appUser.count({ where: { id: librarian.id } })).toBe(1);
  });

  /**
   * The guard has no ordinary caller.
   *
   * Version 1 has exactly one Super Admin, nobody may delete themselves, and no
   * screen creates a second administrator — so in normal running there is no
   * account that could even attempt this. Granting `user.delete` to the
   * librarian role for the length of this test is the only way to put a real
   * call through the guard, and it is taken away again in `finally`.
   */
  it("never removes the last active Super Admin", async () => {
    const role = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "LIBRARIAN" } },
    });
    await db.rolePermission.create({
      data: { roleId: role.id, permissionKey: "user.delete" },
    });

    try {
      await actingAs(librarian.id);
      // This administrator has no history at all, so nothing but the
      // last-Super-Admin guard can be what refuses.
      await expect(deleteStaffAccount(admin.id, "handover")).rejects.toMatchObject({
        code: "RULE_VIOLATION",
      });
      expect(await db.appUser.count({ where: { id: admin.id } })).toBe(1);
    } finally {
      await db.rolePermission.delete({
        where: { roleId_permissionKey: { roleId: role.id, permissionKey: "user.delete" } },
      });
    }
  });

  it("refuses to delete yourself", async () => {
    await actingAs(admin.id);
    await expect(deleteStaffAccount(admin.id, "goodbye")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
    expect(await db.appUser.count({ where: { id: admin.id } })).toBe(1);
  });
});
