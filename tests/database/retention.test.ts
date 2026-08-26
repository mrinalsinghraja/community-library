import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  attachGuardian,
  createLibraryFixture,
  createMember,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * The nightly erasing pass, against a real database.
 *
 * The unit tests prove the policy and the wording. These prove the part that
 * cannot be proved without Postgres: that the queries select the right rows,
 * that a redacted row is not selected twice, that a unique constraint does not
 * stop the pass halfway through a family, and above all that the loan history
 * survives an erasure with its dates intact.
 *
 * Every test here sets its own periods on its own fixture library. Nothing
 * depends on a default, because the default is "decide nothing" and that is the
 * state the first test asserts.
 */

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
});

afterAll(async () => {
  await db.$disconnect();
});

async function setPolicy(policy: {
  archiveClosedAfterMonths?: number | null;
  removePhotoAfterClosedDays?: number | null;
  removeGuardianAfterMonths?: number | null;
}) {
  await db.librarySettings.update({
    where: { libraryId: fixture.libraryId },
    data: {
      archiveClosedAfterMonths: null,
      removePhotoAfterClosedDays: null,
      removeGuardianAfterMonths: null,
      ...policy,
    },
  });
}

/** A reader whose account was closed `days` ago. */
async function closedMember(days: number, status: "LEFT" | "GROWN_UP" | "DEACTIVATED" = "LEFT") {
  const member = await createMember(fixture.libraryId, { status });
  await db.appUser.update({
    where: { id: member.id },
    data: {
      status,
      statusReason: "The family moved to another building",
      statusChangedAt: new Date(Date.now() - days * 86_400_000),
    },
  });
  return member;
}

async function givePhoto(memberUserId: string) {
  const media = await db.mediaObject.create({
    data: {
      libraryId: fixture.libraryId,
      visibility: "PRIVATE",
      storageKey: `photos/${memberUserId}.jpg`,
      mimeType: "image/jpeg",
      byteSize: 1234,
      checksumSha256: "a".repeat(64),
      purpose: "member_photo",
    },
  });
  await db.memberProfile.update({
    where: { userId: memberUserId },
    data: { photoMediaId: media.id },
  });
  return media;
}

describe("a library that has decided nothing", () => {
  it("erases nothing, however long ago an account closed", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");

    const member = await closedMember(3650);
    await givePhoto(member.id);

    const result = await runRetentionPass();

    expect(result).toEqual({
      photosRemoved: 0,
      readersArchived: 0,
      guardiansRedacted: 0,
      policyUnset: true,
    });

    const after = await db.appUser.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.status).toBe("LEFT");
    expect(after.displayName).toBe(member.displayName);
  });
});

describe("photographs go first, and on their own clock", () => {
  it("deletes the photograph of a reader closed longer ago than the period", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removePhotoAfterClosedDays: 30 });

    const member = await closedMember(60);
    const media = await givePhoto(member.id);

    const result = await runRetentionPass();
    expect(result.photosRemoved).toBe(1);

    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });
    expect(profile.photoMediaId).toBeNull();

    // The row is marked, not deleted: the media sweeper in the same nightly run
    // is what removes the bytes, and it must not be able to lose track of them.
    const object = await db.mediaObject.findUniqueOrThrow({ where: { id: media.id } });
    expect(object.pendingDeletionAt).not.toBeNull();
  });

  it("leaves a reader closed more recently than the period alone", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removePhotoAfterClosedDays: 30 });

    const member = await closedMember(10);
    await givePhoto(member.id);

    expect((await runRetentionPass()).photosRemoved).toBe(0);
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });
    expect(profile.photoMediaId).not.toBeNull();
  });

  it("never touches a reader whose account is still open", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removePhotoAfterClosedDays: 1 });

    const active = await createMember(fixture.libraryId, { status: "ACTIVE" });
    await givePhoto(active.id);

    expect((await runRetentionPass()).photosRemoved).toBe(0);
    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: active.id } });
    expect(profile.photoMediaId).not.toBeNull();
  });

  it("does not archive the reader as a side effect", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removePhotoAfterClosedDays: 30 });

    const member = await closedMember(60);
    await givePhoto(member.id);
    await runRetentionPass();

    const after = await db.appUser.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.status).toBe("LEFT");
    expect(after.displayName).toBe(member.displayName);
  });

  it("finds nothing to do the second night", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removePhotoAfterClosedDays: 30 });

    const member = await closedMember(60);
    await givePhoto(member.id);

    expect((await runRetentionPass()).photosRemoved).toBe(1);
    expect((await runRetentionPass()).photosRemoved).toBe(0);
  });
});

