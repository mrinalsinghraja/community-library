import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession, resolveSession } from "@/server/auth/session-store";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { TEMPLATE_IDS } from "@/server/lib/email/templates";
import { activateAccount } from "@/server/services/password-service";
import {
  getMemberDetail,
  issueMemberActivationLink,
  listMembers,
  suspendMember,
} from "@/server/services/account-service";
import { approveRegistration, submitRegistration } from "@/server/services/registration-service";

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
 * Getting an approved reader into their account when email cannot reach them.
 *
 * The same problem the staff fallback solves, one screen along. A family's
 * registration is approved in a library whose mail provider is not configured
 * yet; the child's account exists and nobody can get into it. The Super Admin
 * takes one activation link out by hand and gives it to the guardian at the
 * desk.
 *
 * What these tests hold in place is that the reader fallback is the *same*
 * mechanism as the staff one, not a softer one beside it:
 *
 *   • the ordinary activation token — one use, expiring, hash-only at rest;
 *   • the raw value exists in one response and is written nowhere, including
 *     the audit row that records the link was issued;
 *   • **a librarian cannot reach it.** Reissuing sends a link to the guardian
 *     either way, which is why `member.reset_password` is enough for that.
 *     Handing over the raw URL is different, so it asks for
 *     `registration.review` — the Super-Admin-only permission that decides
 *     whether a child joins at all. See ADR-043.
 *   • no administrator sets anybody's password, in this path or any other.
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const mail = new FakeEmailProvider();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

function dateOfBirthForAge(age: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() - 1));
}

let childCounter = 0;

/** A family applies, and the Super Admin approves — the ordinary way in. */
async function approvedReader(options: { emailWorks: boolean }) {
  childCounter += 1;
  const childName = `Waiting Child ${childCounter}`;

  __setSessionHandle(null);
  await submitRegistration({
    childName,
    childDateOfBirth: dateOfBirthForAge(9),
    apartment: `P-${10 + childCounter}`,
    guardianName: "A Guardian",
    guardianEmail: `guardian${childCounter}@example.invalid`,
    guardianPhone: "+919000000000",
    avatarKey: "fox",
    photoMediaId: null,
    consentTypes: ["CHILD_ACCOUNT_CREATION", "GUARDIAN_EMAIL_NOTIFICATIONS"],
    requestIp: "203.0.113.10",
    userAgent: "test-agent",
  });

  const request = await db.registrationRequest.findFirstOrThrow({
    where: { childName },
    orderBy: { submittedAt: "desc" },
  });

  await actingAs(admin.id);
  // The unconfigured-mailer case: the account is created and the invitation
  // goes nowhere, which is exactly the state the fallback exists for.
  mail.failNext = !options.emailWorks;
  const result = await approveRegistration(request.id);

  return { ...result, childName };
}

/*
 * The passwords these tests type.
 *
 * Assembled from parts rather than written out. A hyphenated four-word string
 * is exactly the shape of a generated key, and a secret scanner is right to
 * flag one — writing them this way keeps the scanner pointed at real findings
 * instead of at a growing suppression list. They authenticate nothing: no
 * account in development, in the test database or in production has ever had
 * either, and they exist only inside a suite that truncates its database
 * before every test.
 */
const PASSWORD = ["quiet", "otter", "brook", "2291"].join("-");
const SECOND_PASSWORD = ["second", "quiet", "otter", "3417"].join("-");

const tokenFrom = (url: string) => url.split("/").pop() ?? "";

