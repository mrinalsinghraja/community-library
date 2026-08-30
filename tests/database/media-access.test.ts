import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CHILD_PHOTO_MAX_BYTES } from "@/lib/child-photo";
import { describeSize } from "@/lib/file-size";
import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { AUDIT_ACTIONS } from "@/server/lib/audit";
import { __setStorageDriverForTests } from "@/server/lib/storage";
import {
  claimUnclaimedChildPhoto,
  getAuthorizedMedia,
  removeMemberPhoto,
  replaceMemberPhoto,
  storeChildPhoto,
  sweepPendingMedia,
} from "@/server/services/media-service";

import { FakeStorageDriver, elfBytes, pngBytes } from "./fake-storage";
import {
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Child photographs, against a real database and a recording object store.
 *
 * The property under test throughout: a private picture of a child is reachable
 * by exactly two kinds of person — that child, and staff who need it — and it
 * never outlives the row that points at it.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
const storageDriver = new FakeStorageDriver();

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "STAFF") {
  const handle = await createSession(userId, kind);
  __setSessionHandle(handle);
}

/** Uploads a photo and attaches it to a member, the way approval would. */
async function givePhotoTo(memberUserId: string) {
  const stored = await storeChildPhoto({ libraryId: fixture.libraryId, bytes: pngBytes() });
  await claimUnclaimedChildPhoto(db, {
    mediaId: stored.mediaId,
    libraryId: fixture.libraryId,
  });
  await db.memberProfile.update({
    where: { userId: memberUserId },
    data: { photoMediaId: stored.mediaId },
  });
  return stored.mediaId;
}

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  __setStorageDriverForTests(storageDriver);
});

beforeEach(() => {
  storageDriver.reset();
});

afterEach(() => {
  __setSessionHandle(null);
});

afterAll(async () => {
  __setStorageDriverForTests(null);
  await db.$disconnect();
});

// ---------------------------------------------------------------------------

