import "server-only";

import type { Prisma, ProfileChangeStatus } from "@prisma/client";

import { isClosed } from "@/lib/account-lifecycle";
import {
  CHANGEABLE_FIELDS,
  CHANGE_LIMITS,
  CHANGE_MESSAGES,
  collectChanges,
  normaliseChange,
  validateChanges,
  type ProposedChanges,
} from "@/lib/profile-changes";
import { requireActor, requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { revokeTokens } from "@/server/lib/tokens";

/**
 * A reader asking for their own details to be corrected.
 *
 * The single rule this file exists to enforce: **a submission writes nothing to
 * the account.** It stores a proposal. The values move onto the record in
 * `decideProfileChange`, and only when somebody holding `profile_change.review`
 * — the Super Admin alone — says so.
 *
 * That is what makes it safe to put the guardian's email address on a form a
 * nine-year-old can fill in. They cannot change where their password-reset link
 * goes; they can ask, and an adult who knows the family decides. Letting a
 * reader write that field directly fails quietly and badly: a mistyped address
 * locks the family out of recovery, and nobody finds out until the day they
 * need it.
 *
 * Ownership is from the session throughout. `submitProfileChange` and
 * `getOwnProfileChange` take no member id, so there is nothing in the request
 * for a curious reader to point at somebody else's account.
 */

export interface OwnProfileValues {
  displayName: string;
  apartment: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
}

export interface OwnProfileView {
  current: OwnProfileValues;
  /** The request waiting for the desk, if there is one. */
  pending: { id: string; proposed: ProposedChanges; note: string | null; createdAt: Date } | null;
  /** The last answer the desk gave, so a reader learns they were turned down. */
  lastDecision: {
    status: ProfileChangeStatus;
    proposed: ProposedChanges;
    decisionNote: string | null;
    decidedAt: Date | null;
  } | null;
}

function asProposed(value: Prisma.JsonValue): ProposedChanges {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};

  const output: ProposedChanges = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // Re-checked on the way out as well as on the way in. A field removed from
    // the allowlist after a request was stored must stop being rendered, not
    // keep appearing because it is already in the column.
    if (typeof raw === "string" && CHANGEABLE_FIELDS.some((field) => field.key === key)) {
      output[key] = raw;
    }
  }
  return output;
}

async function loadOwnValues(userId: string): Promise<OwnProfileValues | null> {
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      memberProfile: { select: { apartment: true } },
      guardianLinks: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: { guardian: { select: { fullName: true, email: true, phone: true } } },
      },
    },
  });

  if (!user?.memberProfile) return null;
  const guardian = user.guardianLinks[0]?.guardian;

  return {
    displayName: user.displayName,
    apartment: user.memberProfile.apartment,
    guardianName: guardian?.fullName ?? "",
    guardianEmail: guardian?.email ?? "",
    guardianPhone: guardian?.phone ?? "",
  };
}

/**
 * What the reader's own page shows: their details, and anything in flight.
 *
 * Returns null for staff, who have no library card and nothing to correct here.
 */
export async function getOwnProfile(): Promise<OwnProfileView | null> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return null;

  const current = await loadOwnValues(actor.userId);
  if (!current) return null;

  const [pending, lastDecision] = await Promise.all([
    prisma.profileChangeRequest.findFirst({
      where: { memberUserId: actor.userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, proposed: true, note: true, createdAt: true },
    }),
    prisma.profileChangeRequest.findFirst({
      where: { memberUserId: actor.userId, status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      select: { status: true, proposed: true, decisionNote: true, decidedAt: true },
    }),
  ]);

  return {
    current,
    pending: pending
      ? {
          id: pending.id,
          proposed: asProposed(pending.proposed),
          note: pending.note,
          createdAt: pending.createdAt,
        }
      : null,
    lastDecision: lastDecision
      ? {
          status: lastDecision.status,
          proposed: asProposed(lastDecision.proposed),
          decisionNote: lastDecision.decisionNote,
          decidedAt: lastDecision.decidedAt,
        }
      : null,
  };
}

/**
 * A reader submitting a correction. Writes a proposal and nothing else.
 *
 * One request at a time. A queue of five overlapping proposals from one child
 * is a thing the desk has to reconcile by hand, and the later ones would be
 * written against values the earlier ones had already changed.
 */
