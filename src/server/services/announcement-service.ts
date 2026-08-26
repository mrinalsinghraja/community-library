import "server-only";

import {
  BOARD_MESSAGES,
  NOTICE_BODY_MAX_LENGTH,
  NOTICE_TITLE_MAX_LENGTH,
  lineForDate,
  type BoardNotice,
} from "@/lib/message-board";
import { todayInTimezone, toIsoDate } from "@/lib/visits";
import { requireActor, requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { getBranding, getCurrentLibrary } from "@/server/lib/settings";

/**
 * The notice board.
 *
 * One notice is live at a time, by design. A board that stacked five posts
 * would be a feed, and a feed on a child's page is a thing to scroll rather
 * than a thing to read — posting a new notice therefore replaces the last one
 * rather than queueing behind it.
 *
 * Posting is Super Admin only (`announcement.manage`). Reading needs a session
 * and nothing else: this is the library talking to its own families.
 *
 * Withdrawn notices keep their rows. "What did the library tell everybody, and
 * when" has to stay answerable after the notice has come down, which is also
 * why the audit row carries the heading.
 */

export interface StaffNotice {
  id: string;
  title: string;
  body: string;
  postedAt: Date;
  live: boolean;
}

/**
 * What a reader's card shows right now.
 *
 * Never null. The standing greeting is a real state and not a fallback for a
 * missing one — see the note in `src/lib/message-board.ts` for why an empty
 * card would be the worse failure.
 */
export async function currentNotice(now: Date = new Date()): Promise<BoardNotice> {
  await requireActor();
  const { library, settings } = await getCurrentLibrary();

  const live = await prisma.announcement.findFirst({
    where: {
      libraryId: library.id,
      publishedAt: { not: null, lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      audience: { in: ["ALL", "MEMBERS"] },
    },
    orderBy: { publishedAt: "desc" },
    select: { title: true, bodyMarkdown: true },
  });

  if (live) {
    return { special: true, title: live.title, body: live.bodyMarkdown };
  }

  const branding = await getBranding();
  const today = toIsoDate(todayInTimezone(settings.timezone, now));

  return {
    special: false,
    // The library's own greeting, which an administrator can already edit on
    // the branding screen. Writing a second welcome here would give the library
    // two, and they would drift.
    title: branding.welcomeMessage,
    body: lineForDate(today),
  };
}

/** The board's history, newest first. Super Admin only, like posting. */
export async function listNotices(): Promise<StaffNotice[]> {
  const actor = await requirePermission("announcement.manage");

  const rows = await prisma.announcement.findMany({
    where: { libraryId: actor.libraryId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      title: true,
      bodyMarkdown: true,
      publishedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const now = Date.now();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.bodyMarkdown,
    postedAt: row.publishedAt ?? row.createdAt,
    live:
      row.publishedAt !== null &&
      row.publishedAt.getTime() <= now &&
      (row.expiresAt === null || row.expiresAt.getTime() > now),
  }));
}

/**
 * Post a notice. It is live the moment this returns.
 *
 * The previous live notice is withdrawn in the same transaction, so there is no
 * instant in which two notices are up and no instant in which none is — a
 * reader loading the page mid-post sees one board or the other, never a blank.
 */
export async function postNotice(input: { title: string; body: string }): Promise<void> {
  const actor = await requirePermission("announcement.manage");

  const title = input.title.trim();
  const body = input.body.trim();

  const errors: Record<string, string> = {};
  if (title.length === 0) errors.title = BOARD_MESSAGES.needTitle;
  if (body.length === 0) errors.body = BOARD_MESSAGES.needBody;
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.announcement.updateMany({
      where: { libraryId: actor.libraryId, publishedAt: { not: null }, expiresAt: null },
      data: { expiresAt: now },
    });

    await tx.announcement.create({
      data: {
        libraryId: actor.libraryId,
        title: title.slice(0, NOTICE_TITLE_MAX_LENGTH),
        bodyMarkdown: body.slice(0, NOTICE_BODY_MAX_LENGTH),
        // MEMBERS, not ALL. The board is a reader's own page; a notice written
        // for families has no business appearing on a public page where the
        // library cannot see who is reading it.
        audience: "MEMBERS",
        publishedAt: now,
        createdById: actor.userId,
      },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_POSTED,
      entityType: "announcement",
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { title: title.slice(0, NOTICE_TITLE_MAX_LENGTH) },
    });
  });
}

/** Take the live notice down. Readers see the standing greeting again. */
export async function withdrawNotice(noticeId: string): Promise<void> {
  const actor = await requirePermission("announcement.manage");

  const notice = await prisma.announcement.findFirst({
    where: { id: noticeId, libraryId: actor.libraryId },
    select: { id: true, title: true },
  });
  if (!notice) throw new NotFoundError(`Announcement ${noticeId} not found in this library`);

  await prisma.announcement.update({
    where: { id: notice.id },
    data: { expiresAt: new Date() },
  });

  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.ANNOUNCEMENT_WITHDRAWN,
    entityType: "announcement",
    entityId: notice.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: { title: notice.title },
  });
}
