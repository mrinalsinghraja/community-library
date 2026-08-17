import "server-only";

import type { MediaObject, Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { requireActor, requirePermission, type Actor } from "@/server/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { storage } from "@/server/lib/storage";
import { UPLOAD_PURPOSES, validateUpload } from "@/server/lib/uploads";

/**
 * Child photographs.
 *
 * The most sensitive bytes this system will ever hold. Three rules shape
 * everything below:
 *
 *   1. **Nothing is served without an authorization decision.** There is no
 *      public URL, no signed URL, no static path. Every read goes through
 *      /api/media/[id], which asks this module.
 *   2. **The database row is the ledger, the bytes follow it.** A transaction
 *      and an object-store write cannot be atomic, so no code path tries to
 *      pretend. `pendingDeletionAt` makes every object either claimed or
 *      scheduled for removal; nothing is ever merely forgotten.
 *   3. **A photograph is never the expected choice.** Avatars are equal
 *      citizens, and the default is an avatar, not a blank frame.
 *
 * Consent for storing a photograph is a separate record from consent for the
 * account (`CHILD_PHOTO_STORAGE`), so a family can withdraw the photo without
 * withdrawing the membership.
 */

/**
 * How long an uploaded object may sit unclaimed.
 *
 * A parent uploads a picture, then abandons the form. Fifteen minutes is longer
 * than any realistic submission and short enough that a private photograph of a
 * child does not linger in storage attached to nothing.
 */
const UNCLAIMED_UPLOAD_MINUTES = 15;

/** How many times the sweeper retries a stubborn object before it needs a human. */
export const MAX_DELETE_ATTEMPTS = 5;

type Db = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface StoredPhoto {
  mediaId: string;
  byteSize: number;
  mimeType: string;
}

/**
 * Validates and stores a child photograph, unclaimed.
 *
 * Called from the public registration flow, so it takes no actor. That is safe
 * because it grants nothing: the object is private, its id is returned only to
 * the caller that produced the bytes, and if the surrounding registration never
 * completes, the sweeper removes it. The public form's own rate limit is the
 * abuse control.
 *
 * The bytes hit storage BEFORE the row exists, deliberately. A storage failure
 * then leaves no row at all, which is the cheaper of the two inconsistent
 * states — the alternative is a row whose bytes were never written, which every
 * later read would have to defend against.
 */
export async function storeChildPhoto(params: {
  libraryId: string;
  bytes: Uint8Array;
  declaredMimeType?: string;
  originalFilename?: string;
  uploadedById?: string | null;
}): Promise<StoredPhoto> {
  const validated = validateUpload({
    bytes: params.bytes,
    purpose: UPLOAD_PURPOSES.CHILD_PHOTO,
    declaredMimeType: params.declaredMimeType,
    originalFilename: params.originalFilename,
  });

  // validated.bytes, NOT params.bytes: the caller's array still carries the
  // EXIF that validateUpload stripped, GPS coordinates and all.
  const stored = await storage().put(
    validated.storageKey,
    validated.bytes,
    validated.mimeType,
    validated.visibility,
  );

  const media = await prisma.mediaObject.create({
    data: {
      libraryId: params.libraryId,
      visibility: "PRIVATE",
      storageKey: stored.storageKey,
      // Never, for a child photograph — the CHECK constraint agrees.
      publicUrl: null,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      checksumSha256: validated.checksumSha256,
      purpose: validated.purpose,
      uploadedById: params.uploadedById ?? null,
      // Born with a deadline. Whatever claims it clears this.
      pendingDeletionAt: new Date(Date.now() + UNCLAIMED_UPLOAD_MINUTES * 60_000),
    },
    select: { id: true, byteSize: true, mimeType: true },
  });

  return { mediaId: media.id, byteSize: media.byteSize, mimeType: media.mimeType };
}

/**
 * Marks an object as claimed. MUST be called inside the same transaction as the
 * insert that links to it, so that "linked" and "kept" commit together.
 */
export async function claimMedia(db: Db, mediaId: string): Promise<void> {
  await db.mediaObject.update({
    where: { id: mediaId },
    data: { pendingDeletionAt: null },
  });
}

/**
 * Claims a freshly uploaded child photograph, and refuses anything else.
 *
 * This is the guard against the obvious attack on the public registration flow:
 * post a registration carrying somebody else's media id, and have another
 * child's photograph appear on your form — or, worse, be moved onto the account
 * the approval creates.
 *
 * An id is acceptable only if it is in this library, private, actually a child
 * photograph, and still unclaimed. An object that some profile or request
 * already owns has a null `pendingDeletionAt` and therefore fails the atomic
 * update below: exactly one caller can ever claim a given object.
 */
export async function claimUnclaimedChildPhoto(
  db: Db,
  params: { mediaId: string; libraryId: string },
): Promise<void> {
  const { count } = await db.mediaObject.updateMany({
    where: {
      id: params.mediaId,
      libraryId: params.libraryId,
      visibility: "PRIVATE",
      purpose: UPLOAD_PURPOSES.CHILD_PHOTO,
      // Unclaimed. Anything already owned by a profile or a request is not.
      pendingDeletionAt: { not: null },
    },
    data: { pendingDeletionAt: null },
  });

  if (count !== 1) {
    throw new ValidationError(
      { photo: "That picture could not be attached. Please choose it again." },
      `Refused to claim media ${params.mediaId}: not an unclaimed child photo in library ${params.libraryId}`,
    );
  }
}

/**
 * Schedules an object for removal from inside a transaction.
 *
 * Does not touch storage: that happens after the commit, so a rolled-back
 * transaction cannot leave a live row pointing at bytes that are already gone.
 */
export async function scheduleMediaDeletion(db: Db, mediaId: string): Promise<void> {
  await db.mediaObject.update({
    where: { id: mediaId },
    data: { pendingDeletionAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Reading — the authorization decision
// ---------------------------------------------------------------------------

export interface AuthorizedMedia {
  bytes: Uint8Array;
  mimeType: string;
  byteSize: number;
}

/**
 * Resolves a media id to bytes the current viewer is allowed to see.
 *
 * Every refusal is `NotFoundError`, never `NotAuthorized`. A child walking ids
 * must not be able to tell a photograph that exists and belongs to someone else
 * from one that was never uploaded — a 403 answers "yes, that id is real".
 *
 * Who may see a child's photograph:
 *
 *   * the child themselves. They chose the picture and it is of them; hiding it
 *     from its own subject would be strange to a nine-year-old and protects
 *     nobody. It appears on their own library card and nowhere else.
 *   * staff holding `member.view` — the desk needs to recognise the reader in
 *     front of them.
 *   * staff holding `registration.view`, for a photo still attached to a pending
 *     request, because that is the screen where the decision is made.
 *
 * Nobody else. Not another child, not a signed-out visitor, not a member with a
 * borrowed link, not the public catalogue.
 */
export async function getAuthorizedMedia(mediaId: string): Promise<AuthorizedMedia> {
  // Signed in first. An unauthenticated caller learns nothing at all.
  const actor = await requireActor();

  const media = await prisma.mediaObject.findFirst({
    where: { id: mediaId, libraryId: actor.libraryId },
    select: {
      id: true,
      visibility: true,
      storageKey: true,
      mimeType: true,
      byteSize: true,
      purpose: true,
      pendingDeletionAt: true,
      memberProfile: { select: { userId: true } },
      registrationRequests: { select: { id: true, status: true } },
    },
  });

  if (!media) throw new NotFoundError(`Media ${mediaId} not found in library ${actor.libraryId}`);

  // An object already scheduled for deletion is gone as far as readers are
  // concerned, whether or not the sweeper has caught up with the bytes.
  if (media.pendingDeletionAt) {
    throw new NotFoundError(`Media ${mediaId} is pending deletion`);
  }

  if (media.visibility === "PUBLIC") {
    return readBytes(media);
  }

  const isOwnPhoto = media.memberProfile?.userId === actor.userId;
  const isStaffWithMemberView = media.memberProfile && actor.permissions.has("member.view");
  const isStaffReviewingRequest =
    media.registrationRequests.length > 0 && actor.permissions.has("registration.view");

  if (!isOwnPhoto && !isStaffWithMemberView && !isStaffReviewingRequest) {
    throw new NotFoundError(
      `User ${actor.userId} may not read media ${mediaId} (purpose ${media.purpose})`,
    );
  }

  return readBytes(media);
}

async function readBytes(media: {
  storageKey: string;
  mimeType: string;
  byteSize: number;
}): Promise<AuthorizedMedia> {
  const bytes = await storage().get(media.storageKey);
  if (!bytes) {
    // The row outlived its bytes. Treated as missing, and worth seeing in logs
    // because rule 2 above says it should not happen.
    console.error(`Media row present but object missing for key ${media.storageKey}`);
    throw new NotFoundError(`Object missing for storage key ${media.storageKey}`);
  }
  return { bytes, mimeType: media.mimeType, byteSize: media.byteSize };
}

// ---------------------------------------------------------------------------
// Staff management: replace and remove
// ---------------------------------------------------------------------------

async function loadMemberForPhoto(actor: Actor, memberUserId: string) {
  const user = await prisma.appUser.findFirst({
    where: { id: memberUserId, libraryId: actor.libraryId },
    select: {
      id: true,
      kind: true,
      displayName: true,
      memberProfile: { select: { userId: true, photoMediaId: true, avatarKey: true } },
    },
  });

  if (!user || !user.memberProfile) {
    throw new NotFoundError(`Member ${memberUserId} not found in library ${actor.libraryId}`);
  }

  // Same guard as the account service: a member-scoped permission must not
  // reach a staff account.
  if (user.kind === "STAFF") {
    throw new NotFoundError(`Refusing to manage STAFF user ${memberUserId} through media service`);
  }

  return user;
}

/**
 * Removes a child's photograph.
 *
 * The avatar comes back automatically — a card without a picture would make the
 * removal feel like a punishment. `getAvatar()` already falls back to the
 * default for a null key, so clearing the photo is enough; the stored avatar
 * choice, if any, is preserved untouched.
 */
export async function removeMemberPhoto(memberUserId: string, reason?: string): Promise<void> {
  const actor = await requirePermission("member.manage_photo");
  const member = await loadMemberForPhoto(actor, memberUserId);

  const currentPhotoId = member.memberProfile!.photoMediaId;
  if (!currentPhotoId) return; // Already the desired end state.

  await prisma.$transaction(async (tx) => {
    await tx.memberProfile.update({
      where: { userId: member.id },
      data: { photoMediaId: null },
    });

    await scheduleMediaDeletion(tx, currentPhotoId);

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.MEMBER_PHOTO_REMOVED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // The id of the object, never its key or its bytes.
      metadata: { mediaId: currentPhotoId, reason: reason?.trim() || undefined },
    });
  });

  // Bytes go now; the sweeper is the safety net if this fails.
  await purgeScheduledMedia(currentPhotoId);
}

/**
 * Replaces a child's photograph.
 *
 * Transactional from the application's point of view: the profile points at the
 * new object and the old one is scheduled for deletion in a single commit.
 * Either both happened or neither did. Only the object-store cleanup is
 * eventual, and it can only ever run late — never early, and never on an object
 * something still points at.
 */
export async function replaceMemberPhoto(params: {
  memberUserId: string;
  bytes: Uint8Array;
  declaredMimeType?: string;
  originalFilename?: string;
}): Promise<{ mediaId: string }> {
  const actor = await requirePermission("member.manage_photo");
  const member = await loadMemberForPhoto(actor, params.memberUserId);
  const previousPhotoId = member.memberProfile!.photoMediaId;

  // Validate and store the new bytes first. If this throws, nothing has changed
  // and the child keeps the picture they had.
  const stored = await storeChildPhoto({
    libraryId: actor.libraryId,
    bytes: params.bytes,
    declaredMimeType: params.declaredMimeType,
    originalFilename: params.originalFilename,
    uploadedById: actor.userId,
  });

  // If this transaction fails, the new object is simply never claimed: it keeps
  // the unclaimed deadline it was born with and the sweeper collects it. That is
  // why there is no compensating cleanup here to get wrong.
  await prisma.$transaction(async (tx) => {
    await tx.memberProfile.update({
      where: { userId: member.id },
      data: { photoMediaId: stored.mediaId },
    });

    await claimMedia(tx, stored.mediaId);
    if (previousPhotoId) await scheduleMediaDeletion(tx, previousPhotoId);

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.MEMBER_PHOTO_REPLACED,
      entityType: "app_user",
      entityId: member.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        mediaId: stored.mediaId,
        previousMediaId: previousPhotoId ?? null,
        byteSize: stored.byteSize,
      },
    });
  });

  if (previousPhotoId) await purgeScheduledMedia(previousPhotoId);

  return { mediaId: stored.mediaId };
}