describe("erasing a departed reader", () => {
  it("removes the name, the flat and the sign-in details", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 24 });

    const member = await closedMember(365 * 3);
    const before = await db.memberProfile.findUniqueOrThrow({ where: { userId: member.id } });

    expect((await runRetentionPass()).readersArchived).toBe(1);

    const after = await db.appUser.findUniqueOrThrow({
      where: { id: member.id },
      include: { memberProfile: true },
    });

    expect(after.status).toBe("ARCHIVED");
    expect(after.displayName).toBe(before.memberCode);
    expect(after.email).toBeNull();
    expect(after.username).toBeNull();
    expect(after.passwordHash).toBeNull();
    // The reason can name a sibling or a flat. The audit trail keeps the
    // explanation; the account row does not.
    expect(after.statusReason).toBeNull();
    expect(after.memberProfile?.apartment).toBe("removed");
    expect(after.memberProfile?.staffNotes).toBeNull();
    expect(after.memberProfile?.photoMediaId).toBeNull();
  });

  it("keeps the borrowing history, with its dates and its book", async () => {
    const { createBookCopy } = await import("./helpers");
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 24 });

    const member = await closedMember(365 * 3);
    const copy = await createBookCopy(fixture.libraryId);

    const issuedAt = new Date("2024-01-10T00:00:00Z");
    const loan = await db.loan.create({
      data: {
        libraryId: fixture.libraryId,
        copyId: copy.id,
        memberUserId: member.id,
        status: "RETURNED",
        issuedAt,
        dueAt: new Date("2024-01-24T00:00:00Z"),
        returnedAt: new Date("2024-01-20T00:00:00Z"),
      },
    });

    await runRetentionPass();

    const after = await db.loan.findUniqueOrThrow({
      where: { id: loan.id },
      include: { member: true, copy: true },
    });

    expect(after.issuedAt.toISOString()).toBe(issuedAt.toISOString());
    expect(after.copyId).toBe(copy.id);
    // Still attached to a row, and that row is now the card number rather than
    // a child. This is the whole shape of the compromise.
    expect(after.member.status).toBe("ARCHIVED");
    expect(after.member.displayName).toMatch(/^TST-H/);
  });

  it("ends every session and kills every live link", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 24 });

    const member = await closedMember(365 * 3);
    await db.session.create({
      data: {
        userId: member.id,
        tokenHash: "s".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await runRetentionPass();

    expect(await db.session.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.authToken.count({ where: { userId: member.id } })).toBe(0);
  });

  it("erases two readers in one night without colliding on a unique column", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 24 });

    await closedMember(365 * 3);
    await closedMember(365 * 3, "GROWN_UP");

    // Both have a username and both lose it. A shared placeholder would fail
    // the second update and leave half a cohort erased.
    expect((await runRetentionPass()).readersArchived).toBe(2);
  });

  it("never re-erases an archived reader", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 24 });

    await closedMember(365 * 3);
    expect((await runRetentionPass()).readersArchived).toBe(1);
    expect((await runRetentionPass()).readersArchived).toBe(0);
  });

  it("leaves a suspended reader alone — that is somebody's decision, not a closure", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 6 });

    const paused = await createMember(fixture.libraryId, { status: "SUSPENDED" });
    await db.appUser.update({
      where: { id: paused.id },
      data: { statusChangedAt: new Date("2020-01-01T00:00:00Z") },
    });

    expect((await runRetentionPass()).readersArchived).toBe(0);
    const after = await db.appUser.findUniqueOrThrow({ where: { id: paused.id } });
    expect(after.status).toBe("SUSPENDED");
  });

  it("writes an audit row that carries no name", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 24 });

    const member = await closedMember(365 * 3);
    const name = member.displayName;
    await runRetentionPass();

    const audit = await db.auditLog.findFirst({
      where: { action: "retention.reader.archived", entityId: member.id },
    });

    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBeNull();
    expect(JSON.stringify(audit?.metadata)).not.toContain(name);
  });
});

