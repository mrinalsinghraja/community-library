import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createLibraryFixture, createMember, db, resetDatabase, type Fixture } from "./helpers";

/**
 * Session revocation and access isolation.
 *
 * The requirement these prove: suspending an account must end its live sessions
 * promptly, and no child may reach another child's record by any means.
 */

let fixture: Fixture;

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("session lifecycle", () => {
  it("resolves a freshly created session", async () => {
    const { createSession, resolveSession } = await import("@/server/auth/session-store");
    const member = await createMember(fixture.libraryId);

    const handle = await createSession(member.id, "MEMBER");
    const resolved = await resolveSession(handle);

    expect(resolved?.userId).toBe(member.id);
    expect(resolved?.kind).toBe("MEMBER");
  });

  it("stores only a hash of the handle, never the handle itself", async () => {
    const { createSession } = await import("@/server/auth/session-store");
    const member = await createMember(fixture.libraryId);

    const handle = await createSession(member.id, "MEMBER");
    const rows = await db.session.findMany({ where: { userId: member.id } });

    // A database dump must not yield usable sessions.
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(handle);
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a handle that was never issued", async () => {
    const { resolveSession } = await import("@/server/auth/session-store");
    expect(await resolveSession("completely-made-up-handle")).toBeNull();
  });

  it("ends the session the moment the account is suspended", async () => {
    // This is the property that justified rejecting a self-contained JWT.
    const { createSession, resolveSession } = await import("@/server/auth/session-store");
    const member = await createMember(fixture.libraryId);
    const handle = await createSession(member.id, "MEMBER");

    expect(await resolveSession(handle)).not.toBeNull();

    await db.appUser.update({ where: { id: member.id }, data: { status: "SUSPENDED" } });

    expect(await resolveSession(handle)).toBeNull();
    // The row is cleared too, not merely ignored.
    expect(await db.session.count({ where: { userId: member.id } })).toBe(0);
  });

  it("ends every session for a user when they are all revoked", async () => {
    const { createSession, resolveSession, revokeAllSessionsForUser } = await import(
      "@/server/auth/session-store"
    );
    const member = await createMember(fixture.libraryId);

    const phone = await createSession(member.id, "MEMBER");
    const tablet = await createSession(member.id, "MEMBER");

    expect(await revokeAllSessionsForUser(member.id)).toBe(2);
    expect(await resolveSession(phone)).toBeNull();
    expect(await resolveSession(tablet)).toBeNull();
  });

  it("refuses a session past its absolute expiry", async () => {
    const { createSession, resolveSession } = await import("@/server/auth/session-store");
    const member = await createMember(fixture.libraryId);
    const handle = await createSession(member.id, "MEMBER");

    // The session must be aged, not merely given an impossible expiry: the
    // CHECK constraint session_expires_after_creation (correctly) refuses a row
    // that expires before it was created.
    await db.session.updateMany({
      where: { userId: member.id },
      data: {
        createdAt: new Date(Date.now() - 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
        idleExpiresAt: new Date(Date.now() - 1000),
      },
    });

    expect(await resolveSession(handle)).toBeNull();
  });

  it("refuses a session that has been idle too long, even if not yet absolutely expired", async () => {
    const { createSession, resolveSession } = await import("@/server/auth/session-store");
    const member = await createMember(fixture.libraryId);
    const handle = await createSession(member.id, "MEMBER");

    await db.session.updateMany({
      where: { userId: member.id },
      data: { idleExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await resolveSession(handle)).toBeNull();
  });

  it("never lets idle refresh push a session past its absolute expiry", async () => {
    // A CHECK constraint enforces idle <= absolute, so a missing clamp here
    // would turn an ordinary page load into a 500 late in a session's life.
    const { createSession, resolveSession } = await import("@/server/auth/session-store");
    const member = await createMember(fixture.libraryId);
    const handle = await createSession(member.id, "MEMBER");

    const almostOver = new Date(Date.now() + 60_000);
    await db.session.updateMany({
      where: { userId: member.id },
      data: { expiresAt: almostOver, idleExpiresAt: new Date(Date.now() + 30_000) },
    });

    await expect(resolveSession(handle)).resolves.not.toBeNull();

    const row = await db.session.findFirstOrThrow({ where: { userId: member.id } });
    expect(row.idleExpiresAt.getTime()).toBeLessThanOrEqual(row.expiresAt.getTime());
  });
});

/** Signs in as a specific user by stubbing only the cookie-reading boundary. */
async function actingAs(userId: string) {
  const { createSession } = await import("@/server/auth/session-store");
  const handle = await createSession(userId, "MEMBER");

  vi.doMock("@/server/auth", () => ({
    auth: async () => ({ sessionHandle: handle }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: {},
    GENERIC_LOGIN_FAILURE: "",
  }));

  return import("@/server/authz");
}

describe("child isolation", () => {
  it("lets a reader reach their own record", async () => {
    const reader = await createMember(fixture.libraryId, { displayName: "Own Record" });
    const authz = await actingAs(reader.id);

    await expect(authz.requireMemberAccess(reader.id)).resolves.toMatchObject({
      userId: reader.id,
    });
  });

  it("refuses a reader who guesses another child's id", async () => {
    const readerA = await createMember(fixture.libraryId, { displayName: "Reader A" });
    const readerB = await createMember(fixture.libraryId, { displayName: "Reader B" });
    const authz = await actingAs(readerA.id);

    // NotFound, not NotAuthorized: the response must not confirm that reader B
    // exists. Probing ids has to look exactly like probing nonsense.
    await expect(authz.requireMemberAccess(readerB.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("gives the same answer for a member id that does not exist at all", async () => {
    const readerA = await createMember(fixture.libraryId);
    const authz = await actingAs(readerA.id);

    await expect(
      authz.requireMemberAccess("01999999-9999-7999-8999-999999999999"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gives a reader only the permissions their role actually grants", async () => {
    const reader = await createMember(fixture.libraryId);
    const authz = await actingAs(reader.id);
    const actor = await authz.requireActor();

    // Browse the shelf, see their own books, ask to keep one longer, say one is
    // coming back, and ask for their own details to be put right. Nothing else
    // — and not one of those decides anything on its own.
    expect([...actor.permissions].sort()).toEqual([
      "book.view",
      // Saying a book is on its way back. The only reader key that is not a
      // request, because a child bringing a book back cannot be refused — and
      // still not a mutation: the copy stays BORROWED until the desk takes it.
      "loan.announce_return",
      // Version 1: asking for a book. Like the renewal ask, it decides nothing
      // — no copy moves and no loan exists until a librarian answers.
      "loan.request",
      "loan.request_renewal",
      "loan.view",
      // Added with the profile-change flow: a reader proposes, a Super Admin
      // approves, and nothing about the account moves in between.
      "profile.request_change",
    ]);

    for (const forbidden of [
      "member.view_contact",
      "loan.issue",
      "loan.return",
      "loan.renew",
      "loan.correct",
      "settings.edit",
      "audit.view",
    ] as const) {
      expect(authz.can(actor, forbidden), `reader must not hold ${forbidden}`).toBe(false);
    }
  });

  it("refuses a permission the reader does not hold", async () => {
    const reader = await createMember(fixture.libraryId);
    const authz = await actingAs(reader.id);

    await expect(authz.requirePermission("settings.edit")).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("treats a suspended reader as signed out even with a valid handle", async () => {
    const reader = await createMember(fixture.libraryId);
    const authz = await actingAs(reader.id);

    await db.appUser.update({ where: { id: reader.id }, data: { status: "SUSPENDED" } });

    await expect(authz.requireActor()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});

describe("role grants come from the database, not from code", () => {
  it("ignores a grant of a role that is not assignable", async () => {
    // JUNIOR_LIBRARIAN is seeded so the model can express it, but must confer
    // nothing until the role is deliberately enabled.
    const reader = await createMember(fixture.libraryId);
    const juniorRole = await db.role.findUniqueOrThrow({
      where: { libraryId_key: { libraryId: fixture.libraryId, key: "JUNIOR_LIBRARIAN" } },
    });

    await db.userRole.create({ data: { userId: reader.id, roleId: juniorRole.id } });

    const authz = await actingAs(reader.id);
    const actor = await authz.requireActor();

    expect(actor.roleKeys).not.toContain("JUNIOR_LIBRARIAN");
    expect(authz.can(actor, "loan.issue")).toBe(false);
  });
});