// ---------------------------------------------------------------------------
// The sweeper
// ---------------------------------------------------------------------------

/**
 * Deletes one scheduled object's bytes and then its row, in that order.
 *
 * Order matters: row-last means a failure halfway leaves a row still pointing at
 * possibly-deleted bytes — visible, retryable, and refused by
 * `getAuthorizedMedia` because it is pending deletion. Row-first would leave
 * bytes nothing knows about, which is the state this whole design exists to
 * prevent.
 *
 * Never throws. Called on the success path of user-facing actions, where a flaky
 * object store must not turn "photo removed" into an error page.
 */
export async function purgeScheduledMedia(mediaId: string): Promise<boolean> {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    select: { id: true, storageKey: true, pendingDeletionAt: true },
  });

  // Refuses to delete anything that is not scheduled. This is the guard that
  // makes a mistaken call harmless.
  if (!media || !media.pendingDeletionAt) return false;

  try {
    await storage().delete(media.storageKey);
    await prisma.mediaObject.delete({ where: { id: media.id } });
    return true;
  } catch (error) {
    await prisma.mediaObject
      .update({
        where: { id: media.id },
        data: { deleteAttempts: { increment: 1 } },
      })
      .catch(() => undefined);
    console.error(`Failed to purge media ${mediaId}:`, error);
    return false;
  }
}

