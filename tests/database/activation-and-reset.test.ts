import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession, resolveSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import { mintToken } from "@/server/lib/tokens";
import {
  activateAccount,
  changeOwnPassword,
  completePasswordReset,
  inspectActivationToken,
  requestPasswordReset,
} from "@/server/services/password-service";

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
 * Activation, password reset and password change.
 *
 * The properties under test: links work once, expire, cannot be reused, go only
 * to the guardian, and never reveal whether an account exists.
 */

let fixture: Fixture;
const mail = new FakeEmailProvider();
let ipCounter = 0;

/**
 * A fresh client IP per test.
 *
 * Password-reset requests are throttled to 5 per IP per hour. Sharing one
 * address across tests would silently starve the later ones — which is exactly
 * what happened the first time these were written.
 */
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

const IP = "198.51.100.251";

/** A member who has been invited but has not yet chosen a password. */
async function createInvitedMember(name: string, guardianEmail: string) {
  const member = await createMember(fixture.libraryId, { displayName: name });
  await db.appUser.update({
    where: { id: member.id },
    data: { status: "INVITED", mustSetPassword: true, passwordHash: null },
  });
  await attachGuardian(fixture.libraryId, member.id, guardianEmail);

  const { rawToken } = await mintToken(db, { userId: member.id, type: "ACTIVATION" });
  return { member, rawToken };
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
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

describe("activation tokens", () => {
  it("accepts a valid token and activates the account", async () => {
    const { member, rawToken } = await createInvitedMember("Activate Me", "act1@example.invalid");

    const view = await inspectActivationToken(rawToken, IP);
    expect(view.valid).toBe(true);
    expect(view.childName).toBe("Activate Me");

    await activateAccount({ rawToken, newPassword: "bluecatjumps", requestIp: IP });

    const updated = await db.appUser.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.mustSetPassword).toBe(false);
    expect(updated.passwordChangedAt).not.toBeNull();
    expect(updated.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(updated.passwordHash!, "bluecatjumps")).toBe(true);
  });

  it("refuses the same token a second time", async () => {
    const { rawToken } = await createInvitedMember("Reuse Me", "act2@example.invalid");

    await activateAccount({ rawToken, newPassword: "greenhorse7", requestIp: IP });

    await expect(
      activateAccount({ rawToken, newPassword: "different9pass", requestIp: IP }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses an expired token", async () => {
    const { member, rawToken } = await createInvitedMember("Expired", "act3@example.invalid");

    await db.authToken.updateMany({
      where: { userId: member.id },
      data: {
        createdAt: new Date(Date.now() - 30 * 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    expect((await inspectActivationToken(rawToken, IP)).valid).toBe(false);
    await expect(
      activateAccount({ rawToken, newPassword: "purplefish2", requestIp: IP }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a revoked token", async () => {
    const { member, rawToken } = await createInvitedMember("Revoked", "act4@example.invalid");

    await db.authToken.updateMany({
      where: { userId: member.id },
      data: { revokedAt: new Date() },
    });

    expect((await inspectActivationToken(rawToken, IP)).valid).toBe(false);
  });

  it("revokes the previous link when a new one is issued", async () => {
    const { member, rawToken: first } = await createInvitedMember("Reissued", "act5@example.invalid");

    const { rawToken: second } = await mintToken(db, {
      userId: member.id,
      type: "ACTIVATION",
    });

    // The email already sitting in the guardian's inbox must stop working.
    expect((await inspectActivationToken(first, IP)).valid).toBe(false);
    expect((await inspectActivationToken(second, IP)).valid).toBe(true);
  });

  it("refuses an unknown token", async () => {
    expect((await inspectActivationToken("not-a-real-token-value-at-all", IP)).valid).toBe(false);
  });

  it("refuses to activate a suspended account", async () => {
    const { member, rawToken } = await createInvitedMember("Suspended", "act6@example.invalid");
    await db.appUser.update({ where: { id: member.id }, data: { status: "SUSPENDED" } });

    expect((await inspectActivationToken(rawToken, IP)).valid).toBe(false);
  });

  it("enforces the password policy at activation", async () => {
    const { rawToken } = await createInvitedMember("Weak Password", "act7@example.invalid");

    // Too short for the 8-character member minimum.
    await expect(
      activateAccount({ rawToken, newPassword: "cat", requestIp: IP }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // A common password.
    await expect(
      activateAccount({ rawToken, newPassword: "password", requestIp: IP }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // The token survives a rejected attempt — a child gets to try again.
    expect((await inspectActivationToken(rawToken, IP)).valid).toBe(true);
  });

  it("refuses a password containing the child's own name", async () => {
    const { rawToken } = await createInvitedMember("Rosalind", "act8@example.invalid");

    await expect(
      activateAccount({ rawToken, newPassword: "rosalind99", requestIp: IP }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("counts attempts against a token, so abuse is visible", async () => {
    const { member, rawToken } = await createInvitedMember("Counted", "act9@example.invalid");

    await inspectActivationToken(rawToken, IP);
    await inspectActivationToken(rawToken, IP);

    const token = await db.authToken.findFirstOrThrow({ where: { userId: member.id } });
    expect(token.attemptCount).toBeGreaterThanOrEqual(2);
  });
});

describe("password reset", () => {
  it("sends the link to the guardian, never to the child", async () => {
    const member = await createMember(fixture.libraryId, { displayName: "Reset Me" });
    await attachGuardian(fixture.libraryId, member.id, "reset-guardian@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    await requestPasswordReset({ identifier: profile.memberCode, requestIp: nextIp() });

    const message = mail.lastTo(TEMPLATE_IDS.PASSWORD_RESET);
    expect(message?.to).toBe("reset-guardian@example.invalid");
    expect(mail.tokenFrom(TEMPLATE_IDS.PASSWORD_RESET)).toBeTruthy();
  });

  it("says nothing and sends nothing for an identifier that does not exist", async () => {
    await requestPasswordReset({ identifier: "TST-R9999", requestIp: nextIp() });
    await requestPasswordReset({ identifier: "no-such-person", requestIp: nextIp() });

    // No throw, no email, no signal of any kind.
    expect(mail.sent).toHaveLength(0);
  });

  it("sends nothing for a suspended account", async () => {
    const member = await createMember(fixture.libraryId, { status: "SUSPENDED" });
    await attachGuardian(fixture.libraryId, member.id, "susp@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    await requestPasswordReset({ identifier: profile.memberCode, requestIp: nextIp() });
    expect(mail.sent).toHaveLength(0);
  });

  it("completes a reset and signs every device out", async () => {
    const member = await createMember(fixture.libraryId, { displayName: "Multi Device" });
    await attachGuardian(fixture.libraryId, member.id, "multi@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    // Two devices are signed in when the reset happens.
    const phone = await createSession(member.id, "MEMBER");
    const tablet = await createSession(member.id, "MEMBER");
    expect(await resolveSession(phone)).not.toBeNull();

    await requestPasswordReset({ identifier: profile.memberCode, requestIp: nextIp() });
    const token = mail.tokenFrom(TEMPLATE_IDS.PASSWORD_RESET)!;

    await completePasswordReset({ rawToken: token, newPassword: "orangewhale4" });

    // Both are gone — including one an attacker might have been holding.
    expect(await resolveSession(phone)).toBeNull();
    expect(await resolveSession(tablet)).toBeNull();

    const updated = await db.appUser.findUniqueOrThrow({ where: { id: member.id } });
    expect(await verifyPassword(updated.passwordHash!, "orangewhale4")).toBe(true);
  });

  it("refuses a reset token a second time", async () => {
    const member = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, member.id, "once@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    await requestPasswordReset({ identifier: profile.memberCode, requestIp: nextIp() });
    const token = mail.tokenFrom(TEMPLATE_IDS.PASSWORD_RESET)!;

    await completePasswordReset({ rawToken: token, newPassword: "yellowbird8" });
    await expect(
      completePasswordReset({ rawToken: token, newPassword: "yellowbird9" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses an expired reset token", async () => {
    const member = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, member.id, "stale@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    await requestPasswordReset({ identifier: profile.memberCode, requestIp: nextIp() });
    const token = mail.tokenFrom(TEMPLATE_IDS.PASSWORD_RESET)!;

    await db.authToken.updateMany({
      where: { userId: member.id, type: "PASSWORD_RESET" },
      data: {
        createdAt: new Date(Date.now() - 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expect(
      completePasswordReset({ rawToken: token, newPassword: "silverfox33" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("never puts a reset token in the audit log", async () => {
    const member = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, member.id, "audit@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    await requestPasswordReset({ identifier: profile.memberCode, requestIp: nextIp() });
    const token = mail.tokenFrom(TEMPLATE_IDS.PASSWORD_RESET)!;

    const logs = await db.auditLog.findMany({ where: { entityId: member.id } });
    for (const log of logs) {
      expect(JSON.stringify(log.metadata ?? {})).not.toContain(token);
    }
  });

  it("throttles repeated reset requests from one address, silently", async () => {
    const member = await createMember(fixture.libraryId);
    await attachGuardian(fixture.libraryId, member.id, "throttle@example.invalid");
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });
    const sharedIp = "203.0.113.250";

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await requestPasswordReset({ identifier: profile.memberCode, requestIp: sharedIp });
    }

    // Capped, and never by telling the caller they were capped — being told
    // "slow down" would confirm there was something worth slowing down for.
    const sent = mail.sent.filter((message) => message.template === TEMPLATE_IDS.PASSWORD_RESET);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(5);
  });

  it("sends a staff reset to the staff member's own address", async () => {
    const staff = await createStaff(fixture.libraryId, "LIBRARIAN");

    await requestPasswordReset({ identifier: staff.email!, requestIp: nextIp() });

    expect(mail.lastTo(TEMPLATE_IDS.PASSWORD_RESET)?.to).toBe(staff.email);
  });
});

describe("changing your own password", () => {
  it("requires the current one", async () => {
    const member = await createMember(fixture.libraryId, { displayName: "Change Me" });
    await db.appUser.update({
      where: { id: member.id },
      data: { passwordHash: await hashPassword("startingword1"), passwordChangedAt: new Date() },
    });

    __setSessionHandle(await createSession(member.id, "MEMBER"));

    await expect(
      changeOwnPassword({ currentPassword: "wrongword11", newPassword: "brandnewword2" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("changes it and signs every device out, including the one that changed it", async () => {
    const member = await createMember(fixture.libraryId, { displayName: "Every Device" });
    await attachGuardian(fixture.libraryId, member.id, "change@example.invalid");
    await db.appUser.update({
      where: { id: member.id },
      data: { passwordHash: await hashPassword("startingword1"), passwordChangedAt: new Date() },
    });

    const otherDevice = await createSession(member.id, "MEMBER");
    const thisDevice = await createSession(member.id, "MEMBER");
    __setSessionHandle(thisDevice);

    await changeOwnPassword({ currentPassword: "startingword1", newPassword: "brandnewword2" });

    // Everything goes. Keeping the current session would mean rotating its
    // cookie, which the service layer cannot do, so we sign out rather than
    // pretend. The action redirects to sign-in.
    expect(await resolveSession(otherDevice)).toBeNull();
    expect(await resolveSession(thisDevice)).toBeNull();
    expect(await db.session.count({ where: { userId: member.id } })).toBe(0);

    // The guardian is told, because a password change they did not make matters.
    expect(mail.lastTo(TEMPLATE_IDS.PASSWORD_CHANGED)?.to).toBe("change@example.invalid");
  });

  it("refuses to set the same password again", async () => {
    const member = await createMember(fixture.libraryId, { displayName: "Same Again" });
    await db.appUser.update({
      where: { id: member.id },
      data: { passwordHash: await hashPassword("startingword1"), passwordChangedAt: new Date() },
    });
    __setSessionHandle(await createSession(member.id, "MEMBER"));

    await expect(
      changeOwnPassword({ currentPassword: "startingword1", newPassword: "startingword1" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses when nobody is signed in", async () => {
    __setSessionHandle(null);
    await expect(
      changeOwnPassword({ currentPassword: "a", newPassword: "brandnewword2" }),
    ).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});

describe("sessions minted before a password change", () => {
  it("are refused even if the explicit revocation did not run", async () => {
    // Belt and braces: resolveSession compares session age against
    // passwordChangedAt, so this holds by construction.
    const member = await createMember(fixture.libraryId, { displayName: "Stale Session" });
    const stale = await createSession(member.id, "MEMBER");

    await db.appUser.update({
      where: { id: member.id },
      data: { passwordChangedAt: new Date(Date.now() + 1000) },
    });

    expect(await resolveSession(stale)).toBeNull();
  });
});