export async function submitProfileChange(
  submitted: Record<string, string | undefined>,
  note: string,
): Promise<{ fields: string[] }> {
  const actor = await requirePermission("profile.request_change");

  const user = await prisma.appUser.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { status: true, kind: true },
  });

  if (user.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} has no library card to correct`);
  }
  if (isClosed(user.status)) {
    throw new RuleViolationError(
      `Account ${actor.userId} is ${user.status}`,
      CHANGE_MESSAGES.closedAccount,
    );
  }

  const current = await loadOwnValues(actor.userId);
  if (!current) throw new NotFoundError(`Member profile missing for ${actor.userId}`);

  const changes = collectChanges(submitted, current as unknown as Record<string, string>);
  const normalised: ProposedChanges = {};
  for (const [key, value] of Object.entries(changes)) {
    normalised[key] = normaliseChange(key, value);
  }

  if (Object.keys(normalised).length === 0) {
    throw new ValidationError({ form: CHANGE_MESSAGES.nothingChanged });
  }

  const errors = validateChanges(normalised);
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const existing = await prisma.profileChangeRequest.count({
    where: { memberUserId: actor.userId, status: "PENDING" },
  });
  if (existing > 0) {
    throw new RuleViolationError(
      `Member ${actor.userId} already has a pending profile change`,
      CHANGE_MESSAGES.alreadyWaiting,
    );
  }

  const fields = Object.keys(normalised);

  await prisma.$transaction(async (tx) => {
    await tx.profileChangeRequest.create({
      data: {
        libraryId: actor.libraryId,
        memberUserId: actor.userId,
        proposed: normalised,
        note: note.trim().slice(0, CHANGE_LIMITS.noteMaxLength) || null,
      },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.PROFILE_CHANGE_REQUESTED,
      entityType: "profile_change_request",
      entityId: actor.userId,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // Field names only. The log must not become a second copy of the values.
      metadata: { fields },
    });
  });

  return { fields };
}

/** A reader taking back a request the desk has not answered yet. */
export async function withdrawOwnProfileChange(): Promise<void> {
  const actor = await requirePermission("profile.request_change");

  const pending = await prisma.profileChangeRequest.findFirst({
    where: { memberUserId: actor.userId, status: "PENDING" },
    select: { id: true },
  });
  if (!pending) return;

  await prisma.$transaction(async (tx) => {
    await tx.profileChangeRequest.update({
      where: { id: pending.id },
      data: { status: "WITHDRAWN", decidedAt: new Date() },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.PROFILE_CHANGE_WITHDRAWN,
      entityType: "profile_change_request",
      entityId: pending.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
    });
  });
}

// ---------------------------------------------------------------------------
// The desk's side
// ---------------------------------------------------------------------------

export interface StaffProfileChange {
  id: string;
  status: ProfileChangeStatus;
  memberUserId: string;
  memberName: string;
  memberCode: string | null;
  /** Field, what it is now, what the reader is asking for. */
  diff: { key: string; label: string; from: string; to: string; affectsRecovery: boolean }[];
  note: string | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/**
 * The queue, and what has recently been answered.
 *
 * Shows the current value beside the proposed one. A review screen that renders
 * only what was asked for makes the reviewer open another tab to find out what
 * it is replacing, and a reviewer who does that twenty times stops doing it.
 */
export async function listProfileChanges(): Promise<StaffProfileChange[]> {
  const actor = await requirePermission("profile_change.review");

  const rows = await prisma.profileChangeRequest.findMany({
    where: { libraryId: actor.libraryId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      status: true,
      proposed: true,
      note: true,
      decisionNote: true,
      createdAt: true,
      decidedAt: true,
      memberUserId: true,
      member: {
        select: {
          displayName: true,
          memberProfile: { select: { apartment: true, memberCode: true } },
          guardianLinks: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
            select: { guardian: { select: { fullName: true, email: true, phone: true } } },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const guardian = row.member.guardianLinks[0]?.guardian;
    const current: Record<string, string> = {
      displayName: row.member.displayName,
      apartment: row.member.memberProfile?.apartment ?? "",
      guardianName: guardian?.fullName ?? "",
      guardianEmail: guardian?.email ?? "",
      guardianPhone: guardian?.phone ?? "",
    };

    const proposed = asProposed(row.proposed);

    return {
      id: row.id,
      status: row.status,
      memberUserId: row.memberUserId,
      memberName: row.member.displayName,
      memberCode: row.member.memberProfile?.memberCode ?? null,
      diff: CHANGEABLE_FIELDS.filter((field) => field.key in proposed).map((field) => ({
        key: field.key,
        label: field.label,
        from: current[field.key] ?? "",
        to: proposed[field.key] as string,
        affectsRecovery: Boolean(field.affectsRecovery),
      })),
      note: row.note,
      decisionNote: row.decisionNote,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  });
}

/**
 * The Super Admin answering one request.
 *
 * Approval is where the values finally reach the record, in one transaction
 * across up to three tables. A rejection writes nothing except the answer and
 * requires a note, because a child told "no" and nothing else has been refused
 * by a machine.
 *
 * Approving a guardian email revokes that member's live activation and reset
 * tokens, exactly as the desk's own contact edit does. A link already in an
 * inbox points at the address that is being replaced, and it must not still
 * work after the address has moved.
 */
export async function decideProfileChange(
  requestId: string,
  approve: boolean,
  decisionNote: string,
): Promise<void> {
  const actor = await requirePermission("profile_change.review");

  const request = await prisma.profileChangeRequest.findFirst({
    where: { id: requestId, libraryId: actor.libraryId },
    select: {
      id: true,
      status: true,
      proposed: true,
      memberUserId: true,
      member: {
        select: {
          status: true,
          guardianLinks: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
            select: { guardianId: true },
          },
        },
      },
    },
  });
  if (!request) throw new NotFoundError(`Profile change ${requestId} not found`);

  if (request.status !== "PENDING") {
    throw new RuleViolationError(
      `Profile change ${requestId} is ${request.status}`,
      "Somebody has already answered this one.",
    );
  }

  const note = decisionNote.trim().slice(0, CHANGE_LIMITS.decisionNoteMaxLength);
  if (!approve && note.length === 0) {
    throw new ValidationError({ decisionNote: CHANGE_MESSAGES.needReason });
  }

  const proposed = asProposed(request.proposed);
  const errors = validateChanges(proposed);
  if (Object.keys(errors).length > 0) {
    // Re-validated at approval time, not only at submission. The rules can move
    // between a reader asking and the desk answering, and the record must never
    // receive a value the current rules would refuse.
    throw new ValidationError(errors);
  }

  const guardianId = request.member.guardianLinks[0]?.guardianId ?? null;
  const guardianFields = ["guardianName", "guardianEmail", "guardianPhone"];
  const touchesGuardian = guardianFields.some((key) => key in proposed);

  if (approve && touchesGuardian && !guardianId) {
    throw new RuleViolationError(
      `Member ${request.memberUserId} has no guardian to update`,
      "This reader has no grown-up on file, so those details cannot be changed here.",
    );
  }

  const emailChanged = approve && "guardianEmail" in proposed;

  await prisma.$transaction(async (tx) => {
    if (approve) {
      if ("displayName" in proposed) {
        await tx.appUser.update({
          where: { id: request.memberUserId },
          data: { displayName: proposed.displayName },
        });
      }

      if ("apartment" in proposed) {
        await tx.memberProfile.update({
          where: { userId: request.memberUserId },
          data: { apartment: proposed.apartment },
        });
      }

      if (touchesGuardian && guardianId) {
        await tx.guardian.update({
          where: { id: guardianId },
          data: {
            fullName: proposed.guardianName ?? undefined,
            email: proposed.guardianEmail?.toLowerCase() ?? undefined,
            phone: proposed.guardianPhone ?? undefined,
          },
        });
      }

      if (emailChanged) {
        await revokeTokens(tx, request.memberUserId, "PASSWORD_RESET");
        await revokeTokens(tx, request.memberUserId, "ACTIVATION");
      }
    }

    await tx.profileChangeRequest.update({
      where: { id: request.id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        decisionNote: note || null,
        decidedAt: new Date(),
        decidedById: actor.userId,
      },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: approve
        ? AUDIT_ACTIONS.PROFILE_CHANGE_APPROVED
        : AUDIT_ACTIONS.PROFILE_CHANGE_REJECTED,
      entityType: "profile_change_request",
      entityId: request.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { fields: Object.keys(proposed), emailChanged, memberUserId: request.memberUserId },
    });
  });
}

/** How many are waiting, for the desk navigation's badge. */
export async function countPendingProfileChanges(): Promise<number> {
  const actor = await requireActor();
  if (!actor.permissions.has("profile_change.review")) return 0;

  return prisma.profileChangeRequest.count({
    where: { libraryId: actor.libraryId, status: "PENDING" },
  });
}