export interface MediaSweepResult {
  purged: number;
  failed: number;
  needsAttention: number;
}

/**
 * Daily reconciliation.
 *
 * Collects unclaimed uploads whose deadline has passed and any object whose
 * immediate purge failed. This is the reason no code path anywhere has to be
 * perfectly atomic across the two stores.
 */
export async function sweepPendingMedia(limit = 200): Promise<MediaSweepResult> {
  const due = await prisma.mediaObject.findMany({
    where: {
      pendingDeletionAt: { lte: new Date() },
      deleteAttempts: { lt: MAX_DELETE_ATTEMPTS },
    },
    orderBy: { pendingDeletionAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let purged = 0;
  let failed = 0;
  for (const media of due) {
    if (await purgeScheduledMedia(media.id)) purged += 1;
    else failed += 1;
  }

  // Objects the sweeper has given up on. Surfaced in the maintenance result so
  // that a permanently broken storage key is visible rather than silently
  // retried forever.
  const needsAttention = await prisma.mediaObject.count({
    where: {
      pendingDeletionAt: { not: null },
      deleteAttempts: { gte: MAX_DELETE_ATTEMPTS },
    },
  });

  return { purged, failed, needsAttention };
}

/** Test seam: the unclaimed window, exported so tests need not wait 15 minutes. */
export const __UNCLAIMED_UPLOAD_MINUTES = UNCLAIMED_UPLOAD_MINUTES;

export type { MediaObject };
