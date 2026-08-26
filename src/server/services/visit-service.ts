import "server-only";

import type { VisitSlotStatus } from "@prisma/client";

import {
  CANCEL_REASON_MAX_LENGTH,
  MAX_SLOTS_PER_SUBMISSION,
  SLOT_NOTE_MAX_LENGTH,
  VISIT_DESK_MESSAGES,
  VISIT_HORIZON_DAYS,
  addDays,
  fromIsoDate,
  isOfferedMinute,
  todayInTimezone,
  toIsoDate,
  weekWindow,
} from "@/lib/visits";
import { requireActor, requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";

/**
 * When the library room is open, and who says so.
 *
 * The rules this file enforces, all of them on the server and none of them in a
 * form:
 *
 *   * `visit.manage` puts times up. Librarian and Super Admin hold it.
 *   * `visit.cancel` takes one down once readers have seen it. Super Admin
 *     alone. Adding a time is an offer; cancelling one breaks an offer a family
 *     may have arranged a Saturday around.
 *   * A slot is never deleted. Cancelling flips a status and keeps the row, so
 *     a child who read "Saturday at four" finds that same Saturday crossed out
 *     rather than finding nothing and turning up at a locked door.
 *   * Readers read. `listVisitWeek` requires a session and takes no library id,
 *     no member id and nothing else from the caller except which week.
 *
 * Dates are calendar dates throughout — see the note at the top of
 * `src/lib/visits.ts` for why this feature holds no instants at all.
 */

export interface VisitSlotView {
  id: string;
  /** `YYYY-MM-DD`, the library's own calendar. */
  date: string;
  startMinute: number;
  endMinute: number;
  status: VisitSlotStatus;
  note: string | null;
  /** Only ever set on a cancelled slot, and shown to readers as written. */
  cancelledReason: string | null;
}

export interface VisitWeekView {
  offset: number;
  label: string;
  /** `YYYY-MM-DD` for Monday and Sunday of the week being shown. */
  from: string;
  to: string;
  /** Today, so the card can mark it without asking the browser's clock. */
  today: string;
  slots: VisitSlotView[];
  /** False when this library has never had a single slot. Changes the copy. */
  everScheduled: boolean;
  /** True while there is at least one later week worth paging to. */
  hasNext: boolean;
}

function toView(row: {
  id: string;
  slotDate: Date;
  startMinute: number;
  endMinute: number;
  status: VisitSlotStatus;
  note: string | null;
  cancelledReason: string | null;
}): VisitSlotView {
  return {
    id: row.id,
    date: toIsoDate(row.slotDate),
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    status: row.status,
    note: row.note,
    cancelledReason: row.cancelledReason,
  };
}

const SLOT_ORDER = [{ slotDate: "asc" }, { startMinute: "asc" }] as const;

/**
 * One week of visiting times, for the reader who is signed in.
 *
 * Cancelled slots are returned, not filtered out. That is the whole design: a
 * card that simply stopped showing a cancelled Saturday would be indisting-
 * uishable from a card that had never had one, and a family who had already
 * read it would learn nothing.
 */
export async function listVisitWeek(offset = 0): Promise<VisitWeekView> {
  await requireActor();
  const { library, settings } = await getCurrentLibrary();

  const today = todayInTimezone(settings.timezone);
  const week = weekWindow(offset, today);

  const [rows, everScheduled, later] = await Promise.all([
    prisma.visitSlot.findMany({
      where: { libraryId: library.id, slotDate: { gte: week.from, lte: week.to } },
      orderBy: [...SLOT_ORDER],
    }),
    prisma.visitSlot.count({ where: { libraryId: library.id } }),
    // "Is there anything further on?" rather than "how many weeks are there".
    // The arrow should stay live while the librarian's next Saturday is still
    // ahead, and go quiet when the reader has genuinely reached the end.
    prisma.visitSlot.count({
      where: { libraryId: library.id, slotDate: { gt: week.to }, status: "OPEN" },
    }),
  ]);

  return {
    offset: week.offset,
    label: week.label,
    from: toIsoDate(week.from),
    to: toIsoDate(week.to),
    today: toIsoDate(today),
    slots: rows.map(toView),
    everScheduled: everScheduled > 0,
    hasNext: later > 0,
  };
}

/**
 * Everything still ahead, for the desk.
 *
 * Past slots are not listed. A librarian setting up next month does not need a
 * scroll of every Saturday since the library opened, and the audit log is where
 * "what did we say in September" is answered.
 */
export async function listUpcomingVisitSlots(): Promise<{
  slots: VisitSlotView[];
  today: string;
  /** The last date a slot may be put on, so the form's dropdown agrees. */
  lastSchedulable: string;
}> {
  await requirePermission("visit.manage");
  const { library, settings } = await getCurrentLibrary();

  const today = todayInTimezone(settings.timezone);
  const rows = await prisma.visitSlot.findMany({
    where: { libraryId: library.id, slotDate: { gte: today } },
    orderBy: [...SLOT_ORDER],
  });

  return {
    slots: rows.map(toView),
    today: toIsoDate(today),
    lastSchedulable: toIsoDate(addDays(today, VISIT_HORIZON_DAYS - 1)),
  };
}

export interface CreateVisitSlotsInput {
  /**
   * `"once"` puts one time on one date. `"weekly"` puts the same time on every
   * matching weekday between two dates — which is what a library that opens
   * every Saturday actually wants, and the reason this takes a range at all.
   */
  repeat: "once" | "weekly";
  /** Required for `weekly`. `Date.getUTCDay()` numbering, 0 is Sunday. */
  weekday?: number;
  /** For `once` this is the date; for `weekly` it starts the range. */
  fromDate: string;
  /** Required for `weekly`. */
  toDate?: string;
  startMinute: number;
  endMinute: number;
  note?: string;
}

/**
 * Put times up.
 *
 * Returns how many rows were actually new. Re-submitting the same Saturdays is
 * a no-op rather than a duplicate — the unique key does the work, and the count
 * is what the desk is told, so "nothing new to add" is a real answer rather
 * than a silent success.
 */
export async function createVisitSlots(input: CreateVisitSlotsInput): Promise<{ created: number }> {
  const actor = await requirePermission("visit.manage");
  const { settings } = await getCurrentLibrary();

  const errors: Record<string, string> = {};

  if (!isOfferedMinute(input.startMinute) || !isOfferedMinute(input.endMinute)) {
    errors.startMinute = VISIT_DESK_MESSAGES.badTime;
  } else if (input.endMinute <= input.startMinute) {
    errors.endMinute = VISIT_DESK_MESSAGES.endBeforeStart;
  }

  const today = todayInTimezone(settings.timezone);
  const lastAllowed = addDays(today, VISIT_HORIZON_DAYS - 1);

  const from = fromIsoDate(input.fromDate);
  if (!from) {
    errors.fromDate = VISIT_DESK_MESSAGES.needDate;
  } else if (from.getTime() < today.getTime()) {
    errors.fromDate = VISIT_DESK_MESSAGES.pastDate;
  } else if (from.getTime() > lastAllowed.getTime()) {
    errors.fromDate = VISIT_DESK_MESSAGES.beyondHorizon;
  }

  let to = from;
  if (input.repeat === "weekly") {
    if (input.weekday === undefined || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) {
      errors.weekday = VISIT_DESK_MESSAGES.needDay;
    }
    to = input.toDate ? fromIsoDate(input.toDate) : null;
    if (!to) {
      errors.toDate = VISIT_DESK_MESSAGES.needDate;
    } else if (from && to.getTime() < from.getTime()) {
      errors.toDate = VISIT_DESK_MESSAGES.needRange;
    } else if (to.getTime() > lastAllowed.getTime()) {
      errors.toDate = VISIT_DESK_MESSAGES.beyondHorizon;
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (!from || !to) throw new ValidationError({ fromDate: VISIT_DESK_MESSAGES.needDate });

  const dates: Date[] = [];
  if (input.repeat === "once") {
    dates.push(from);
  } else {
    for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = addDays(cursor, 1)) {
      if (cursor.getUTCDay() === input.weekday) dates.push(cursor);
    }
  }

  if (dates.length === 0) {
    throw new ValidationError({ weekday: "No dates in that stretch fall on that day." });
  }
  if (dates.length > MAX_SLOTS_PER_SUBMISSION) {
    throw new ValidationError({ toDate: VISIT_DESK_MESSAGES.tooMany });
  }

  const note = input.note?.trim().slice(0, SLOT_NOTE_MAX_LENGTH) || null;

  // `skipDuplicates`, so putting up "every Saturday" twice adds only the
  // Saturdays that were missing. A librarian correcting a range should not have
  // to work out which dates are already there.
  const result = await prisma.visitSlot.createMany({
    data: dates.map((date) => ({
      libraryId: actor.libraryId,
      slotDate: date,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      note,
      createdById: actor.userId,
    })),
    skipDuplicates: true,
  });

  if (result.count > 0) {
    await recordAudit(prisma, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.VISIT_SLOTS_CREATED,
      entityType: "visit_slot",
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        created: result.count,
        repeat: input.repeat,
        from: toIsoDate(from),
        to: toIsoDate(to),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
      },
    });
  }

  return { created: result.count };
}

