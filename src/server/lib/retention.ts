import "server-only";

import type { UserStatus } from "@prisma/client";

import { CLOSED_STATUSES } from "@/lib/account-lifecycle";
import {
  archivedDisplayName,
  daysBefore,
  monthsBefore,
  redactedEmail,
  REDACTED_APARTMENT,
  REDACTED_GUARDIAN_NAME,
  REDACTED_PHONE,
  retentionIsSet,
  type RetentionPolicy,
} from "@/lib/retention";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";

/**
 * The nightly pass that erases what the library has decided not to keep.
 *
 * This is the only destructive scheduled job in the application, so it is
 * written to be boring in every direction:
 *
 *   * **It does nothing until somebody decides.** Every period is nullable and
 *     starts null, and null means keep indefinitely. A library that never
 *     visits the settings screen never loses a row to this.
 *   * **It erases fields, never rows.** A loan is the library's own record of
 *     where a book went, and it survives with its dates intact — what stops
 *     existing is the name attached to it. `app_user` rows stay for the same
 *     reason: `loan.member_user_id` is `onDelete: Restrict`, and a deletion
 *     that took the ledger with it would be a worse answer than keeping it.
 *   * **It counts from the closure, not from the last visit.** The clock starts
 *     when a person decided this account was finished, which is the only date
 *     in the row that means anything to a family.
 *   * **Every step is audited with no actor**, exactly like the growing-up
 *     pass. "Why is my child's name gone?" has to be answerable afterwards, and
 *     the audit row is the only thing that can answer it.
 *
 * The photograph is handled separately and sooner than everything else. It is
 * the most sensitive thing the library holds and the least useful to its own
 * records, and there is no argument for keeping a child's face for as long as a
 * lending history.
 *
 * Order within a library matters and is not incidental: photographs first, then
 * readers, then guardians. A guardian becomes eligible only once the last child
 * of theirs is archived, so archiving readers before looking at guardians means
 * the guardian clock starts on the same night rather than the next one.
 */

export interface RetentionResult {
  /** Photographs deleted because the account closed long enough ago. */
  photosRemoved: number;
  /** Readers whose personal details were erased and who became ARCHIVED. */
  readersArchived: number;
  /** Guardians whose contact details were erased. */
  guardiansRedacted: number;
  /** True when no library has set any period at all — the normal state today. */
  policyUnset: boolean;
}

const EMPTY: RetentionResult = {
  photosRemoved: 0,
  readersArchived: 0,
  guardiansRedacted: 0,
  policyUnset: true,
};

/**
 * Statuses this pass may act on.
 *
 * An allowlist, for the reason spelled out in `@/lib/account-lifecycle`: a
 * denylist here would mean a status added next year is erased by default, which
 * is the one direction this job must never fail in. ARCHIVED is excluded
 * because it is where this pass sends people — including it would make the job
 * re-redact the same rows every night forever.
 */
const ERASABLE_STATUSES: readonly UserStatus[] = CLOSED_STATUSES.filter(
  (status) => status !== "ARCHIVED",
);

/** How many rows one night may touch, so a first run on a long backlog is not one huge transaction. */
const BATCH = 200;

