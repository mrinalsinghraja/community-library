import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession, resolveSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import {
  listMembers,
  reactivateMember,
  reissueActivation,
  suspendMember,
  updateGuardianContact,
} from "@/server/services/account-service";
import {
  createStaffAccount,
  deactivateStaff,
  listStaff,
  suspendStaff,
} from "@/server/services/staff-service";

import { FakeEmailProvider } from "./fake-email";
import {
  attachGuardian,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Authorization, privilege escalation and child privacy.
 *
 * These are the tests that would matter most if something went wrong. Each one
 * calls the real service with a real session against a real database — nothing
 * here is asserting that a mock behaves.
 */

let fixture: Fixture;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  superAdmin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
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

describe("a member cannot reach staff functions", () => {
  it("cannot list members", async () => {
    const child = await createMember(fixture.libraryId);
    await actingAs(child.id, "MEMBER");

    await expect(listMembers()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("cannot list staff", async () => {
    const child = await createMember(fixture.libraryId);
    await actingAs(child.id, "MEMBER");

    await expect(listStaff()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("cannot suspend anybody", async () => {
    const child = await createMember(fixture.libraryId);
    const victim = await createMember(fixture.libraryId);
    await actingAs(child.id, "MEMBER");

    await expect(suspendMember(victim.id, "because")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("cannot create a staff account", async () => {
    const child = await createMember(fixture.libraryId);
    await actingAs(child.id, "MEMBER");

    await expect(
      createStaffAccount({ displayName: "Sneaky", email: "sneaky@example.invalid" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("cannot change guardian contact details", async () => {
    // The guardian's email is the recovery channel. A child who could change it
    // could take over their own account permanently — or someone else's.
    const child = await createMember(fixture.libraryId);
    const guardian = await attachGuardian(fixture.libraryId, child.id);
    await actingAs(child.id, "MEMBER");

    await expect(
      updateGuardianContact({ guardianId: guardian.id, email: "attacker@example.invalid" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

describe("a librarian cannot reach Super Admin functions", () => {
  it("cannot list staff", async () => {
    await actingAs(librarian.id);
    await expect(listStaff()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("cannot create another staff account", async () => {
    await actingAs(librarian.id);

    await expect(
      createStaffAccount({ displayName: "New Colleague", email: "colleague@example.invalid" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("has no way to change anybody's role, including their own", async () => {
    // Version 1 has no role editor at all: `setStaffRole` does not exist, and
    // the only role the staff service can grant is Librarian, at creation. This
    // test asserts the absence, because "there is no code that does this" is
    // the strongest form of "a librarian cannot do this".
    const staffService = await import("@/server/services/staff-service");

    expect(Object.keys(staffService)).not.toContain("setStaffRole");
    expect(Object.keys(staffService)).not.toContain("promoteStaff");
  });

  it("cannot suspend a colleague through the staff service", async () => {
    await actingAs(librarian.id);
    await expect(suspendStaff(superAdmin.id, "because")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("cannot reach a staff account through the member service either", async () => {
    // The interesting one: a librarian DOES hold member.suspend. Without an
    // explicit kind check, that permission would let them suspend a Super Admin
    // by passing a staff id to the member endpoint.
    await actingAs(librarian.id);

    await expect(suspendMember(superAdmin.id, "escalation attempt")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const unchanged = await db.appUser.findUniqueOrThrow({ where: { id: superAdmin.id } });
    expect(unchanged.status).toBe("ACTIVE");
  });

  it("can do its own job", async () => {
    await actingAs(librarian.id);
    const child = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, child.id);

    await expect(listMembers()).resolves.toBeInstanceOf(Array);
    await expect(suspendMember(child.id, "test suspension")).resolves.toBeUndefined();
    await expect(reactivateMember(child.id)).resolves.toBeUndefined();
    await expect(reissueActivation(child.id)).resolves.toBe(true);
  });
});

describe("Super Admin can manage librarians", () => {
  it("creates a staff account with no password anywhere", async () => {
    await actingAs(superAdmin.id);

    const result = await createStaffAccount({
      displayName: "Fresh Librarian",
      email: "fresh@example.invalid",
    });

    const created = await db.appUser.findUniqueOrThrow({ where: { id: result.userId } });
    expect(created.status).toBe("INVITED");
    expect(created.passwordHash).toBeNull();
    expect(created.mustSetPassword).toBe(true);

    // They are emailed a link and choose their own — nobody else ever sees it.
    expect(mail.lastTo("staff_invitation")?.to).toBe("fresh@example.invalid");
    expect(mail.tokenFrom("staff_invitation")).toBeTruthy();
  });

  it("suspends a librarian and ends their sessions immediately", async () => {
    const target = await createStaff(fixture.libraryId, "LIBRARIAN");
    const theirSession = await createSession(target.id, "STAFF");
    expect(await resolveSession(theirSession)).not.toBeNull();

    await actingAs(superAdmin.id);
    await suspendStaff(target.id, "left the community");

    expect(await resolveSession(theirSession)).toBeNull();
    const updated = await db.appUser.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.status).toBe("SUSPENDED");
    expect(updated.statusReason).toBe("left the community");
  });

  it("creates a Librarian and nothing else — there is no second Super Admin to make", async () => {
    await actingAs(superAdmin.id);

    const result = await createStaffAccount({
      displayName: "Only Ever A Librarian",
      email: "only@example.invalid",
    });

    const roles = await db.userRole.findMany({
      where: { userId: result.userId },
      select: { role: { select: { key: true } } },
    });

    // One role, and it is Librarian. Not "no Super Admin was asked for" — there
    // is no field to ask with, so the only role this path can produce is this
    // one. A librarian's own inability to reach staff management is asserted
    // above, against a librarian who can actually sign in.
    expect(roles.map((entry) => entry.role.key)).toEqual(["LIBRARIAN"]);
  });

  it("refuses to suspend or close itself", async () => {
    await actingAs(superAdmin.id);

    await expect(suspendStaff(superAdmin.id, "oops")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
    await expect(deactivateStaff(superAdmin.id, "oops")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses to remove the library's last Super Admin", async () => {
    /*
     * Reaching this guard takes deliberate setup, and that is worth saying out
     * loud: in Version 1 nobody may remove themselves, and there is no way to
     * make a second Super Admin, so the *only* administrator can never be the
     * target of somebody else's click. The guard is the backstop underneath
     * that — the thing that still holds if a future version adds a second
     * administrator, or hands `user.manage_staff` to somebody else.
     *
     * So the permission is granted by hand here, to a librarian, purely to get
     * a second actor into the room. It is taken away again in `finally`.
     */
    const role = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "LIBRARIAN" } },
      select: { id: true },
    });

    await db.rolePermission.create({
      data: { roleId: role.id, permissionKey: "user.manage_staff" },
    });

    try {
      await actingAs(librarian.id);

      // `superAdmin` is the library's only active Super Admin.
      await expect(suspendStaff(superAdmin.id, "leaving nobody in charge")).rejects.toMatchObject({
        code: "RULE_VIOLATION",
      });
      await expect(deactivateStaff(superAdmin.id, "leaving nobody in charge")).rejects.toMatchObject(
        { code: "RULE_VIOLATION" },
      );

      const unchanged = await db.appUser.findUniqueOrThrow({ where: { id: superAdmin.id } });
      expect(unchanged.status).toBe("ACTIVE");
    } finally {
      await db.rolePermission.deleteMany({
        where: { roleId: role.id, permissionKey: "user.manage_staff" },
      });
    }
  });
});

describe("guardian contact changes", () => {
  it("are allowed for a librarian and revoke live links", async () => {
    const child = await createMember(fixture.libraryId);
    const guardian = await attachGuardian(fixture.libraryId, child.id, "old@example.invalid");

    await actingAs(librarian.id);
    await reissueActivation(child.id);

    const liveTokens = await db.authToken.count({
      where: { userId: child.id, consumedAt: null, revokedAt: null },
    });
    expect(liveTokens).toBe(1);

    await updateGuardianContact({ guardianId: guardian.id, email: "new@example.invalid" });

    // Changing the recovery address kills links already sent to the old one.
    const stillLive = await db.authToken.count({
      where: { userId: child.id, consumedAt: null, revokedAt: null },
    });
    expect(stillLive).toBe(0);

    const updated = await db.guardian.findUniqueOrThrow({ where: { id: guardian.id } });
    expect(updated.email).toBe("new@example.invalid");
  });

  it("record the change in the audit log without the addresses", async () => {
    const logs = await db.auditLog.findMany({ where: { action: "guardian.updated" } });
    expect(logs.length).toBeGreaterThan(0);

    for (const log of logs) {
      const serialised = JSON.stringify(log.metadata ?? {});
      expect(serialised).not.toContain("old@example.invalid");
      expect(serialised).not.toContain("new@example.invalid");
      expect(serialised).toContain("emailChanged");
    }
  });
});

describe("contact details are stripped by the service, not the template", () => {
  it("hides guardian email and phone from an actor without member.view_contact", async () => {
    const child = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, child.id, "hidden@example.invalid");

    // Grant a role that can view members but not their contact details.
    const limited = await createStaff(fixture.libraryId, "LIBRARIAN");
    const role = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "LIBRARIAN" } },
    });
    await db.rolePermission.deleteMany({
      where: { roleId: role.id, permissionKey: "member.view_contact" },
    });

    await actingAs(limited.id);
    const members = await listMembers();

    for (const member of members) {
      for (const link of member.guardianLinks) {
        expect(link.guardian.email).toBeNull();
        expect(link.guardian.phone).toBeNull();
        // The name stays: staff need to know who to ask for at the desk.
        expect(link.guardian.fullName).toBeTruthy();
      }
    }

    // Put it back for any later test.
    await db.rolePermission.create({
      data: { roleId: role.id, permissionKey: "member.view_contact" },
    });
  });
});

describe("no service ever returns a password hash", () => {
  it("not from listMembers or listStaff", async () => {
    await actingAs(superAdmin.id);

    const members = JSON.stringify(await listMembers());
    const staff = JSON.stringify(await listStaff());

    for (const payload of [members, staff]) {
      expect(payload).not.toContain("passwordHash");
      expect(payload).not.toContain("argon2");
    }
  });
});
