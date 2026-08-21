import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { env } from "@/server/env";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { issueBook, renewLoan } from "@/server/services/circulation-service";
import { __setEmailProviderForTests } from "@/server/lib/email";
import { RATE_LIMITS } from "@/server/lib/rate-limit";
import {
  getAdminSettings,
  sendEmailDeliveryTest,
  setOverdueReminders,
  updateBranding,
  updateLibrarySettings,
  updateVerificationRequirement,
} from "@/server/services/settings-service";
import { sendCirculationReminders } from "@/server/services/notification-service";

import { FakeEmailProvider } from "./fake-email";
import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Library configuration, against a real database.
 *
 * The properties worth proving here are not "the form saves". They are:
 *
 *   1. **A setting decides the future.** Changing the loan period must not move
 *      a due date a child has already been told. This is the one that would
 *      hurt a real family, and it is the first test in the file.
 *   2. **Only a Super Admin.** A librarian runs the library; they do not get to
 *      change what the library is.
 *   3. **Dormant columns have no path in**, whatever a tampered form contains.
 *   4. **Reminders cannot be switched on into a void.** With no mail provider
 *      the service refuses, so the screen's disabled control is not the only
 *      thing standing between a librarian and a false belief.
 *   5. **Every change is a row somebody can read afterwards.**
 */

let fixture: Fixture;
let admin: Awaited<ReturnType<typeof createStaff>>;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  __setSessionHandle(await createSession(userId, kind));
}

/** The settings row exactly as the database holds it now. */
async function currentSettings() {
  return db.librarySettings.findUniqueOrThrow({ where: { libraryId: fixture.libraryId } });
}

const VALID = {
  libraryName: "Test Children's Library",
  timezone: "Asia/Kolkata",
  dateFormat: "d MMM yyyy",
  borrowingPeriodDays: "14",
  maxActiveLoans: "2",
  maxRenewals: "1",
  renewalPeriodDays: "14",
  ageMin: "5",
  ageMax: "14",
  memberCodePrefix: "TST-R",
  copyCodePrefix: "TST-B",
  catalogueVisibility: "MEMBER_ONLY",
};

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  __setSessionHandle(null);
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  admin = await createStaff(fixture.libraryId, "SUPER_ADMIN");
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  reader = await createMember(fixture.libraryId);
  __setSessionHandle(null);
});

describe("who may change the library", () => {
  it("lets a Super Admin read and write the settings", async () => {
    await actingAs(admin.id);

    const view = await getAdminSettings();
    expect(view.settings.borrowingPeriodDays).toBe(14);

    await updateLibrarySettings({ ...VALID, borrowingPeriodDays: "21" });
    expect((await currentSettings()).borrowingPeriodDays).toBe(21);
  });

  it("refuses a librarian, who runs the library but does not define it", async () => {
    await actingAs(librarian.id);

    await expect(getAdminSettings()).rejects.toThrow();
    await expect(updateLibrarySettings(VALID)).rejects.toThrow();
    await expect(updateBranding({ primaryColor: "#1F6F5C" })).rejects.toThrow();
    await expect(setOverdueReminders(true)).rejects.toThrow();

    expect((await currentSettings()).borrowingPeriodDays).toBe(14);
  });

  it("refuses a child", async () => {
    await actingAs(reader.id, "MEMBER");

    await expect(getAdminSettings()).rejects.toThrow();
    await expect(updateLibrarySettings({ ...VALID, maxActiveLoans: "5" })).rejects.toThrow();
    expect((await currentSettings()).maxActiveLoans).toBe(2);
  });

  it("refuses a signed-out request", async () => {
    __setSessionHandle(null);

    await expect(getAdminSettings()).rejects.toThrow();
    await expect(updateLibrarySettings(VALID)).rejects.toThrow();
  });
});

