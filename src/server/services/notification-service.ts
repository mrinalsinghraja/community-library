import "server-only";

import { Prisma, type LoanNotificationKind, type UserStatus } from "@prisma/client";

import {
  memberMayBeReminded,
  normaliseReminderOffsets,
  notificationKindForOffset,
  offsetFromDueDate,
  reminderSentence,
  reminderSubject,
} from "@/lib/notifications";
import { prisma } from "@/server/db";
import { EmailService, TEMPLATE_IDS } from "@/server/lib/email";
import { getCurrentLibrary } from "@/server/lib/settings";

/**
 * The daily reminder pass.
 *
 * The library charges no fines and has no way to compel anybody. A polite note
 * to a parent is, quite literally, the entire mechanism by which books come
 * back — which is why this job's one hard requirement is that a family can
 * trust it. A reminder that arrives every single morning is not a reminder; it
 * is a thing people filter.
 *
 * Four properties, in order of how much they matter.
 *
 * **1. It never sends the same thing twice.** Every message is claimed in the
 * database before it is handed to a provider, and the claim is unique on
 * (loan, due date, occurrence). A second run the same day finds the occurrence
 * taken. Two runs at the same instant race for one row and one of them loses.
 *
 * **2. It cannot change anything about a loan.** This file writes exactly two
 * kinds of row: `loan_notification` and (through EmailService) `email_event`.
 * It never touches `loan`, `book_copy`, `renewal_request` or a member. A mail
 * server being down cannot alter what the library believes about a book, and a
 * loan is not "more overdue" because a message failed.
 *
 * **3. It reads the current state, every time.** Which occurrence is due is
 * derived from the loan's due date as it stands right now, so a renewal that
 * happened an hour ago has already retired the old date's reminders — there is
 * nothing scheduled anywhere to cancel.
 *
 * **4. It is off unless a library turns it on.** Writing to guardians is a
 * decision a community makes, not a default a codebase assumes.
 */

export interface ReminderRunResult {
  /** False when the library has reminders switched off. Nothing else ran. */
  enabled: boolean;
  /** Loans whose current due date matched a configured occurrence. */
  due: number;
  sent: number;
  failed: number;
  /** Occurrences another run had already claimed. Not an error. */
  alreadySent: number;
  /** Loans with no guardian address on file — nobody to write to. */
  noRecipient: number;
}

const EMPTY_RESULT: ReminderRunResult = {
  enabled: false,
  due: 0,
  sent: 0,
  failed: 0,
  alreadySent: 0,
  noRecipient: 0,
};

interface DueLoanRow {
  loan_id: string;
  library_id: string;
  due_at: Date;
  child_name: string;
  member_status: UserStatus;
  title: string;
  copy_code: string;
  guardian_email: string | null;
}

/**
 * Every ACTIVE loan, with the one guardian address to write to.
 *
 * Deliberately not filtered by date in SQL: the offsets are library
 * configuration and the arithmetic is calendar arithmetic in a named timezone,
 * which belongs in `src/lib/notifications.ts` where it is pure and tested, not
 * in a query where it would be re-derived in a second dialect. A community
 * library has tens of active loans, so reading them all costs nothing.
 *
 * The guardian is picked exactly as password recovery picks one: primary first,
 * then oldest. A child has no address of their own, which is the whole reason
 * the guardian relationship exists.
 */
async function activeLoansWithRecipients(libraryId: string): Promise<DueLoanRow[]> {
  return prisma.$queryRaw<DueLoanRow[]>`
    SELECT l.id            AS loan_id,
           l.library_id    AS library_id,
           l.due_at        AS due_at,
           u.display_name  AS child_name,
           u.status        AS member_status,
           t.title         AS title,
           c.copy_code     AS copy_code,
           (SELECT g.email
              FROM guardian_member gm
              JOIN guardian g ON g.id = gm.guardian_id
             WHERE gm.member_user_id = u.id
             ORDER BY gm.is_primary DESC, gm.created_at ASC
             LIMIT 1)      AS guardian_email
      FROM loan l
      JOIN app_user u  ON u.id = l.member_user_id
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
     WHERE l.library_id = ${libraryId}
       AND l.status = 'ACTIVE'
     ORDER BY l.due_at ASC
  `;
}

/**
 * Claims one occurrence, or reports that somebody else already has it.
 *
 * The insert IS the lock. There is no read-then-write window here for a second
 * cron — or a second server — to slip through, because two inserts of the same
 * (loan, due date, offset) cannot both commit.
 */
async function claimOccurrence(params: {
  libraryId: string;
  loanId: string;
  dueAt: Date;
  offsetDays: number;
  kind: LoanNotificationKind;
}): Promise<string | null> {
  try {
    const row = await prisma.loanNotification.create({
      data: {
        libraryId: params.libraryId,
        loanId: params.loanId,
        kind: params.kind,
        dueAt: params.dueAt,
        offsetDays: params.offsetDays,
        status: "QUEUED",
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/**
 * Runs one pass. Safe to run twice; safe to run twice at once.
 *
 * Failures are per-message: one guardian's mail server refusing does not stop
 * the other nineteen reminders, and no exception from this function can roll
 * back anything, because nothing outside it was in a transaction.
 */
export async function sendCirculationReminders(
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  const { library, settings } = await getCurrentLibrary();

  if (!settings.overdueRemindersEnabled) return EMPTY_RESULT;

  const offsets = normaliseReminderOffsets(settings.overdueReminderOffsets);
  if (offsets.length === 0) return { ...EMPTY_RESULT, enabled: true };

  const loans = await activeLoansWithRecipients(library.id);
  const result: ReminderRunResult = { ...EMPTY_RESULT, enabled: true };

  for (const loan of loans) {
    // A family that has left is not written to about a book. The desk's list
    // still shows the loan; a person deals with it.
    if (!memberMayBeReminded(loan.member_status)) continue;

    const offset = offsetFromDueDate(loan.due_at, settings.timezone, now);
    if (!offsets.includes(offset)) continue;

    result.due += 1;

    if (!loan.guardian_email) {
      // Nothing to do and nothing to record: there is no occurrence to claim
      // because there was never a message. Counted so the run says so out loud.
      result.noRecipient += 1;
      continue;
    }

    const kind = notificationKindForOffset(offset);

    const claimId = await claimOccurrence({
      libraryId: loan.library_id,
      loanId: loan.loan_id,
      dueAt: loan.due_at,
      offsetDays: offset,
      kind,
    });

    if (!claimId) {
      result.alreadySent += 1;
      continue;
    }

    const outcome = await EmailService.sendLoanReminder({
      to: loan.guardian_email,
      subject: reminderSubject({ childName: loan.child_name, title: loan.title, kind }),
      sentence: reminderSentence({
        childName: loan.child_name,
        title: loan.title,
        dueAt: loan.due_at,
        timezone: settings.timezone,
        now,
      }),
      childName: loan.child_name,
      title: loan.title,
      copyCode: loan.copy_code,
      openingNote: null,
      template: kind === "OVERDUE" ? TEMPLATE_IDS.LOAN_OVERDUE : TEMPLATE_IDS.LOAN_DUE_SOON,
      loanId: loan.loan_id,
    });

    await prisma.loanNotification.update({
      where: { id: claimId },
      data: {
        status: outcome.ok ? "SENT" : "FAILED",
        sentAt: outcome.ok ? new Date() : null,
        emailEventId: outcome.eventId,
      },
    });

    if (outcome.ok) result.sent += 1;
    else result.failed += 1;
  }

  return result;
}