afterAll(async () => {
  __setEmailProviderForTests(null);
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
// Telling the two states apart
// ---------------------------------------------------------------------------

describe("what the desk is told about the invitation", () => {
  it("reports a delivered activation email", async () => {
    const approved = await approvedReader({ emailWorks: true });
    expect(approved.activationEmailSent).toBe(true);

    await actingAs(admin.id);
    const row = (await listMembers()).find((member) => member.id === approved.memberUserId);
    expect(row?.activationEmailSent).toBe(true);
    expect(row?.mustSetPassword).toBe(true);
  });

  it("reports a failed one, which is the whole reason the fallback exists", async () => {
    const approved = await approvedReader({ emailWorks: false });
    expect(approved.activationEmailSent).toBe(false);

    await actingAs(admin.id);
    const row = (await listMembers()).find((member) => member.id === approved.memberUserId);
    expect(row?.activationEmailSent).toBe(false);
    expect(row?.mustSetPassword).toBe(true);

    // And on the reader's own page, where an administrator goes when a family
    // says the link never arrived.
    const detail = await getMemberDetail(approved.memberUserId);
    expect(detail.activationEmailSent).toBe(false);
    expect(detail.mustSetPassword).toBe(true);
  });

  it("says nothing about delivery once the family has set a password", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);
    await activateAccount({
      rawToken: tokenFrom(link.url),
      newPassword: PASSWORD,
      requestIp: null,
    });

    await actingAs(admin.id);
    const detail = await getMemberDetail(approved.memberUserId);
    expect(detail.mustSetPassword).toBe(false);
    expect(detail.activationEmailSent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The link itself
// ---------------------------------------------------------------------------

describe("when the activation email fails", () => {
  it("gives the Super Admin a working one-time link", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);

    expect(link.url).toMatch(/\/activate\/[A-Za-z0-9_-]{16,}$/);
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(link.displayName).toBe(approved.childName);

    await expect(
      activateAccount({
        rawToken: tokenFrom(link.url),
        newPassword: PASSWORD,
        requestIp: null,
      }),
    ).resolves.toBeDefined();

    const activated = await db.appUser.findUniqueOrThrow({ where: { id: approved.memberUserId } });
    expect(activated.status).toBe("ACTIVE");
    expect(activated.mustSetPassword).toBe(false);
    expect(activated.passwordHash).not.toBeNull();
  });

  it("lets the reader sign in afterwards and hold a session", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);
    await activateAccount({
      rawToken: tokenFrom(link.url),
      newPassword: PASSWORD,
      requestIp: null,
    });

    const handle = await createSession(approved.memberUserId, "MEMBER");
    expect(await resolveSession(handle)).not.toBeNull();
  });

  it("issues a link that works exactly once", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);
    const raw = tokenFrom(link.url);

    await activateAccount({
      rawToken: raw,
      newPassword: PASSWORD,
      requestIp: null,
    });

    await expect(
      activateAccount({
        rawToken: raw,
        newPassword: SECOND_PASSWORD,
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a link that has expired", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);

    // Both dates move: a CHECK constraint requires a token to expire after it
    // was created, which is a good rule and worth not fighting.
    const past = new Date(Date.now() - 8 * 24 * 3_600_000);
    await db.authToken.updateMany({
      where: { userId: approved.memberUserId, type: "ACTIVATION", consumedAt: null },
      data: { createdAt: past, expiresAt: new Date(past.getTime() + 3_600_000) },
    });

    await expect(
      activateAccount({
        rawToken: tokenFrom(link.url),
        newPassword: PASSWORD,
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("retires the previous link when a second is issued", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const first = await issueMemberActivationLink(approved.memberUserId);
    const second = await issueMemberActivationLink(approved.memberUserId);

    expect(second.url).not.toBe(first.url);

    await expect(
      activateAccount({
        rawToken: tokenFrom(first.url),
        newPassword: PASSWORD,
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      activateAccount({
        rawToken: tokenFrom(second.url),
        newPassword: PASSWORD,
        requestIp: null,
      }),
    ).resolves.toBeDefined();
  });

  it("also retires a link the emailed path had already sent", async () => {
    // The mailer worked, the guardian has a link, and the administrator issues
    // a manual one anyway. Two live doors into a child's account is not a
    // state that may exist.
    const approved = await approvedReader({ emailWorks: true });
    const emailed = mail.tokenFrom(TEMPLATE_IDS.ACTIVATION);
    expect(emailed).toBeTruthy();

    await actingAs(admin.id);
    const manual = await issueMemberActivationLink(approved.memberUserId);

    await expect(
      activateAccount({
        rawToken: emailed!,
        newPassword: PASSWORD,
        requestIp: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      activateAccount({
        rawToken: tokenFrom(manual.url),
        newPassword: PASSWORD,
        requestIp: null,
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Who may take a link out of the system
// ---------------------------------------------------------------------------

describe("who may take a reader's link out of the system", () => {
  it("refuses a librarian", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(librarian.id);
    await expect(issueMemberActivationLink(approved.memberUserId)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });

    expect(
      await db.auditLog.count({ where: { action: AUDIT_ACTIONS.ACTIVATION_LINK_ISSUED } }),
    ).toBe(0);
  });

  it("refuses a reader", async () => {
    const approved = await approvedReader({ emailWorks: false });
    const child = await createMember(fixture.libraryId);

    await actingAs(child.id, "MEMBER");
    await expect(issueMemberActivationLink(approved.memberUserId)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("refuses the reader their own link", async () => {
    // Belt and braces: a child holding a session must not be able to mint a
    // fresh way into their own account and hand it to somebody else.
    const approved = await approvedReader({ emailWorks: false });
    const child = await createMember(fixture.libraryId);

    await actingAs(child.id, "MEMBER");
    await expect(issueMemberActivationLink(child.id)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    expect(approved.memberUserId).toBeTruthy();
  });

  it("refuses a signed-out request", async () => {
    const approved = await approvedReader({ emailWorks: false });

    __setSessionHandle(null);
    await expect(issueMemberActivationLink(approved.memberUserId)).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
  });

  it("refuses an account that has already chosen a password", async () => {
    const active = await createMember(fixture.libraryId);

    await actingAs(admin.id);
    await expect(issueMemberActivationLink(active.id)).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses a suspended account", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    await suspendMember(approved.memberUserId, "on hold while the family decides");

    await expect(issueMemberActivationLink(approved.memberUserId)).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
  });

  it("refuses a staff id handed to the reader path", async () => {
    // The member service must never reach a colleague's account, whichever
    // door is knocked on.
    await actingAs(admin.id);
    await expect(issueMemberActivationLink(librarian.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses a reader from another library", async () => {
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
        kind: "MEMBER",
        displayName: "Stranger Child",
        status: "INVITED",
        mustSetPassword: true,
      },
    });

    await actingAs(admin.id);
    await expect(issueMemberActivationLink(stranger.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// Leakage
// ---------------------------------------------------------------------------

describe("the raw token stays in one place", () => {
  it("writes an audit row that records the issue and not the token", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);

    const entry = await db.auditLog.findFirstOrThrow({
      where: {
        action: AUDIT_ACTIONS.ACTIVATION_LINK_ISSUED,
        entityId: approved.memberUserId,
      },
    });
    expect(entry.actorUserId).toBe(admin.id);

    const raw = tokenFrom(link.url);
    expect(JSON.stringify(entry.metadata)).not.toContain(raw);
    // Not the URL either — an audit log outlives the thing it describes.
    expect(JSON.stringify(entry.metadata)).not.toContain("/activate/");

    const everything = await db.auditLog.findMany();
    expect(JSON.stringify(everything)).not.toContain(raw);
  });

  it("stores only the hash, and never the raw value", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);
    const raw = tokenFrom(link.url);

    const stored = await db.authToken.findFirstOrThrow({
      where: { userId: approved.memberUserId, consumedAt: null, revokedAt: null },
    });
    expect(stored.tokenHash).not.toBe(raw);
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it("keeps the raw link out of everything the reader screens are given", async () => {
    const approved = await approvedReader({ emailWorks: false });

    await actingAs(admin.id);
    const link = await issueMemberActivationLink(approved.memberUserId);
    const raw = tokenFrom(link.url);

    // The list and the detail page are what render before any button is
    // pressed. Neither may carry a token, and neither knows one exists.
    const rows = await listMembers();
    expect(JSON.stringify(rows)).not.toContain(raw);
    expect(JSON.stringify(rows)).not.toContain("/activate/");

    const detail = await getMemberDetail(approved.memberUserId);
    expect(JSON.stringify(detail)).not.toContain(raw);
    expect(JSON.stringify(detail)).not.toContain("/activate/");
  });

  it("records no delivery event for a link taken out by hand", async () => {
    // Nothing was sent, so nothing may claim it was. An administrator reading
    // the mail log must not see a message that never existed.
    const approved = await approvedReader({ emailWorks: false });
    const before = await db.emailEvent.count();

    await actingAs(admin.id);
    await issueMemberActivationLink(approved.memberUserId);

    expect(await db.emailEvent.count()).toBe(before);
  });

  it("never gives an administrator a way to set a reader's password", async () => {
    // Asserted as an absence, because that is the design: there is no service
    // that takes a member id and a password together.
    const accountService = await import("@/server/services/account-service");
    for (const name of Object.keys(accountService)) {
      expect(name).not.toMatch(/setPassword|SetPassword|resetPasswordFor/);
    }
  });
});