describe("a setting decides the future, not the past", () => {
  it("leaves a book already borrowed with the date the child was told", async () => {
    await actingAs(librarian.id);
    const copy = await createBookCopy(fixture.libraryId);
    const loan = await issueBook({ memberUserId: reader.id, copyId: copy.id });
    const promisedDate = loan.dueAt;

    await actingAs(admin.id);
    await updateLibrarySettings({ ...VALID, borrowingPeriodDays: "21" });

    const unchanged = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    expect(unchanged.dueAt.getTime()).toBe(promisedDate.getTime());
    expect(unchanged.renewalCount).toBe(0);

    // And nothing wrote a loan event pretending something happened to it.
    const events = await db.loanEvent.count({ where: { loanId: loan.loanId } });
    expect(events).toBe(1);
  });

  it("uses the new period for the next book that goes out", async () => {
    await actingAs(admin.id);
    await updateLibrarySettings({ ...VALID, borrowingPeriodDays: "21" });

    await actingAs(librarian.id);
    const copy = await createBookCopy(fixture.libraryId);
    const issued = await issueBook({ memberUserId: reader.id, copyId: copy.id });

    const daysOut = Math.round((issued.dueAt.getTime() - Date.now()) / 86_400_000);
    // End of day in the library's timezone, so 21 or 22 depending on the hour.
    expect(daysOut).toBeGreaterThanOrEqual(21);
    expect(daysOut).toBeLessThanOrEqual(22);
  });

  it("does not lengthen a renewal that already happened", async () => {
    await actingAs(librarian.id);
    const copy = await createBookCopy(fixture.libraryId);
    const loan = await issueBook({ memberUserId: reader.id, copyId: copy.id });
    const renewed = await renewLoan({ loanId: loan.loanId });
    const dateAfterRenewal = renewed.dueAt;

    await actingAs(admin.id);
    await updateLibrarySettings({ ...VALID, renewalPeriodDays: "30" });

    const stored = await db.loan.findUniqueOrThrow({ where: { id: loan.loanId } });
    expect(stored.dueAt.getTime()).toBe(dateAfterRenewal.getTime());
    expect(stored.renewalCount).toBe(1);
  });

  it("does not renumber a card or a book label that already exists", async () => {
    await actingAs(librarian.id);
    const copy = await createBookCopy(fixture.libraryId);
    const originalCode = copy.copyCode;

    await actingAs(admin.id);
    await updateLibrarySettings({ ...VALID, copyCodePrefix: "NEW-B" });

    const stored = await db.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(stored.copyCode).toBe(originalCode);
  });
});

describe("validation is the server's job", () => {
  it("refuses a loan period outside the bounds, whatever the form said", async () => {
    await actingAs(admin.id);

    await expect(updateLibrarySettings({ ...VALID, borrowingPeriodDays: "365" })).rejects.toThrow();
    await expect(updateLibrarySettings({ ...VALID, maxActiveLoans: "99" })).rejects.toThrow();
    await expect(updateLibrarySettings({ ...VALID, maxRenewals: "-1" })).rejects.toThrow();

    const settings = await currentSettings();
    expect(settings.borrowingPeriodDays).toBe(14);
    expect(settings.maxActiveLoans).toBe(2);
    expect(settings.maxRenewals).toBe(1);
  });

  it("writes nothing at all when one field is wrong", async () => {
    await actingAs(admin.id);

    await expect(
      updateLibrarySettings({ ...VALID, maxActiveLoans: "3", borrowingPeriodDays: "999" }),
    ).rejects.toThrow();

    // The good field did not sneak through on the back of the bad one.
    expect((await currentSettings()).maxActiveLoans).toBe(2);
  });

  it("ignores a dormant column smuggled into the submission", async () => {
    await actingAs(admin.id);
    const before = await currentSettings();

    await updateLibrarySettings({
      ...VALID,
      blockOnOverdueDays: 1,
      renewalBlockedWhenReserved: false,
      emailEnabled: true,
      overdueRemindersEnabled: true,
      requiredGuardianVerification: "STAFF_VERIFIED",
      consentVersion: "tampered",
    });

    const after = await currentSettings();
    expect(after.blockOnOverdueDays).toBe(before.blockOnOverdueDays);
    expect(after.renewalBlockedWhenReserved).toBe(before.renewalBlockedWhenReserved);
    expect(after.emailEnabled).toBe(before.emailEnabled);
    expect(after.overdueRemindersEnabled).toBe(false);
    expect(after.requiredGuardianVerification).toBe(before.requiredGuardianVerification);
    expect(after.consentVersion).toBe(before.consentVersion);
  });
});