describe("erasing a grown-up", () => {
  it("waits until every child of theirs is archived", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removeGuardianAfterMonths: 6 });

    const elder = await closedMember(365 * 5);
    const younger = await createMember(fixture.libraryId, { status: "ACTIVE" });

    const guardian = await attachGuardian(fixture.libraryId, elder.id);
    await db.guardianMember.create({
      data: { guardianId: guardian.id, memberUserId: younger.id, isPrimary: false },
    });

    // The elder child is not even archived yet, and the younger one is still
    // borrowing. The library still needs to be able to reach this parent.
    expect((await runRetentionPass()).guardiansRedacted).toBe(0);

    const after = await db.guardian.findUniqueOrThrow({ where: { id: guardian.id } });
    expect(after.email).toBe(guardian.email);
  });

  it("erases the contact details once the last child has been erased long enough ago", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ archiveClosedAfterMonths: 6, removeGuardianAfterMonths: 6 });

    const child = await closedMember(365 * 5);
    const guardian = await attachGuardian(fixture.libraryId, child.id);

    // Night one archives the child, which starts the guardian's clock.
    expect((await runRetentionPass()).readersArchived).toBe(1);
    expect((await runRetentionPass()).guardiansRedacted).toBe(0);

    // Wind that archival back beyond the guardian period.
    await db.appUser.update({
      where: { id: child.id },
      data: { statusChangedAt: new Date(Date.now() - 365 * 86_400_000) },
    });

    expect((await runRetentionPass()).guardiansRedacted).toBe(1);

    const after = await db.guardian.findUniqueOrThrow({ where: { id: guardian.id } });
    expect(after.fullName).toBe("Former guardian");
    expect(after.email).toMatch(/@removed\.invalid$/);
    expect(after.phone).toBe("removed");
    expect(after.apartment).toBe("removed");

    // The link and the row survive: consent records hang off this guardian, and
    // a consent whose giver has been deleted is a consent nobody gave.
    expect(await db.guardianMember.count({ where: { guardianId: guardian.id } })).toBe(1);
  });

  it("never redacts the same grown-up twice", async () => {
    const { runRetentionPass } = await import("@/server/lib/retention");
    await setPolicy({ removeGuardianAfterMonths: 6 });

    const child = await closedMember(0, "LEFT");
    await attachGuardian(fixture.libraryId, child.id);
    await db.appUser.update({
      where: { id: child.id },
      data: { status: "ARCHIVED", statusChangedAt: new Date(Date.now() - 365 * 86_400_000) },
    });

    expect((await runRetentionPass()).guardiansRedacted).toBe(1);
    expect((await runRetentionPass()).guardiansRedacted).toBe(0);
  });
});

describe("the preview the settings screen shows", () => {
  it("counts nothing when nothing is decided", async () => {
    const { retentionDue } = await import("@/server/lib/retention");
    await closedMember(3650);

    const due = await retentionDue(fixture.libraryId, {
      archiveClosedAfterMonths: null,
      removePhotoAfterClosedDays: null,
      removeGuardianAfterMonths: null,
    });

    expect(due).toEqual({ photos: 0, readers: 0, guardians: 0 });
  });

  it("counts what a proposed period would erase tonight", async () => {
    const { retentionDue } = await import("@/server/lib/retention");
    const member = await closedMember(365 * 3);
    await givePhoto(member.id);

    const due = await retentionDue(fixture.libraryId, {
      archiveClosedAfterMonths: 24,
      removePhotoAfterClosedDays: 30,
      removeGuardianAfterMonths: null,
    });

    expect(due.readers).toBe(1);
    expect(due.photos).toBe(1);
  });
});