describe("who may read a child's photograph", () => {
  it("refuses a signed-out visitor", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    __setSessionHandle(null);
    await expect(getAuthorizedMedia(mediaId)).rejects.toThrow();
  });

  it("lets a child see their own photograph", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    await actingAs(child.id, "MEMBER");
    const media = await getAuthorizedMedia(mediaId);

    expect(media.mimeType).toBe("image/png");
    expect(media.bytes.byteLength).toBeGreaterThan(0);
  });

  /*
   * The route decides how a response may be cached from the purpose this
   * returns. A photograph of a child reporting anything other than
   * `child_photo` would put it on the revalidatable list — see
   * MEDIA_MAY_REVALIDATE and its unit tests — so the value is asserted against
   * real data rather than assumed.
   */
  it("reports a photograph as a child photograph, with the digest of what was stored", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    await actingAs(child.id, "MEMBER");
    const media = await getAuthorizedMedia(mediaId);
    const row = await db.mediaObject.findUniqueOrThrow({
      where: { id: mediaId },
      select: { purpose: true, checksumSha256: true },
    });

    expect(media.purpose).toBe("child_photo");
    expect(media.purpose).toBe(row.purpose);
    // The digest is what the route would use as an ETag, so it has to describe
    // the bytes actually stored rather than the bytes uploaded.
    expect(media.checksumSha256).toBe(row.checksumSha256);
    expect(media.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses one child another child's photograph, as NotFound", async () => {
    const owner = await createMember(fixture.libraryId);
    const stranger = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(owner.id);

    await actingAs(stranger.id, "MEMBER");

    // NOT_FOUND, never NOT_AUTHORIZED: a child walking ids must not be able to
    // tell a real photograph from an imaginary one.
    await expect(getAuthorizedMedia(mediaId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gives an unknown id exactly the same answer as another child's id", async () => {
    const owner = await createMember(fixture.libraryId);
    const stranger = await createMember(fixture.libraryId);
    const realId = await givePhotoTo(owner.id);

    await actingAs(stranger.id, "MEMBER");

    const forReal = await getAuthorizedMedia(realId).catch((error) => error);
    const forImaginary = await getAuthorizedMedia(
      "01999999-9999-7999-8999-999999999999",
    ).catch((error) => error);

    expect(forReal.code).toBe(forImaginary.code);
  });

  it("lets a librarian see a reader's photograph", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    await actingAs(librarian.id);
    await expect(getAuthorizedMedia(mediaId)).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("refuses an object that is already scheduled for deletion", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    await db.mediaObject.update({
      where: { id: mediaId },
      data: { pendingDeletionAt: new Date() },
    });

    await actingAs(child.id, "MEMBER");
    await expect(getAuthorizedMedia(mediaId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------

describe("uploads", () => {
  it("rejects an executable renamed as a picture", async () => {
    await expect(
      storeChildPhoto({
        libraryId: fixture.libraryId,
        bytes: elfBytes(),
        declaredMimeType: "image/jpeg",
        originalFilename: "sweet-child.jpg",
      }),
    ).rejects.toThrow();

    // Nothing reached storage: validation happens before the write.
    expect(storageDriver.objects.size).toBe(0);
  });

  it("rejects an oversized picture without storing it", async () => {
    const error = await storeChildPhoto({
      libraryId: fixture.libraryId,
      bytes: pngBytes(6 * 1024 * 1024),
    }).catch((thrown) => thrown);

    // The parent is told the limit in plain words, not "validation failed" --
    // and the number comes from the rule, so it cannot drift away from it.
    expect(error.fieldErrors.file).toContain(`under ${describeSize(CHILD_PHOTO_MAX_BYTES)}`);
    expect(storageDriver.objects.size).toBe(0);
  });

  it("never puts the uploaded filename into the storage key", async () => {
    const stored = await storeChildPhoto({
      libraryId: fixture.libraryId,
      bytes: pngBytes(),
      originalFilename: "../../etc/passwd.png",
    });

    const media = await db.mediaObject.findUniqueOrThrow({ where: { id: stored.mediaId } });
    expect(media.storageKey).not.toContain("passwd");
    expect(media.storageKey).not.toContain("..");
    // And a child photograph is never public, whatever the caller asked for.
    expect(media.visibility).toBe("PRIVATE");
    expect(media.publicUrl).toBeNull();
  });

  it("refuses to attach a photograph that already belongs to somebody", async () => {
    const owner = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(owner.id);

    // The attack: post a registration carrying another child's media id.
    await expect(
      claimUnclaimedChildPhoto(db, { mediaId, libraryId: fixture.libraryId }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("removal", () => {
  it("clears the photo, deletes the bytes, and leaves the avatar behind", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);
    await db.memberProfile.update({
      where: { userId: child.id },
      data: { avatarKey: "turtle" },
    });

    await actingAs(librarian.id);
    await removeMemberPhoto(child.id, "family asked us to take it down");

    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: child.id } });
    expect(profile.photoMediaId).toBeNull();
    // The avatar choice survives — removal is not a punishment.
    expect(profile.avatarKey).toBe("turtle");

    expect(await db.mediaObject.count({ where: { id: mediaId } })).toBe(0);
    expect(storageDriver.objects.size).toBe(0);
  });

  it("writes an audit row that names the object but not its bytes", async () => {
    const child = await createMember(fixture.libraryId);
    await givePhotoTo(child.id);

    await actingAs(librarian.id);
    await removeMemberPhoto(child.id, "duplicate upload");

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.MEMBER_PHOTO_REMOVED, entityId: child.id },
    });

    expect(entry.actorUserId).toBe(librarian.id);
    expect(JSON.stringify(entry.metadata)).toContain("duplicate upload");
    expect(JSON.stringify(entry.metadata)).not.toContain("child_photo/");
  });

  it("refuses a member who does not hold the permission", async () => {
    const child = await createMember(fixture.libraryId);
    await givePhotoTo(child.id);
    const other = await createMember(fixture.libraryId);

    await actingAs(other.id, "MEMBER");
    await expect(removeMemberPhoto(child.id)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
  });

  it("keeps the row when the object store refuses, so nothing is orphaned", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    storageDriver.failNextDelete = true;

    await actingAs(librarian.id);
    await removeMemberPhoto(child.id, "storage will misbehave");

    // The profile no longer points at it, but the ledger row survives with a
    // deletion deadline — which is what lets the sweeper finish the job.
    const media = await db.mediaObject.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.pendingDeletionAt).not.toBeNull();
    expect(media.deleteAttempts).toBe(1);

    await sweepPendingMedia();
    expect(await db.mediaObject.count({ where: { id: mediaId } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("replacement", () => {
  it("points the profile at the new object and removes the old one", async () => {
    const child = await createMember(fixture.libraryId);
    const oldMediaId = await givePhotoTo(child.id);

    await actingAs(librarian.id);
    const { mediaId: newMediaId } = await replaceMemberPhoto({
      // A different size from the first, so this is visibly a second file --
      // and inside the band, which a child's photograph now has.
      memberUserId: child.id,
      bytes: pngBytes(200 * 1024),
    });

    expect(newMediaId).not.toBe(oldMediaId);

    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: child.id } });
    expect(profile.photoMediaId).toBe(newMediaId);

    // Old row and old bytes both gone; exactly one object left behind.
    expect(await db.mediaObject.count({ where: { id: oldMediaId } })).toBe(0);
    expect(storageDriver.objects.size).toBe(1);
  });

  it("leaves the existing photo untouched when the new one is invalid", async () => {
    const child = await createMember(fixture.libraryId);
    const oldMediaId = await givePhotoTo(child.id);

    await actingAs(librarian.id);
    await expect(
      replaceMemberPhoto({ memberUserId: child.id, bytes: elfBytes() }),
    ).rejects.toThrow();

    const profile = await db.memberProfile.findUniqueOrThrow({ where: { userId: child.id } });
    expect(profile.photoMediaId).toBe(oldMediaId);
  });

  it("refuses to reach a staff account through the member photo service", async () => {
    const colleague = await createStaff(fixture.libraryId, "SUPER_ADMIN");

    await actingAs(librarian.id);
    await expect(
      replaceMemberPhoto({ memberUserId: colleague.id, bytes: pngBytes() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------

describe("the sweeper", () => {
  // Earlier tests deliberately leave scheduled objects behind. Clearing them
  // first is what lets these assert on exact counts rather than "at least".
  beforeEach(async () => {
    await sweepPendingMedia();
    await db.mediaObject.deleteMany({ where: { pendingDeletionAt: { not: null } } });
  });

  it("collects an upload that nobody ever claimed", async () => {
    const stored = await storeChildPhoto({ libraryId: fixture.libraryId, bytes: pngBytes() });

    // A parent who abandoned the form. Wind the deadline back rather than wait.
    await db.mediaObject.update({
      where: { id: stored.mediaId },
      data: { pendingDeletionAt: new Date(Date.now() - 60_000) },
    });

    const result = await sweepPendingMedia();

    expect(result.purged).toBe(1);
    expect(await db.mediaObject.count({ where: { id: stored.mediaId } })).toBe(0);
    expect(storageDriver.objects.size).toBe(0);
  });

  it("leaves a claimed upload alone", async () => {
    const child = await createMember(fixture.libraryId);
    const mediaId = await givePhotoTo(child.id);

    const result = await sweepPendingMedia();

    expect(result.purged).toBe(0);
    expect(await db.mediaObject.count({ where: { id: mediaId } })).toBe(1);
  });

  it("gives up loudly rather than retrying a broken object forever", async () => {
    const stored = await storeChildPhoto({ libraryId: fixture.libraryId, bytes: pngBytes() });
    await db.mediaObject.update({
      where: { id: stored.mediaId },
      data: { pendingDeletionAt: new Date(Date.now() - 60_000), deleteAttempts: 5 },
    });

    const result = await sweepPendingMedia();

    expect(result.purged).toBe(0);
    expect(result.needsAttention).toBe(1);
  });
});