describe("the audit log", () => {
  it("records what moved, and who moved it", async () => {
    await actingAs(admin.id);
    await updateLibrarySettings({ ...VALID, borrowingPeriodDays: "21", maxActiveLoans: "3" });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.SETTINGS_UPDATED },
      orderBy: { occurredAt: "desc" },
    });

    expect(entry.actorUserId).toBe(admin.id);
    expect(entry.entityType).toBe("library_settings");

    const changes = (entry.metadata as { changes: Record<string, { from: number; to: number }> })
      .changes;
    expect(changes.borrowingPeriodDays).toEqual({ from: 14, to: 21 });
    expect(changes.maxActiveLoans).toEqual({ from: 2, to: 3 });
    // Fields nobody touched are not in the record.
    expect(changes.timezone).toBeUndefined();
  });

  it("writes nothing when nothing changed", async () => {
    await actingAs(admin.id);
    const result = await updateLibrarySettings(VALID);

    expect(result.changed).toEqual([]);
    expect(await db.auditLog.count({ where: { action: AUDIT_ACTIONS.SETTINGS_UPDATED } })).toBe(0);
  });

  it("keeps branding text out of the log, and names the fields instead", async () => {
    await actingAs(admin.id);
    await updateBranding({
      primaryColor: "#1F6F5C",
      welcomeMessage: "Hello young readers",
      rulesMarkdown: "Be gentle with the books.",
    });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.BRANDING_UPDATED },
    });

    expect(entry.metadata).toEqual({
      changed: expect.arrayContaining(["welcomeMessage", "rulesMarkdown"]),
    });
    expect(JSON.stringify(entry.metadata)).not.toContain("Hello young readers");
  });
});

describe("branding", () => {
  it("reaches the pages children look at", async () => {
    await actingAs(admin.id);
    await updateBranding({ primaryColor: "#14574A", welcomeMessage: "Welcome to our shelf" });

    const settings = await currentSettings();
    expect(settings.primaryColor).toBe("#14574A");
    expect(settings.welcomeMessage).toBe("Welcome to our shelf");
  });

  it("stores an emptied box as nothing, not as an empty string", async () => {
    await actingAs(admin.id);
    await updateBranding({ primaryColor: "#1F6F5C", contactPhone: "+910000000000" });
    expect((await currentSettings()).contactPhone).toBe("+910000000000");

    await updateBranding({ primaryColor: "#1F6F5C", contactPhone: "" });
    expect((await currentSettings()).contactPhone).toBeNull();
  });

  it("refuses a colour the library's mark would vanish into", async () => {
    await actingAs(admin.id);
    await expect(updateBranding({ primaryColor: "#FFFDE7" })).rejects.toThrow();
    expect((await currentSettings()).primaryColor).toBe("#1F6F5C");
  });

  it("cannot rename the library from the branding screen", async () => {
    await actingAs(admin.id);
    await updateBranding({
      primaryColor: "#1F6F5C",
      // A field the branding schema does not have. It must not arrive anywhere.
      libraryName: "Somebody Else's Library",
    } as Record<string, unknown>);

    const library = await db.library.findUniqueOrThrow({ where: { id: fixture.libraryId } });
    expect(library.name).toBe("Test Children's Library");
  });
});

