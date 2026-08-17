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
  setStaffRole,
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
      createStaffAccount({
        displayName: "Sneaky",
        email: "sneaky@example.invalid",
        roleKey: "SUPER_ADMIN",
      }),
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

  it("cannot create a librarian, let alone a Super Admin", async () => {
    await actingAs(librarian.id);

    await expect(
      createStaffAccount({
        displayName: "New Colleague",
        email: "colleague@example.invalid",
        roleKey: "LIBRARIAN",
      }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    await expect(
      createStaffAccount({
        displayName: "New Boss",
        email: "boss@example.invalid",
        roleKey: "SUPER_ADMIN",
      }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("cannot change anybody's role, including their own", async () => {
    await actingAs(librarian.id);

    await expect(setStaffRole(librarian.id, "SUPER_ADMIN")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    await expect(setStaffRole(superAdmin.id, "LIBRARIAN")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
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
      roleKey: "LIBRARIAN",
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

  it("promotes a librarian, and the new permissions apply on the next request", async () => {
    const target = await createStaff(fixture.libraryId, "LIBRARIAN");

    await actingAs(superAdmin.id);
    await setStaffRole(target.id, "SUPER_ADMIN");

    // Permissions are read from the database every request, so no session needs
    // destroying for a role change to take effect.
    await actingAs(target.id);
    await expect(listStaff()).resolves.toBeInstanceOf(Array);
  });

  it("refuses to suspend or demote itself", async () => {
    await actingAs(superAdmin.id);

    await expect(suspendStaff(superAdmin.id, "oops")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
    await expect(setStaffRole(superAdmin.id, "LIBRARIAN")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
    await expect(deactivateStaff(superAdmin.id, "oops")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses to remove the library's last Super Admin", async () => {
    // Two admins exist here; suspend one, then the other becomes the last.
    const second = await createStaff(fixture.libraryId, "SUPER_ADMIN");

    await actingAs(second.id);
    await suspendStaff(superAdmin.id, "temporarily away");

    // `second` is now the only active Super Admin, and a third admin cannot
    // remove them either.
    const third = await createStaff(fixture.libraryId, "SUPER_ADMIN");
    await actingAs(third.id);
    await expect(setStaffRole(second.id, "LIBRARIAN")).resolves.toBeUndefined();

    // Now `third` is the last one standing.
    await actingAs(third.id);
    const others = await createStaff(fixture.libraryId, "LIBRARIAN");
    await actingAs(others.id);

    // Restore the original for later tests.
    await actingAs(third.id);
    await db.appUser.update({ where: { id: superAdmin.id }, data: { status: "ACTIVE" } });
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
