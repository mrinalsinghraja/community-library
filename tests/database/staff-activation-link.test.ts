import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession, resolveSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import { activateAccount, requestPasswordReset } from "@/server/services/password-service";
import {
  createStaffAccount,
  issueStaffActivationLink,
  listStaff,
  suspendStaff,
} from "@/server/services/staff-service";

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
 * Getting a new librarian into an account when email cannot reach them.
 *
 * A library can be running before its mail provider is configured, and in that
 * state an invitation goes nowhere: the account exists and nobody can get into
 * it. The fallback is that the Super Admin takes one activation link out by
 * hand and delivers it themselves.
 *
 * What these tests hold in place is that the fallback is the *same* mechanism,
 * not a softer one beside it:
 *
 *   • the ordinary activation token — one use, expiring, hash-only at rest;
 *   • the raw value exists in one response and is written nowhere, including
 *     the audit row that records the link was issued;
 *   • only `user.manage_staff` reaches it, and only for somebody who has not
 *     already chosen a password;
 *   • no administrator sets anybody's password, in this path or any other.
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** Creates a librarian while the mailer is refusing, as an unconfigured library would. */
async function inviteWithBrokenEmail(email: string) {
  mail.failNext = true;
  await actingAs(admin.id);
  const result = await createStaffAccount({ displayName: "Unreachable Librarian", email });
  return result;
}

const tokenFrom = (url: string) => url.split("/").pop() ?? "";

beforeAll(() => {
  __setEmailProviderForTests(mail);
});

afterAll(async () => {
  __setEmailProviderForTests(null);
  __setSessionHandle(null);
  await db.$disconnect();
});

afterEach(() => {
  mail.reset();
});

beforeEach(async () => {
  await resetDatabase();
  mail.reset();
  fixture = await createLibraryFixture();
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
});

describe("when the invitation email is sent", () => {
  it("creates the account, writes to them, and puts no token in the audit log", async () => {
    await actingAs(admin.id);
    const result = await createStaffAccount({
      displayName: "Reachable Librarian",
      email: "reachable@example.invalid",
    });

    expect(result.emailSent).toBe(true);

    const created = await db.appUser.findUniqueOrThrow({ where: { id: result.userId } });
    expect(created.status).toBe("INVITED");
    expect(created.passwordHash).toBeNull();
    expect(created.mustSetPassword).toBe(true);

    const rawToken = mail.tokenFrom(TEMPLATE_IDS.STAFF_INVITATION);
    expect(rawToken).toBeTruthy();

    // The token is in the email and nowhere else. Not in any audit row, and not
    // stored in readable form on the token itself.
    const audit = await db.auditLog.findMany({ where: { entityId: result.userId } });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(rawToken);

    const stored = await db.authToken.findFirstOrThrow({ where: { userId: result.userId } });
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });

  it("records the delivery so the staff screen can tell", async () => {
    await actingAs(admin.id);
    const result = await createStaffAccount({
      displayName: "Reachable Librarian",
      email: "reachable2@example.invalid",
    });

    const rows = await listStaff();
    const row = rows.find((person) => person.id === result.userId);
    expect(row?.invitationEmailSent).toBe(true);
    expect(row?.mustSetPassword).toBe(true);
  });
});