describe("guardian verification", () => {
  it("refuses to change without an explicit confirmation", async () => {
    await actingAs(admin.id);

    await expect(
      updateVerificationRequirement({ strength: "STAFF_VERIFIED", confirmed: false }),
    ).rejects.toThrow();

    expect((await currentSettings()).requiredGuardianVerification).toBe("SELF_DECLARED");
  });

  it("changes it when confirmed, and says so in the log", async () => {
    await actingAs(admin.id);
    await updateVerificationRequirement({ strength: "EMAIL_CONFIRMED", confirmed: true });

    expect((await currentSettings()).requiredGuardianVerification).toBe("EMAIL_CONFIRMED");

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.SETTINGS_UPDATED },
      orderBy: { occurredAt: "desc" },
    });
    expect(JSON.stringify(entry.metadata)).toContain("EMAIL_CONFIRMED");
  });

  it("refuses a strength nothing implements, and refuses requiring nothing", async () => {
    await actingAs(admin.id);

    // Requiring IDENTITY_PROVIDER would make every approval impossible.
    await expect(
      updateVerificationRequirement({ strength: "IDENTITY_PROVIDER", confirmed: true }),
    ).rejects.toThrow();
    // NONE is not one tap away on a screen about children's accounts.
    await expect(
      updateVerificationRequirement({ strength: "NONE", confirmed: true }),
    ).rejects.toThrow();

    expect((await currentSettings()).requiredGuardianVerification).toBe("SELF_DECLARED");
  });

  it("does not touch a consent record that already exists", async () => {
    const guardian = await db.guardian.create({
      data: {
        libraryId: fixture.libraryId,
        fullName: "A Guardian",
        email: "g@example.invalid",
        phone: "+910000000000",
        apartment: "Z1",
      },
    });
    const consent = await db.consentRecord.create({
      data: {
        libraryId: fixture.libraryId,
        type: "CHILD_ACCOUNT_CREATION",
        guardianId: guardian.id,
        memberUserId: reader.id,
        consentVersion: "2026-08-v1",
        consentTextSnapshot: "The exact words shown at the time.",
      },
    });

    await actingAs(admin.id);
    await updateVerificationRequirement({ strength: "STAFF_VERIFIED", confirmed: true });
    await updateLibrarySettings({ ...VALID, libraryName: "Renamed Library" });

    const after = await db.consentRecord.findUniqueOrThrow({ where: { id: consent.id } });
    expect(after.consentVersion).toBe("2026-08-v1");
    expect(after.consentTextSnapshot).toBe("The exact words shown at the time.");
  });
});