export async function runRetentionPass(now: Date = new Date()): Promise<RetentionResult> {
  const libraries = await prisma.library.findMany({
    select: {
      id: true,
      settings: {
        select: {
          archiveClosedAfterMonths: true,
          removePhotoAfterClosedDays: true,
          removeGuardianAfterMonths: true,
        },
      },
    },
  });

  const result: RetentionResult = { ...EMPTY };

  for (const library of libraries) {
    if (!library.settings) continue;

    const policy: RetentionPolicy = library.settings;
    if (!retentionIsSet(policy)) continue;

    result.policyUnset = false;

    result.photosRemoved += await removeClosedReaderPhotos(library.id, policy, now);
    result.readersArchived += await archiveClosedReaders(library.id, policy, now);
    result.guardiansRedacted += await redactDepartedGuardians(library.id, policy, now);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

/**
 * Deletes the photographs of readers whose accounts closed long enough ago.
 *
 * Unlinks the profile and schedules the bytes, in one transaction, in that
 * order — the same shape every other removal in `media-service` uses. The
 * sweeper in the same nightly run deletes the object itself; if it fails the
 * row is still marked, so the bytes cannot be forgotten about.
 *
 * Does **not** archive the reader. A library may well want the face gone in a
 * month and the record kept for years, and folding the two together would make
 * that impossible to express.
 */
async function removeClosedReaderPhotos(
  libraryId: string,
  policy: RetentionPolicy,
  now: Date,
): Promise<number> {
  if (policy.removePhotoAfterClosedDays === null) return 0;

  const cutoff = daysBefore(now, policy.removePhotoAfterClosedDays);

  const due = await prisma.appUser.findMany({
    where: {
      libraryId,
      kind: "MEMBER",
      status: { in: [...ERASABLE_STATUSES] },
      statusChangedAt: { lt: cutoff },
      memberProfile: { photoMediaId: { not: null } },
    },
    take: BATCH,
    select: { id: true, memberProfile: { select: { photoMediaId: true } } },
  });

  let removed = 0;

  for (const reader of due) {
    const mediaId = reader.memberProfile?.photoMediaId;
    if (!mediaId) continue;

    await prisma.$transaction(async (tx) => {
      await tx.memberProfile.update({
        where: { userId: reader.id },
        data: { photoMediaId: null, avatarKey: null },
      });
      await tx.mediaObject.update({
        where: { id: mediaId },
        data: { pendingDeletionAt: now },
      });
      await recordAudit(tx, {
        libraryId,
        action: AUDIT_ACTIONS.RETENTION_PHOTO_REMOVED,
        entityType: "app_user",
        entityId: reader.id,
        actorUserId: null,
        actorLabel: "the library",
        // The media id and the period, never the storage key and never the
        // child's name — an audit row about erasing personal data must not be
        // the place the personal data survives.
        metadata: {
          mediaId,
          afterDays: policy.removePhotoAfterClosedDays,
          automatic: true,
        },
      });
    });

    removed += 1;
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/**
 * Erases a departed reader's personal details and moves them to ARCHIVED.
 *
 * What goes: name, email, username, password hash, the note explaining why the
 * account was closed, the flat, the avatar, any staff notes, and the photograph
 * if the shorter photo period has not already taken it.
 *
 * What stays: the member code, the birth year, and every loan. The code because
 * it is printed against each of those loans and a history attributed to
 * nothing is a history nobody can read; the birth year because the column is
 * required and a year on its own, with no name, no flat and no way to sign in,
 * identifies nobody. Whether that line is drawn in the right place is a
 * question for the lawyer this file's `docs` counterpart is waiting on — it is
 * documented rather than assumed.
 */
async function archiveClosedReaders(
  libraryId: string,
  policy: RetentionPolicy,
  now: Date,
): Promise<number> {
  if (policy.archiveClosedAfterMonths === null) return 0;

  const cutoff = monthsBefore(now, policy.archiveClosedAfterMonths);

  const due = await prisma.appUser.findMany({
    where: {
      libraryId,
      kind: "MEMBER",
      status: { in: [...ERASABLE_STATUSES] },
      statusChangedAt: { lt: cutoff },
    },
    take: BATCH,
    select: {
      id: true,
      status: true,
      memberProfile: { select: { memberCode: true, photoMediaId: true } },
    },
  });

  let archived = 0;

  for (const reader of due) {
    await prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: reader.id },
        data: {
          displayName: archivedDisplayName(reader.memberProfile?.memberCode),
          email: null,
          username: null,
          passwordHash: null,
          // The reason can name a sibling, a flat or a family. It has done its
          // job by now: the audit trail records who closed the account and why,
          // and that is where the explanation belongs.
          statusReason: null,
          status: "ARCHIVED",
          statusChangedAt: now,
          statusChangedById: null,
        },
      });

      if (reader.memberProfile) {
        await tx.memberProfile.update({
          where: { userId: reader.id },
          data: {
            apartment: REDACTED_APARTMENT,
            staffNotes: null,
            avatarKey: null,
            photoMediaId: null,
          },
        });

        if (reader.memberProfile.photoMediaId) {
          await tx.mediaObject.update({
            where: { id: reader.memberProfile.photoMediaId },
            data: { pendingDeletionAt: now },
          });
        }
      }

      // Anything that could still let somebody in. Closure revoked these
      // already; doing it again costs one statement and closes the gap where an
      // account was closed before that code existed.
      await tx.session.deleteMany({ where: { userId: reader.id } });
      await tx.authToken.deleteMany({ where: { userId: reader.id } });

      await recordAudit(tx, {
        libraryId,
        action: AUDIT_ACTIONS.RETENTION_READER_ARCHIVED,
        entityType: "app_user",
        entityId: reader.id,
        actorUserId: null,
        actorLabel: "the library",
        metadata: {
          previousStatus: reader.status,
          afterMonths: policy.archiveClosedAfterMonths,
          automatic: true,
        },
      });
    });

    archived += 1;
  }

  return archived;
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