/**
 * Call one off.
 *
 * Super Admin only, and the row survives. The reason is optional but is shown
 * to readers exactly as typed, so it is worth writing: "cancelled" answers
 * nothing, and a family reading "the room is being painted" knows the library
 * has not simply forgotten them.
 */
export async function cancelVisitSlot(slotId: string, reason: string): Promise<void> {
  const actor = await requirePermission("visit.cancel");

  const slot = await prisma.visitSlot.findFirst({
    where: { id: slotId, libraryId: actor.libraryId },
    select: { id: true, slotDate: true, startMinute: true, status: true },
  });
  if (!slot) throw new NotFoundError(`Visit slot ${slotId} not found in this library`);

  // Already cancelled is not an error. Two administrators pressing the same
  // button is not a failure, and a red message for it would suggest otherwise.
  if (slot.status === "CANCELLED") return;

  const trimmed = reason.trim().slice(0, CANCEL_REASON_MAX_LENGTH) || null;

  await prisma.visitSlot.update({
    where: { id: slot.id },
    data: {
      status: "CANCELLED",
      cancelledReason: trimmed,
      cancelledAt: new Date(),
      cancelledById: actor.userId,
    },
  });

  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.VISIT_SLOT_CANCELLED,
    entityType: "visit_slot",
    entityId: slot.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: {
      date: toIsoDate(slot.slotDate),
      startMinute: slot.startMinute,
      gaveReason: trimmed !== null,
    },
  });
}