describe("the reminder switch", () => {
  const originalProvider = env.EMAIL_PROVIDER;

  afterEach(() => {
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = originalProvider;
  });

  it("starts off", async () => {
    expect((await currentSettings()).overdueRemindersEnabled).toBe(false);
  });

  it("cannot be turned on while email reaches nobody", async () => {
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = "console";
    await actingAs(admin.id);

    // The technical message names the provider; the one a librarian sees does
    // not. Both are asserted, because the second is the promise being kept.
    await expect(setOverdueReminders(true)).rejects.toThrow(/Refused to enable reminders/i);
    await expect(setOverdueReminders(true)).rejects.toMatchObject({
      friendlyMessage: expect.stringMatching(/cannot be turned on until a real email service/i),
    });
    expect((await currentSettings()).overdueRemindersEnabled).toBe(false);
  });

  it("sends nothing while it is off, even with a book overdue", async () => {
    await actingAs(librarian.id);
    const copy = await createBookCopy(fixture.libraryId);
    const loan = await issueBook({ memberUserId: reader.id, copyId: copy.id });
    // A book cannot be due before it was lent — a check constraint says so — so
    // the whole loan moves into the past, which is what a late loan looks like.
    const dueAt = new Date(Date.now() - 3 * 86_400_000);
    await db.loan.update({
      where: { id: loan.loanId },
      data: { dueAt, issuedAt: new Date(dueAt.getTime() - 14 * 86_400_000) },
    });

    const result = await sendCirculationReminders();

    expect(result.enabled).toBe(false);
    expect(result.sent).toBe(0);
    expect(await db.loanNotification.count()).toBe(0);
  });

  it("can be turned on once a provider is configured, and off again always", async () => {
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = "smtp";
    await actingAs(admin.id);

    await setOverdueReminders(true);
    expect((await currentSettings()).overdueRemindersEnabled).toBe(true);

    // Silence is never the dangerous direction: turning them off is allowed
    // whatever the provider is.
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = "console";
    await setOverdueReminders(false);
    expect((await currentSettings()).overdueRemindersEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("proving the library can send email", () => {
  const fake = new FakeEmailProvider();

  beforeEach(() => {
    fake.reset();
    __setEmailProviderForTests(fake);
  });

  afterEach(() => {
    __setEmailProviderForTests(null);
  });

  it("writes to the administrator's own address and nobody else's", async () => {
    /*
     * The property that makes this button safe to exist. The recipient is not a
     * parameter anywhere in the chain -- not on the form, not on the action, not
     * on the service -- so no request can point a test message at a guardian or
     * at a child.
     */
    await actingAs(admin.id);

    const result = await sendEmailDeliveryTest();

    expect(result.ok).toBe(true);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe(admin.email);
  });

  it("carries no link and no token", async () => {
    await actingAs(admin.id);
    await sendEmailDeliveryTest();

    const message = fake.sent[0];
    expect(message.text).not.toMatch(/\/activate\/|\/reset\/|\/verify\//);
    expect(message.html).not.toMatch(/\/activate\/|\/reset\/|\/verify\//);
  });

  it("refuses a Librarian, who runs the library but does not configure it", async () => {
    await actingAs(librarian.id);

    await expect(sendEmailDeliveryTest()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(fake.sent).toHaveLength(0);
  });

  it("refuses a reader", async () => {
    await actingAs(reader.id, "MEMBER");

    await expect(sendEmailDeliveryTest()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(fake.sent).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    __setSessionHandle(null);

    await expect(sendEmailDeliveryTest()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    expect(fake.sent).toHaveLength(0);
  });

  it("records the attempt on the delivery log either way", async () => {
    await actingAs(admin.id);
    await sendEmailDeliveryTest();

    fake.failNext = true;
    const failed = await sendEmailDeliveryTest();

    expect(failed.ok).toBe(false);
    // The provider's own words reach the administrator, because "could not
    // send" is not something anybody can act on.
    expect(failed.detail).toContain("simulated transport failure");

    const events = await db.emailEvent.findMany({
      where: { template: "delivery_test" },
      orderBy: { createdAt: "asc" },
      select: { status: true, error: true },
    });
    expect(events.map((event) => event.status)).toEqual(["SENT", "FAILED"]);
    expect(events[0].error).toBeNull();
  });

  it("stops after a handful of tests that actually left", async () => {
    /*
     * A delivered test spends a message out of the same daily allowance the
     * families' activation links come out of, so those stay tightly capped.
     */
    await actingAs(admin.id);

    for (let attempt = 0; attempt < RATE_LIMITS.emailTestsMax; attempt += 1) {
      await sendEmailDeliveryTest();
    }

    await expect(sendEmailDeliveryTest()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fake.sent).toHaveLength(RATE_LIMITS.emailTestsMax);
  });

  it("does not count a refused send against the allowance, because it spent none", async () => {
    /*
     * The failure this closes. Somebody configuring the transport for the first
     * time presses this repeatedly on purpose -- change a key, read the reason,
     * change something else -- and every one of those presses was refused by the
     * provider, so none of them cost the library a message. Locking them out
     * mid-diagnosis is the software obstructing the one job this button has.
     */
    await actingAs(admin.id);

    for (let attempt = 0; attempt < RATE_LIMITS.emailTestsMax + 3; attempt += 1) {
      fake.failNext = true;
      const result = await sendEmailDeliveryTest();
      expect(result.ok).toBe(false);
    }

    // Still allowed, and the successful one still goes.
    await expect(sendEmailDeliveryTest()).resolves.toMatchObject({ ok: true });
  });

  it("still stops somebody hammering the button", async () => {
    // Presses cost nothing, but they are not free forever either.
    await actingAs(admin.id);

    for (let attempt = 0; attempt < RATE_LIMITS.emailTestAttemptsMax; attempt += 1) {
      fake.failNext = true;
      await sendEmailDeliveryTest();
    }

    await expect(sendEmailDeliveryTest()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("says so plainly when the administrator has no address of their own", async () => {
    await db.appUser.update({ where: { id: admin.id }, data: { email: null } });
    await actingAs(admin.id);

    await expect(sendEmailDeliveryTest()).rejects.toMatchObject({ code: "RULE_VIOLATION" });
    expect(fake.sent).toHaveLength(0);
  });

  it("tells the settings page what the transport is without naming a secret", async () => {
    await actingAs(admin.id);
    await sendEmailDeliveryTest();

    const view = await getAdminSettings();

    expect(view.email.testRecipient).toBe(admin.email);
    expect(view.email.lastSentAt).toBeInstanceOf(Date);
    expect(JSON.stringify(view.email)).not.toMatch(/key|password|token/i);
  });

  it("counts recent failures, so the page can say email is broken before it is asked", async () => {
    await actingAs(admin.id);
    fake.failNext = true;
    await sendEmailDeliveryTest();

    expect((await getAdminSettings()).email.recentFailures).toBe(1);
  });
});