describe("when the invitation email fails", () => {
  it("keeps the account and reports the failure on the staff screen", async () => {
    const result = await inviteWithBrokenEmail("unreachable@example.invalid");
    expect(result.emailSent).toBe(false);

    const created = await db.appUser.findUniqueOrThrow({ where: { id: result.userId } });
    expect(created.status).toBe("INVITED");
    expect(created.mustSetPassword).toBe(true);

    const rows = await listStaff();
    const row = rows.find((person) => person.id === result.userId);
    expect(row?.invitationEmailSent).toBe(false);
  });

  it("gives the Super Admin a working one-time link", async () => {
    const result = await inviteWithBrokenEmail("unreachable2@example.invalid");

    await actingAs(admin.id);
    const link = await issueStaffActivationLink(result.userId);

    expect(link.url).toMatch(/\/activate\/[A-Za-z0-9_-]{16,}$/);
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(link.displayName).toBe("Unreachable Librarian");

    // It leads to choosing a password, and only the librarian does that.
    await expect(
      activateAccount({
        rawToken: tokenFrom(link.url),
        newPassword: "quiet-otter-brook-2291",
        requestIp: null,
      }),
    ).resolves.toBeDefined();

    const activated = await db.appUser.findUniqueOrThrow({ where: { id: result.userId } });
    expect(activated.status).toBe("ACTIVE");
    expect(activated.mustSetPassword).toBe(false);
    expect(activated.passwordHash).not.toBeNull();
  });

  it("writes an audit row that records the issue and not the token", async () => {
    const result = await inviteWithBrokenEmail("unreachable3@example.invalid");

    await actingAs(admin.id);
    const link = await issueStaffActivationLink(result.userId);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.ACTIVATION_LINK_ISSUED, entityId: result.userId },
    });
    expect(entry.actorUserId).toBe(admin.id);

    const raw = tokenFrom(link.url);
    expect(JSON.stringify(entry.metadata)).not.toContain(raw);
    // Not the URL either — an audit log outlives the thing it describes.
    expect(JSON.stringify(entry.metadata)).not.toContain("/activate/");

    const everything = await db.auditLog.findMany();
    expect(JSON.stringify(everything)).not.toContain(raw);
  });

  it("issues a link that works exactly once", async () => {
    const result = await inviteWithBrokenEmail("unreachable4@example.invalid");

    await actingAs(admin.id);
    const link = await issueStaffActivationLink(result.userId);
    const raw = tokenFrom(link.url);

    await activateAccount({
      rawToken: raw,
      newPassword: "quiet-otter-brook-2291",
      requestIp: null,
    });

    await expect(
      activateAccount({
        rawToken: raw,
        newPassword: "second-quiet-otter-3417",
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a link that has expired", async () => {
    const result = await inviteWithBrokenEmail("unreachable5@example.invalid");

    await actingAs(admin.id);
    const link = await issueStaffActivationLink(result.userId);

    // Both dates move: a CHECK constraint requires a token to expire after it
    // was created, which is a good rule and worth not fighting.
    const past = new Date(Date.now() - 8 * 24 * 3_600_000);
    await db.authToken.updateMany({
      where: { userId: result.userId, type: "ACTIVATION", consumedAt: null },
      data: { createdAt: past, expiresAt: new Date(past.getTime() + 3_600_000) },
    });

    await expect(
      activateAccount({
        rawToken: tokenFrom(link.url),
        newPassword: "quiet-otter-brook-2291",
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("retires the previous link when a second is issued", async () => {
    const result = await inviteWithBrokenEmail("unreachable6@example.invalid");

    await actingAs(admin.id);
    const first = await issueStaffActivationLink(result.userId);
    const second = await issueStaffActivationLink(result.userId);

    expect(second.url).not.toBe(first.url);

    // Only the newest works — an administrator who copied the wrong one twice
    // must not leave two live doors into the same account.
    await expect(
      activateAccount({
        rawToken: tokenFrom(first.url),
        newPassword: "quiet-otter-brook-2291",
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      activateAccount({
        rawToken: tokenFrom(second.url),
        newPassword: "quiet-otter-brook-2291",
        requestIp: null,
      }),
    ).resolves.toBeDefined();
  });
});

describe("who may take a link out of the system", () => {
  it("refuses a librarian", async () => {
    const result = await inviteWithBrokenEmail("unreachable7@example.invalid");

    await actingAs(librarian.id);
    await expect(issueStaffActivationLink(result.userId)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    expect(
      await db.auditLog.count({ where: { action: AUDIT_ACTIONS.ACTIVATION_LINK_ISSUED } }),
    ).toBe(0);
  });

  it("refuses a reader", async () => {
    const result = await inviteWithBrokenEmail("unreachable8@example.invalid");
    const child = await createMember(fixture.libraryId);

    await actingAs(child.id, "MEMBER");
    await expect(issueStaffActivationLink(result.userId)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("refuses a signed-out request", async () => {
    const result = await inviteWithBrokenEmail("unreachable9@example.invalid");

    __setSessionHandle(null);
    await expect(issueStaffActivationLink(result.userId)).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("refuses an account that has already chosen a password", async () => {
    /*
     * The narrowing that matters. An emailed link lands in the librarian's own
     * inbox; a copied one does not, so handing an administrator a live
     * activation link for a working colleague would be a way into that account
     * with nobody the wiser. Somebody who has forgotten their password uses the
     * reset flow, which writes to them.
     */
    await actingAs(admin.id);
    await expect(issueStaffActivationLink(librarian.id)).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses a suspended account", async () => {
    const result = await inviteWithBrokenEmail("unreachable10@example.invalid");

    await actingAs(admin.id);
    await suspendStaff(result.userId, "not joining after all");

    await expect(issueStaffActivationLink(result.userId)).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses a staff id from another library", async () => {
    const result = await inviteWithBrokenEmail("unreachable11@example.invalid");
    const other = await db.community.create({
      data: { name: "Elsewhere", slug: `elsewhere-${Date.now()}`, city: "Test City" },
    });
    const otherLibrary = await db.library.create({
      data: {
        communityId: other.id,
        name: "Elsewhere Library",
        slug: `elsewhere-library-${Date.now()}`,
        settings: { create: { copyCodePrefix: "EL-B", memberCodePrefix: "EL-R" } },
      },
    });
    const stranger = await db.appUser.create({
      data: {
        libraryId: otherLibrary.id,
        kind: "STAFF",
        displayName: "Stranger",
        email: "stranger@example.invalid",
        status: "INVITED",
        mustSetPassword: true,
      },
    });

    await actingAs(admin.id);
    await expect(issueStaffActivationLink(stranger.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(result.userId).toBeTruthy();
  });
});

describe("the rest of the lifecycle is untouched", () => {
  it("still lets an activated librarian sign in and hold a session", async () => {
    const result = await inviteWithBrokenEmail("unreachable12@example.invalid");

    await actingAs(admin.id);
    const link = await issueStaffActivationLink(result.userId);
    await activateAccount({
      rawToken: tokenFrom(link.url),
      newPassword: "quiet-otter-brook-2291",
      requestIp: null,
    });

    const handle = await createSession(result.userId, "STAFF");
    expect(await resolveSession(handle)).not.toBeNull();
  });

  it("still sends a password reset the ordinary way", async () => {
    await requestPasswordReset({ identifier: librarian.email!, requestIp: null });
    expect(mail.lastTo(TEMPLATE_IDS.PASSWORD_RESET)?.to).toBe(librarian.email);
  });

  it("never gives an administrator a way to set somebody's password", async () => {
    // Asserted as an absence, because that is the design: there is no service
    // that takes a staff id and a password together.
    const staffService = await import("@/server/services/staff-service");
    for (const name of Object.keys(staffService)) {
      expect(name).not.toMatch(/setPassword|SetPassword|resetPasswordFor/);
    }
  });
});