/**
 * Erases a guardian's contact details once no child of theirs is a reader any
 * more.
 *
 * The eligibility test is about the children, not the guardian: every linked
 * child must be ARCHIVED, and the most recent of those archivals must be older
 * than the period. A parent whose younger child is still borrowing keeps their
 * details, however long ago the elder one left, because the library still needs
 * to be able to reach them.
 *
 * The `guardian` row itself survives with its links intact. `consent_record`
 * hangs off it and is the evidence that the library was ever allowed to hold
 * anything about that family — deleting the person while keeping the consent
 * would leave a consent nobody gave.
 */
async function redactDepartedGuardians(
  libraryId: string,
  policy: RetentionPolicy,
  now: Date,
): Promise<number> {
  if (policy.removeGuardianAfterMonths === null) return 0;

  const cutoff = monthsBefore(now, policy.removeGuardianAfterMonths);

  const candidates = await prisma.guardian.findMany({
    where: {
      libraryId,
      // Already redacted rows carry the reserved-TLD address, so this is what
      // stops the pass rewriting the same guardians every night.
      email: { not: { endsWith: "@removed.invalid" } },
      memberLinks: { some: {} },
      // Cheap pre-filter; the real test is below, because "every link" is not
      // something a `some` can express.
      NOT: { memberLinks: { some: { member: { status: { not: "ARCHIVED" } } } } },
    },
    take: BATCH,
    select: {
      id: true,
      memberLinks: { select: { member: { select: { statusChangedAt: true } } } },
    },
  });

  let redacted = 0;

  for (const guardian of candidates) {
    const archivedAt = guardian.memberLinks
      .map((link) => link.member.statusChangedAt?.getTime() ?? null)
      .filter((value): value is number => value !== null);

    // A child archived before this column was written has no date to count
    // from. Skip rather than guess: erasing on an assumed date is the one
    // mistake here that cannot be walked back.
    if (archivedAt.length !== guardian.memberLinks.length) continue;

    const lastArchived = Math.max(...archivedAt);
    if (lastArchived >= cutoff.getTime()) continue;

    await prisma.$transaction(async (tx) => {
      await tx.guardian.update({
        where: { id: guardian.id },
        data: {
          fullName: REDACTED_GUARDIAN_NAME,
          email: redactedEmail(guardian.id),
          phone: REDACTED_PHONE,
          apartment: REDACTED_APARTMENT,
        },
      });

      await recordAudit(tx, {
        libraryId,
        action: AUDIT_ACTIONS.RETENTION_GUARDIAN_REDACTED,
        entityType: "guardian",
        entityId: guardian.id,
        actorUserId: null,
        actorLabel: "the library",
        metadata: {
          afterMonths: policy.removeGuardianAfterMonths,
          children: guardian.memberLinks.length,
          automatic: true,
        },
      });
    });

    redacted += 1;
  }

  return redacted;
}

/**
 * What the pass would do if it ran now, without doing it.
 *
 * The settings screen shows these counts beside the three fields, so that
 * deciding a period is not a leap in the dark: a Super Admin typing "12" can
 * see that it would erase four readers tonight before they press save.
 */
export async function retentionDue(
  libraryId: string,
  policy: RetentionPolicy,
  now: Date = new Date(),
): Promise<{ photos: number; readers: number; guardians: number }> {
  const erasable = [...ERASABLE_STATUSES];

  const photos =
    policy.removePhotoAfterClosedDays === null
      ? 0
      : await prisma.appUser.count({
          where: {
            libraryId,
            kind: "MEMBER",
            status: { in: erasable },
            statusChangedAt: { lt: daysBefore(now, policy.removePhotoAfterClosedDays) },
            memberProfile: { photoMediaId: { not: null } },
          },
        });

  const readers =
    policy.archiveClosedAfterMonths === null
      ? 0
      : await prisma.appUser.count({
          where: {
            libraryId,
            kind: "MEMBER",
            status: { in: erasable },
            statusChangedAt: { lt: monthsBefore(now, policy.archiveClosedAfterMonths) },
          },
        });

  /*
   * Deliberately the cheap approximation of the guardian rule, not the exact
   * one: the per-child date test above needs the rows themselves. It can only
   * over-count, which for a preview is the right direction — it never promises
   * that fewer people will be erased than actually are.
   */
  const guardians =
    policy.removeGuardianAfterMonths === null
      ? 0
      : await prisma.guardian.count({
          where: {
            libraryId,
            email: { not: { endsWith: "@removed.invalid" } },
            memberLinks: { some: {} },
            NOT: { memberLinks: { some: { member: { status: { not: "ARCHIVED" } } } } },
          },
        });

  return { photos, readers, guardians };
}
