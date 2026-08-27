import "server-only";

import { Prisma, type CopyCondition, type CopyStatus, type LoanStatus, type UserStatus } from "@prisma/client";

import {
  donorAcknowledgement,
  ISSUABLE_CONDITIONS,
  ISSUABLE_STATUSES,
  type Page,
} from "@/lib/catalogue";
import {
  BORROW_REQUEST_MESSAGES,
  CIRCULATION_MESSAGES,
  LOAN_PAGE_SIZES,
  RENEWAL_REQUEST_MESSAGES,
  RETURN_ANNOUNCEMENT_MESSAGES,
  loanCondition,
  memberMayBorrow,
  type LoanFilter,
  type ReaderBorrowState,
  type ReaderRenewalState,
} from "@/lib/circulation";
import { calculateDueDate, calculateRenewedDueDate } from "@/lib/dates";
import { prisma } from "@/server/db";
import { getActor, requireActor, requireAnyPermission, requirePermission, type Actor } from "@/server/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";

/**
 * Circulation: the moment a book leaves the room in a child's bag, and the
 * moment it comes back.
 *
 * Four rules shape everything below.
 *
 * **1. The physical copy is what circulates.** A loan points at a `book_copy`,
 * never at a `book_title`. Three copies of The Jungle Book are three things
 * that can be borrowed; borrowing MJCL-B0007 says nothing about MJCL-B0012.
 * There is no code path in this file that resolves a title to "a copy" on the
 * caller's behalf — the librarian picks the object they are holding.
 *
 * **2. There is one source of truth, and the database keeps it.** A copy reads
 * BORROWED if and only if it has exactly one ACTIVE loan. That is not a
 * convention this file maintains carefully; it is a deferred constraint trigger
 * (see prisma/sql/005_circulation.sql) which refuses to let an incoherent
 * transaction commit at all. Everything here is the polite first line in front
 * of it: the trigger's message is for a developer, and a librarian deserves a
 * sentence they can act on.
 *
 * **3. Overdue is derived, never stored.** No column, no status, no nightly job
 * that could fail and leave the library believing something untrue. A loan is
 * overdue when it is ACTIVE and its stored due date has passed, evaluated in
 * the library's timezone.
 *
 * **4. Nothing is rewritten.** A returned loan keeps its issue date, its
 * original due date and every event that happened to it. Borrowing the same
 * copy again creates a NEW loan; it never reopens the old one. The library's
 * account of what happened is not editable, and the one escape hatch —
 * cancelling a mis-issue — leaves the row, the events and an audited reason
 * behind it.
 */

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/**
 * The permissions that mean "you work the circulation desk".
 *
 * Deliberately NOT `loan.view`. Every reader holds `loan.view` — it is what
 * lets a child see their own books — so guarding the desk with it would hand
 * any nine-year-old the whole library's loan list, every borrower's name
 * included. This is the same trap `book.view` set in Phase 2, and it is worth
 * writing down twice: **a permission that readers hold can never guard a staff
 * screen.**
 *
 * The reader's own view is guarded by `loan.view` and by the shape of the
 * function: `listOwnLoans` takes no member id at all.
 */
const CIRCULATION_DESK = ["loan.issue", "loan.return", "loan.renew"] as const;

// Who may borrow lives in src/lib/circulation.ts, as an allowlist of one:
// ACTIVE. See `memberMayBorrow` there for why it is written that way round.

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A child, as the desk's picker shows them. */
export interface ReaderPick {
  memberUserId: string;
  displayName: string;
  memberCode: string;
  /** Present so the desk can explain a refusal before the librarian tries. */
  canBorrow: boolean;
  activeLoanCount: number;
  avatarKey: string | null;
  photoMediaId: string | null;
}

/** A physical book, as the desk's picker shows it. */
export interface CopyPick {
  copyId: string;
  copyCode: string;
  title: string;
  authors: string[];
  status: CopyStatus;
  condition: CopyCondition;
  coverMediaId: string | null;
  /** Null when it can go out; otherwise the sentence explaining why not. */
  blockedReason: string | null;
}

/** The confirmation card, before anything is written. */
export interface IssuePreview {
  reader: ReaderPick;
  book: CopyPick;
  /** What the due date WOULD be. Computed on the server, in library time. */
  dueAt: Date;
  loanPeriodDays: number;
  /** Empty when the issue would succeed. */
  blockers: string[];
}

export interface IssuedLoan {
  loanId: string;
  copyCode: string;
  title: string;
  readerName: string;
  dueAt: Date;
}

/** One row of the desk's loan table. */
export interface StaffLoanRow {
  loanId: string;
  status: LoanStatus;
  readerName: string;
  memberCode: string;
  memberUserId: string;
  copyId: string;
  copyCode: string;
  title: string;
  authors: string[];
  /**
   * Presentation only. A librarian scanning a list of thirty loans finds a book
   * by its jacket faster than by its title, and the id is already public to
   * anyone who may see this row — it is the same id the catalogue renders.
   */
  coverMediaId: string | null;
  issuedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  renewalCount: number;
  condition: CopyCondition;
  /**
   * When the reader said this one is coming back, if they have.
   *
   * A note from the child, not a fact about where the book is. The row still
   * reads "Out" and the Return button still does the real work.
   */
  returnAnnouncedAt: Date | null;
}

export interface StaffLoanEvent {
  type: string;
  occurredAt: Date;
  actorName: string | null;
  previousDueAt: Date | null;
  newDueAt: Date | null;
  note: string | null;
}

export interface StaffLoanDetail extends StaffLoanRow {
  events: StaffLoanEvent[];
  maxRenewals: number;
}

/**
 * One of a child's own books.
 *
 * A projection, not a filtered render. There is no loan id, no member id, no
 * copy id, no librarian's note and no audit field on this object, so no
 * template can leak one by accident. The child's own book code is here because
 * it is printed on the book in their hand.
 */
export interface ReaderLoanCard {
  code: string;
  title: string;
  authors: string[];
  coverMediaId: string | null;
  status: LoanStatus;
  issuedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  /** Already rendered as the donor chose. Never mentions who has the book. */
  donorAcknowledgement: string | null;
  /** Where this child's own asking stands. Never anybody else's. */
  renewalState: ReaderRenewalState;
  /** True when "ask to keep it" should be offered on this book. */
  canAskToKeep: boolean;
  /** Why not, in the child's own words. Null when they can ask. */
  askBlockedReason: string | null;
  /**
   * When this reader told the library the book is coming back, if they have.
   *
   * Not a return. The book is still theirs and still due on the same day until
   * a librarian takes it in.
   */
  returnAnnouncedAt: Date | null;
  /** True when "I'm bringing this back" should be offered on this book. */
  canAnnounceReturn: boolean;
}

// ---------------------------------------------------------------------------
// Search — finding the child and the book
// ---------------------------------------------------------------------------

/**
 * Escapes a search term for LIKE.
 *
 * Prisma parameterises the value, so this is not about injection — it is about
 * a librarian typing "50%" and matching every reader in the library.
 */
function likeTerm(search: string): string {
  const escaped = search.trim().toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`);
  return `%${escaped}%`;
}

interface ReaderRow {
  member_user_id: string;
  display_name: string;
  member_code: string;
  status: UserStatus;
  avatar_key: string | null;
  photo_media_id: string | null;
  active_loans: bigint;
}

/**
 * Finds a child at the desk, by name or by card number.
 *
 * Apartment is deliberately not searchable and not returned. A flat number is
 * where a family lives; it is not a lookup key for children, and a desk that
 * offers "show me everyone in B-402" is a directory of who lives where with
 * whom. Name and card number are what a librarian standing in front of a child
 * actually has. See docs/SECURITY.md.
 *
 * What comes back is the minimum needed to pick the right child: their name,
 * their card, their picture, and how many books they already have. No guardian,
 * no contact details, no date of birth, no account-status reason.
 */
export async function searchReaders(search: string): Promise<ReaderPick[]> {
  const actor = await requirePermission("loan.issue");
  const term = search.trim();
  if (term.length < 1) return [];

  const like = likeTerm(term);

  const rows = await prisma.$queryRaw<ReaderRow[]>`
    SELECT u.id            AS member_user_id,
           u.display_name  AS display_name,
           m.member_code   AS member_code,
           u.status        AS status,
           m.avatar_key    AS avatar_key,
           m.photo_media_id AS photo_media_id,
           (SELECT count(*) FROM loan l
             WHERE l.member_user_id = u.id AND l.status = 'ACTIVE') AS active_loans
      FROM app_user u
      JOIN member_profile m ON m.user_id = u.id
     WHERE u.library_id = ${actor.libraryId}
       AND u.kind = 'MEMBER'
       AND (lower(u.display_name) LIKE ${like} OR lower(m.member_code) LIKE ${like})
     ORDER BY u.display_name ASC
     LIMIT ${LOAN_PAGE_SIZES.picker}
  `;

  return rows.map((row) => ({
    memberUserId: row.member_user_id,
    displayName: row.display_name,
    memberCode: row.member_code,
    canBorrow: memberMayBorrow(row.status),
    activeLoanCount: Number(row.active_loans),
    avatarKey: row.avatar_key,
    photoMediaId: row.photo_media_id,
  }));
}

interface CopySearchRow {
  copy_id: string;
  copy_code: string;
  title: string;
  authors: string[];
  status: CopyStatus;
  condition: CopyCondition;
  cover_media_id: string | null;
}

/**
 * Finds a physical book at the desk, by book code, title or author.
 *
 * Archived copies are excluded outright — they are not part of the collection,
 * so offering one for issue would be offering a book that is not in the room.
 * Everything else IS returned, including books that are out, lost or damaged,
 * each carrying the sentence explaining why it cannot go out. A librarian
 * searching for a book they are holding needs to be told what the library
 * thinks of it, not to have it silently vanish from the results.
 */
export async function searchCopies(search: string): Promise<CopyPick[]> {
  const actor = await requirePermission("loan.issue");
  const term = search.trim();
  if (term.length < 1) return [];

  const like = likeTerm(term);

  const rows = await prisma.$queryRaw<CopySearchRow[]>`
    SELECT c.id             AS copy_id,
           c.copy_code      AS copy_code,
           t.title          AS title,
           t.authors        AS authors,
           c.status         AS status,
           c.condition      AS condition,
           t.cover_media_id AS cover_media_id
      FROM book_copy c
      JOIN book_title t ON t.id = c.title_id
     WHERE c.library_id = ${actor.libraryId}
       AND c.status <> 'ARCHIVED'
       AND (
         lower(c.copy_code) LIKE ${like}
         OR lower(t.title) LIKE ${like}
         OR book_title_authors_text(t.authors) LIKE ${like}
       )
     ORDER BY (c.status = 'AVAILABLE') DESC, lower(t.title) ASC, c.copy_code ASC
     LIMIT ${LOAN_PAGE_SIZES.picker}
  `;

  return rows.map(toCopyPick);
}

function toCopyPick(row: CopySearchRow): CopyPick {
  return {
    copyId: row.copy_id,
    copyCode: row.copy_code,
    title: row.title,
    authors: row.authors,
    status: row.status,
    condition: row.condition,
    coverMediaId: row.cover_media_id,
    blockedReason: copyBlockedReason(row.status, row.condition),
  };
}

/**
 * Why this book cannot go out, or null if it can.
 *
 * One function, used by the picker, the confirmation card and the issue
 * transaction, so the reason the librarian was shown is the reason the server
 * enforced. Order matters: a book that is both lost and damaged is lost first,
 * because that is the thing to go and do something about.
 */
function copyBlockedReason(status: CopyStatus, condition: CopyCondition): string | null {
  if (status === "ARCHIVED") return CIRCULATION_MESSAGES.bookIsArchived;
  if (status === "LOST") return CIRCULATION_MESSAGES.bookIsLost;
  if (status === "BORROWED") return CIRCULATION_MESSAGES.bookAlreadyOut;
  if (status === "DAMAGED") return CIRCULATION_MESSAGES.bookIsDamaged;
  if (!ISSUABLE_STATUSES.includes(status)) return CIRCULATION_MESSAGES.bookNotAvailable;
  // A copy can sit on the shelf as AVAILABLE while its condition says DAMAGED —
  // Phase 2 lets a librarian record the two independently. The way to make it
  // issuable is to mend it and change the condition, which is a human looking
  // at the object, not a checkbox saying "issue anyway".
  if (!ISSUABLE_CONDITIONS.includes(condition)) return CIRCULATION_MESSAGES.bookIsDamaged;
  return null;
}

// ---------------------------------------------------------------------------
// The confirmation card
// ---------------------------------------------------------------------------

/**
 * Everything the librarian confirms before pressing Issue: who, which book, and
 * the date it comes back.
 *
 * The due date shown here is computed by the same function that will compute
 * the stored one, from the same settings row, on the server. The browser never
 * calculates a due date — a child travelling, or a laptop with the wrong clock,
 * must not be able to produce a different answer from the book on the shelf.
 *
 * This is a preview and writes nothing. Everything it checks is checked again
 * inside the issue transaction, because the shelf can change between a
 * librarian reading this screen and pressing the button.
 */
export async function getIssuePreview(
  memberUserId: string,
  copyId: string,
): Promise<IssuePreview> {
  const actor = await requirePermission("loan.issue");
  const { settings } = await getCurrentLibrary();

  const [reader] = await prisma.$queryRaw<ReaderRow[]>`
    SELECT u.id AS member_user_id, u.display_name, m.member_code, u.status,
           m.avatar_key, m.photo_media_id,
           (SELECT count(*) FROM loan l
             WHERE l.member_user_id = u.id AND l.status = 'ACTIVE') AS active_loans
      FROM app_user u
      JOIN member_profile m ON m.user_id = u.id
     WHERE u.id = ${memberUserId}
       AND u.library_id = ${actor.libraryId}
       AND u.kind = 'MEMBER'
  `;
  if (!reader) throw new NotFoundError(`Member ${memberUserId} not found in library ${actor.libraryId}`);

  const [copy] = await prisma.$queryRaw<CopySearchRow[]>`
    SELECT c.id AS copy_id, c.copy_code, t.title, t.authors, c.status, c.condition,
           t.cover_media_id
      FROM book_copy c
      JOIN book_title t ON t.id = c.title_id
     WHERE c.id = ${copyId} AND c.library_id = ${actor.libraryId}
  `;
  if (!copy) throw new NotFoundError(`Copy ${copyId} not found in library ${actor.libraryId}`);

  const readerPick: ReaderPick = {
    memberUserId: reader.member_user_id,
    displayName: reader.display_name,
    memberCode: reader.member_code,
    canBorrow: memberMayBorrow(reader.status),
    activeLoanCount: Number(reader.active_loans),
    avatarKey: reader.avatar_key,
    photoMediaId: reader.photo_media_id,
  };
  const bookPick = toCopyPick(copy);

  const blockers: string[] = [];
  if (!readerPick.canBorrow) blockers.push(CIRCULATION_MESSAGES.readerUnavailable);
  if (bookPick.blockedReason) blockers.push(bookPick.blockedReason);
  if (readerPick.activeLoanCount >= settings.maxActiveLoans) {
    blockers.push(
      CIRCULATION_MESSAGES.loanLimitReached(readerPick.displayName, settings.maxActiveLoans),
    );
  }

  return {
    reader: readerPick,
    book: bookPick,
    dueAt: calculateDueDate(new Date(), settings.borrowingPeriodDays, settings.timezone),
    loanPeriodDays: settings.borrowingPeriodDays,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

/**
 * Gives one physical book to one child.
 *
 * All of it in one transaction, and every check re-run inside it holding row
 * locks — because "we checked availability a second ago" is not a guarantee of
 * anything. Two librarians at two tablets can press Issue on the same book in
 * the same second, and exactly one of them must win.
 *
 * **Lock order is member, then copy. Always.** Two concurrent issues therefore
 * queue behind the same first lock rather than each holding what the other
 * wants, so this cannot deadlock. Nothing else in circulation locks a member
 * row, which keeps the ordering trivially consistent across the whole file.
 *
 * The member lock is what makes the borrowing limit concurrency-safe. Counting
 * a child's active loans without it would let two simultaneous requests both
 * read "1 of 2" and both succeed, leaving a child with three books. With it,
 * the second request waits, re-reads after the first commits, and sees 2.
 */
export async function issueBook(input: {
  memberUserId: string;
  copyId: string;
}): Promise<IssuedLoan> {
  const actor = await requirePermission("loan.issue");
  const { settings } = await getCurrentLibrary();

  try {
    return await prisma.$transaction((tx) => issueLockedLoan(tx, actor, settings, input));
  } catch (error) {
    // A refusal is the interesting event when a family later asks why a child
    // came home empty handed — and it is the only trace an attempted bypass of
    // the desk's rules leaves. Written outside the transaction on purpose: the
    // transaction rolled back, and a record of the refusal must not roll back
    // with it.
    if (error instanceof RuleViolationError || error instanceof ConflictError) {
      await recordAudit(prisma, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.LOAN_ISSUE_REFUSED,
        entityType: "book_copy",
        entityId: input.copyId,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { memberUserId: input.memberUserId, reason: error.message },
      }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * The issue itself, inside somebody else's transaction.
 *
 * Extracted so that approving a child's borrow request runs **this** code and
 * not a copy of it. There is exactly one way a book leaves the library room in
 * this application, and a rule added here cannot be missed by the other path,
 * because there is no other path. Same reasoning as `renewLockedLoan`, and the
 * same shape.
 */
async function issueLockedLoan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  settings: { maxActiveLoans: number; borrowingPeriodDays: number; timezone: string },
  input: { memberUserId: string; copyId: string },
): Promise<IssuedLoan> {
  // 1. Lock the reader.
  const [member] = await tx.$queryRaw<
    { id: string; display_name: string; status: UserStatus; kind: string }[]
  >`
    SELECT id, display_name, status, kind::text AS kind
      FROM app_user
     WHERE id = ${input.memberUserId}
       AND library_id = ${actor.libraryId}
     FOR UPDATE
  `;

  // Tenancy from the session, never from the request: a member id from
  // another community resolves to nothing at all.
  if (!member || member.kind !== "MEMBER") {
    throw new NotFoundError(
      `Member ${input.memberUserId} not found in library ${actor.libraryId}`,
    );
  }

  if (!memberMayBorrow(member.status)) {
    // The generic sentence. Why an account is paused is the library's
    // business and a conversation with the family — never a tooltip.
    throw new RuleViolationError(
      `Member ${member.id} is ${member.status} and may not borrow`,
      CIRCULATION_MESSAGES.readerUnavailable,
    );
  }

  // 2. Lock the copy.
  const [copy] = await tx.$queryRaw<
    { id: string; copy_code: string; status: CopyStatus; condition: CopyCondition }[]
  >`
    SELECT id, copy_code, status, condition
      FROM book_copy
     WHERE id = ${input.copyId}
       AND library_id = ${actor.libraryId}
     FOR UPDATE
  `;
  if (!copy) {
    throw new NotFoundError(`Copy ${input.copyId} not found in library ${actor.libraryId}`);
  }

  const [title] = await tx.$queryRaw<{ title: string }[]>`
    SELECT t.title FROM book_title t
      JOIN book_copy c ON c.title_id = t.id
     WHERE c.id = ${copy.id}
  `;

  // 3. Revalidate the book, holding the lock.
  const blocked = copyBlockedReason(copy.status, copy.condition);
  if (blocked) {
    throw new RuleViolationError(
      `Copy ${copy.copy_code} is ${copy.status}/${copy.condition} and cannot be issued`,
      blocked,
    );
  }

  // 4. Revalidate the limit, holding the lock. This count is current
  //    because any competing transaction has already committed or is still
  //    waiting on the member row above.
  const activeLoans = await tx.loan.count({
    where: { memberUserId: member.id, status: "ACTIVE" },
  });
  if (activeLoans >= settings.maxActiveLoans) {
    throw new RuleViolationError(
      `Member ${member.id} has ${activeLoans} active loans (limit ${settings.maxActiveLoans})`,
      CIRCULATION_MESSAGES.loanLimitReached(member.display_name, settings.maxActiveLoans),
    );
  }

  // 5. And that nobody else already has this copy. The partial unique index
  //    would refuse anyway; this is the version with a sentence.
  const existing = await tx.loan.count({ where: { copyId: copy.id, status: "ACTIVE" } });
  if (existing > 0) {
    throw new ConflictError(
      `Copy ${copy.copy_code} already has an active loan`,
      CIRCULATION_MESSAGES.bookAlreadyOut,
    );
  }

  const issuedAt = new Date();
  const dueAt = calculateDueDate(issuedAt, settings.borrowingPeriodDays, settings.timezone);

  const loan = await tx.loan.create({
    data: {
      libraryId: actor.libraryId,
      copyId: copy.id,
      memberUserId: member.id,
      status: "ACTIVE",
      issuedAt,
      issuedById: actor.userId,
      dueAt,
    },
    select: { id: true },
  });

  await tx.loanEvent.create({
    data: {
      loanId: loan.id,
      type: "ISSUE",
      occurredAt: issuedAt,
      actorUserId: actor.userId,
      newDueAt: dueAt,
    },
  });

  await tx.bookCopy.update({
    where: { id: copy.id },
    data: { status: "BORROWED" },
  });

  await recordAudit(tx, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.LOAN_ISSUED,
    entityType: "loan",
    entityId: loan.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: {
      copyCode: copy.copy_code,
      memberUserId: member.id,
      readerName: member.display_name,
      dueAt: dueAt.toISOString(),
      loanPeriodDays: settings.borrowingPeriodDays,
    },
  });

  return {
    loanId: loan.id,
    copyCode: copy.copy_code,
    title: title?.title ?? "",
    readerName: member.display_name,
    dueAt,
  };
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

/**
 * Takes a book back.
 *
 * The condition argument is the librarian's own look at the object, and it is
 * the only thing that changes a copy's condition here. **A return never
 * silently resets a condition to Good** — a book that went out Fair comes back
 * Fair unless somebody says otherwise, because "we got it back" is not evidence
 * that it is in better shape than it was.
 *
 * A book that comes back damaged goes to DAMAGED rather than AVAILABLE, so the
 * next child is not handed something falling apart. Getting it back on the
 * shelf is then a deliberate act: mend it, change its condition, and it becomes
 * issuable again.
 *
 * Nothing about the loan's past is touched. The issue date, the original due
 * date and every renewal stay exactly as they are; the return is an event
 * appended to them.
 */
export async function returnBook(input: {
  loanId: string;
  /** The librarian's review. Omitted means "unchanged", never "Good". */
  condition?: CopyCondition;
}): Promise<{ copyCode: string; title: string; readerName: string }> {
  const actor = await requirePermission("loan.return");

  return prisma.$transaction(async (tx) => {
    const loan = await lockActiveLoan(tx, actor, input.loanId);

    const [copy] = await tx.$queryRaw<
      { id: string; copy_code: string; status: CopyStatus; condition: CopyCondition }[]
    >`
      SELECT id, copy_code, status, condition
        FROM book_copy WHERE id = ${loan.copy_id} FOR UPDATE
    `;
    if (!copy) throw new NotFoundError(`Copy ${loan.copy_id} vanished mid-return`);

    const nextCondition = input.condition ?? copy.condition;
    /*
     * A damaged book does not go back on the shelf.
     *
     * LOST is not handled here and does not need to be: the invariant trigger
     * means a copy with an active loan reads BORROWED, so a copy being returned
     * cannot currently be LOST. Recovering a lost book is its own deliberate
     * act by a librarian who has it in their hands — never a side effect of
     * somebody pressing Return.
     */
    const nextStatus: CopyStatus = nextCondition === "DAMAGED" ? "DAMAGED" : "AVAILABLE";
    const returnedAt = new Date();

    await tx.loan.update({
      where: { id: loan.id },
      data: { status: "RETURNED", returnedAt, returnedById: actor.userId },
    });

    await tx.loanEvent.create({
      data: {
        loanId: loan.id,
        type: "RETURN",
        occurredAt: returnedAt,
        actorUserId: actor.userId,
      },
    });

    if (nextCondition !== copy.condition) {
      await tx.loanEvent.create({
        data: {
          loanId: loan.id,
          type: "MARK_DAMAGED",
          occurredAt: returnedAt,
          actorUserId: actor.userId,
          note: `Condition changed from ${copy.condition} to ${nextCondition} on return.`,
        },
      });
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BOOK_COPY_CONDITION_CHANGED,
        entityType: "book_copy",
        entityId: copy.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { copyCode: copy.copy_code, from: copy.condition, to: nextCondition },
      });
    }

    await tx.bookCopy.update({
      where: { id: copy.id },
      data: { status: nextStatus, condition: nextCondition },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.LOAN_RETURNED,
      entityType: "loan",
      entityId: loan.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        copyCode: copy.copy_code,
        memberUserId: loan.member_user_id,
        dueAt: loan.due_at.toISOString(),
        returnedAt: returnedAt.toISOString(),
        condition: nextCondition,
        copyStatus: nextStatus,
      },
    });

    return {
      copyCode: copy.copy_code,
      title: loan.title,
      readerName: loan.reader_name,
    };
  });
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/**
 * Keeps a book for longer.
 *
 * The new date is `renewal_period_days` from the **current due date**, not from
 * today. A child who renews three days early keeps those three days rather than
 * being quietly punished for coming to the desk promptly. Configured, never a
 * literal: a library that renews for a different length changes one row.
 *
 * The original due date is not lost. It goes into the RENEW event as
 * `previous_due_at`, and a database CHECK refuses a RENEW event that does not
 * carry both dates — so a renewal that erased a loan's history would not
 * commit.
 *
 * **An overdue loan is not renewable** by default. That is a policy, written
 * down as `allow_renewal_when_overdue`, and its reason is that "renew" should
 * mean "you still have it and we know where it is". A late book comes to the
 * desk, is returned, and may go straight back out in the same minute — which is
 * the same outcome, arrived at with the librarian holding the book.
 */
export async function renewLoan(input: { loanId: string }): Promise<{ dueAt: Date }> {
  const actor = await requirePermission("loan.renew");
  const { settings } = await getCurrentLibrary();

  return prisma.$transaction(async (tx) => {
    const loan = await lockActiveLoan(tx, actor, input.loanId);
    return renewLockedLoan(tx, actor, settings, loan, { source: "desk" });
  });
}

/**
 * The renewal itself, given a loan whose row is already locked.
 *
 * Extracted so that approving a child's request can be the *same* renewal, not
 * a second implementation of one. There are exactly two callers — the desk
 * button above, and `decideRenewalRequest` below — and both arrive here holding
 * the loan's lock, having read the same settings row. If the rules change, they
 * change once.
 *
 * It does not open a transaction and it does not check a permission: both
 * belong to the caller, which knows which authority it is acting under and
 * which other rows it needs held. `loan.renew` is the permission behind both
 * paths, because approving a request does precisely what the desk button does.
 */
async function renewLockedLoan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  settings: { maxRenewals: number; renewalPeriodDays: number; allowRenewalWhenOverdue: boolean; timezone: string },
  loan: LockedLoanRow,
  options: { source: "desk" | "request"; requestId?: string },
): Promise<{ dueAt: Date; previousDueAt: Date }> {
  if (!memberMayBorrow(loan.reader_status)) {
    throw new RuleViolationError(
      `Member ${loan.member_user_id} is ${loan.reader_status} and may not renew`,
      CIRCULATION_MESSAGES.readerUnavailable,
    );
  }

  if (loan.renewal_count >= settings.maxRenewals) {
    throw new RuleViolationError(
      `Loan ${loan.id} has been renewed ${loan.renewal_count} times (max ${settings.maxRenewals})`,
      CIRCULATION_MESSAGES.renewalLimitReached(settings.maxRenewals),
    );
  }

  /*
   * The overdue rule is re-evaluated HERE, at decision time, against the date
   * as it stands now — never against whatever was true when a child pressed a
   * button. A request raised on Monday for a book due Tuesday is refused if the
   * librarian gets to it on Wednesday, because by Wednesday the book is late
   * and the library's answer to a late book is to bring it in.
   */
  const overdue =
    loanCondition({ status: "ACTIVE", dueAt: loan.due_at }, settings.timezone) === "overdue";
  if (overdue && !settings.allowRenewalWhenOverdue) {
    throw new RuleViolationError(
      `Loan ${loan.id} is overdue and this library does not renew overdue loans`,
      CIRCULATION_MESSAGES.renewalBlockedByOverdue,
    );
  }

  const previousDueAt = loan.due_at;
  const dueAt = calculateRenewedDueDate(
    previousDueAt,
    settings.renewalPeriodDays,
    settings.timezone,
  );
  const occurredAt = new Date();

  await tx.loan.update({
    where: { id: loan.id },
    // issued_at is untouched. A renewed loan is the same loan, kept longer.
    data: { dueAt, renewalCount: { increment: 1 } },
  });

  await tx.loanEvent.create({
    data: {
      loanId: loan.id,
      type: "RENEW",
      occurredAt,
      actorUserId: actor.userId,
      previousDueAt,
      newDueAt: dueAt,
      // Says how this renewal came about. The event history is the library's
      // account of what happened, and "the child asked and I agreed" is a
      // different thing from "I extended it at the desk".
      note: options.source === "request" ? "Approved from a reader's request." : null,
    },
  });

  await recordAudit(tx, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.LOAN_RENEWED,
    entityType: "loan",
    entityId: loan.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: {
      copyCode: loan.copy_code,
      memberUserId: loan.member_user_id,
      previousDueAt: previousDueAt.toISOString(),
      dueAt: dueAt.toISOString(),
      renewalNumber: loan.renewal_count + 1,
      renewalPeriodDays: settings.renewalPeriodDays,
      source: options.source,
      ...(options.requestId ? { renewalRequestId: options.requestId } : {}),
    },
  });

  return { dueAt, previousDueAt };
}

// ---------------------------------------------------------------------------
// Cancellation — the correction mechanism
// ---------------------------------------------------------------------------

/**
 * Reverses an issue that should not have happened.
 *
 * This is the whole of Phase 3's administrative correction mechanism, and it is
 * deliberately the whole of it. The state a general "fix the circulation state"
 * screen would exist to repair — a copy reading BORROWED with nobody holding
 * it, or AVAILABLE while a loan is open — cannot occur: the deferred constraint
 * trigger refuses to commit a transaction that would produce it. Building a
 * repair tool for an unreachable state would mean building a way to reach it.
 *
 * What genuinely happens at a desk is the wrong book, or the wrong child,
 * noticed thirty seconds later. That is this.
 *
 * The loan is NOT deleted. It becomes CANCELLED, keeps its issue date and its
 * events, and gains a CANCEL event carrying the reason somebody typed. A
 * reason is required, because an unexplained correction in an audit log is
 * worse than no correction at all.
 *
 * Guarded by `loan.correct`, which a Junior Librarian does not and will not
 * hold: handing books out is a child volunteer's job, and rewriting the
 * library's account of what happened is not.
 */
export async function cancelLoan(input: { loanId: string; reason: string }): Promise<void> {
  const actor = await requirePermission("loan.correct");

  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new ValidationError(
      { reason: "Please say what went wrong, for the library's own records." },
      "Loan cancellation attempted without a reason",
    );
  }

  await prisma.$transaction(async (tx) => {
    const loan = await lockActiveLoan(tx, actor, input.loanId);
    const cancelledAt = new Date();

    await tx.loan.update({
      where: { id: loan.id },
      data: { status: "CANCELLED", cancelledAt, cancelledById: actor.userId },
    });

    await tx.loanEvent.create({
      data: {
        loanId: loan.id,
        type: "CANCEL",
        occurredAt: cancelledAt,
        actorUserId: actor.userId,
        note: reason.slice(0, 500),
      },
    });

    // Back on the shelf. The condition is untouched — cancelling a mis-issue
    // says nothing about the physical state of the book.
    await tx.bookCopy.update({
      where: { id: loan.copy_id },
      data: { status: "AVAILABLE" },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.LOAN_CANCELLED,
      entityType: "loan",
      entityId: loan.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        copyCode: loan.copy_code,
        memberUserId: loan.member_user_id,
        reason: reason.slice(0, 500),
        issuedAt: loan.issued_at.toISOString(),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Renewal requests — a child asks, a librarian decides
// ---------------------------------------------------------------------------

/**
 * A pending request, as the desk sees it.
 *
 * Enough to decide and no more. There is no guardian name, no contact detail,
 * no account status and no note about the family on this object — a librarian
 * deciding whether a book can stay out another fortnight needs the child, the
 * book, the date and the rule, and everything else would be somebody's private
 * information travelling for no reason.
 */
export interface RenewalRequestRow {
  requestId: string;
  requestedAt: Date;
  readerName: string;
  memberCode: string;
  title: string;
  /** Presentation only. The same cover id the catalogue already renders. */
  coverMediaId: string | null;
  copyCode: string;
  dueAt: Date;
  renewalCount: number;
  maxRenewals: number;
  /** Null when it can be approved; otherwise why it cannot, in staff wording. */
  blockedReason: string | null;
}

interface RenewalRequestListRow {
  request_id: string;
  requested_at: Date;
  reader_name: string;
  reader_status: UserStatus;
  member_code: string;
  title: string;
  cover_media_id: string | null;
  copy_code: string;
  due_at: Date;
  renewal_count: number;
}

/**
 * The child's own active loan for a book they are holding, row locked.
 *
 * **Takes a copy code, not a loan id.** The code is printed on the book in the
 * child's hand, which makes it the natural thing for their screen to send —
 * and, more to the point, the query is scoped to `member_user_id = the session`
 * so a code belonging to somebody else's loan resolves to nothing at all. There
 * is no id here for a curious nine-year-old to change into another child's.
 */
async function lockOwnActiveLoanByCode(
  tx: Prisma.TransactionClient,
  actor: Actor,
  copyCode: string,
): Promise<LockedLoanRow | null> {
  const [loan] = await tx.$queryRaw<LockedLoanRow[]>`
    SELECT l.id, l.copy_id, c.copy_code, l.member_user_id,
           u.display_name AS reader_name, u.status AS reader_status,
           t.title, l.status, l.issued_at, l.due_at, l.renewal_count,
           l.return_announced_at
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
     WHERE l.library_id = ${actor.libraryId}
       AND l.member_user_id = ${actor.userId}
       AND l.status = 'ACTIVE'
       AND lower(c.copy_code) = lower(${copyCode.trim()})
     FOR UPDATE OF l
  `;
  return loan ?? null;
}

/**
 * Why this loan cannot be extended right now, in the librarian's words.
 *
 * The same three rules `renewLockedLoan` enforces, asked without writing
 * anything — so the desk can show a request it already knows will be refused,
 * and say why, instead of offering an Approve button that throws.
 */
function renewalBlockedReason(
  loan: { reader_status: UserStatus; renewal_count: number; due_at: Date },
  settings: { maxRenewals: number; allowRenewalWhenOverdue: boolean; timezone: string },
): string | null {
  if (!memberMayBorrow(loan.reader_status)) return CIRCULATION_MESSAGES.readerUnavailable;
  if (loan.renewal_count >= settings.maxRenewals) {
    return CIRCULATION_MESSAGES.renewalLimitReached(settings.maxRenewals);
  }
  const overdue =
    loanCondition({ status: "ACTIVE", dueAt: loan.due_at }, settings.timezone) === "overdue";
  if (overdue && !settings.allowRenewalWhenOverdue) {
    return CIRCULATION_MESSAGES.renewalBlockedByOverdue;
  }
  return null;
}

/**
 * A child asks to keep a book longer.
 *
 * This is the only write in the whole application that a reader can cause, and
 * it is carefully the smallest possible one: a row that says somebody asked.
 * **No loan changes. No due date moves. No book changes status.** Until a
 * librarian decides, the library's account of where the book is and when it is
 * due is exactly what it was.
 *
 * The rules are checked here as well as at approval, so a child is told
 * straight away rather than being left waiting for a "no" that was knowable
 * immediately. They are checked again at approval because a Monday request can
 * be answered on Wednesday, by which time the answer may have changed.
 *
 * One pending request per loan, enforced by a partial unique index. Two taps on
 * a slow connection produce one request and one gentle sentence.
 */
export async function requestRenewal(input: { code: string }): Promise<{ title: string }> {
  const actor = await requirePermission("loan.request_renewal");
  const { settings } = await getCurrentLibrary();

  // A librarian has no library card and no shelf of their own. Shaped as
  // not-found rather than not-authorized: there is nothing here for them.
  if (actor.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} is not a member and has no loans of their own`);
  }

  const code = input.code.trim();
  if (!code) {
    throw new RuleViolationError("Renewal requested without a book code", RENEWAL_REQUEST_MESSAGES.notYours);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const loan = await lockOwnActiveLoanByCode(tx, actor, code);
      if (!loan) {
        // Covers every miss with one sentence: no such book, somebody else's
        // book, a book already brought back. A child probing codes learns
        // nothing about which of those it was.
        throw new RuleViolationError(
          `No active loan of ${code} for member ${actor.userId}`,
          RENEWAL_REQUEST_MESSAGES.notYours,
        );
      }

      const blocked = renewalBlockedReason(loan, settings);
      if (blocked) {
        // Re-worded for the child. The desk's sentence explains a policy; this
        // one says what to do next, and never names an account state.
        throw new RuleViolationError(
          `Loan ${loan.id} cannot be renewed: ${blocked}`,
          readerBlockedSentence(loan, settings),
        );
      }

      await tx.renewalRequest.create({
        data: { loanId: loan.id, requestedById: actor.userId, status: "PENDING" },
      });

      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.RENEWAL_REQUESTED,
        entityType: "loan",
        entityId: loan.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { copyCode: loan.copy_code, dueAt: loan.due_at.toISOString() },
      });

      return { title: loan.title };
    });
  } catch (error) {
    // The index refused a second open request. Not an error the child caused
    // and not one they should see as one.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(
        `Member ${actor.userId} already has a pending renewal request for ${code}`,
        RENEWAL_REQUEST_MESSAGES.alreadyAsked,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Telling the library a book is coming back
// ---------------------------------------------------------------------------

/**
 * A reader says they have finished with a book.
 *
 * **This does not return the book, and it is important that it cannot.** The
 * copy stays BORROWED, the loan stays ACTIVE, and the due date does not move.
 * All it writes is a note on the loan saying the reader has told the library.
 *
 * A child marking a book "returned" from their sofa would put a copy back on
 * the shelf that is still in their bag: the catalogue would offer it to
 * somebody else, the condition review that decides AVAILABLE from DAMAGED would
 * be skipped, and `returned_by_id` — which means "the librarian who took it
 * back" — would name a nine-year-old. So the reader announces and the desk
 * confirms, which is also what actually happens in the room.
 *
 * Unlike borrowing and renewing, there is nothing here to decide. A child
 * bringing a book back cannot be refused, so there is no request table, no
 * PENDING state and no queue to answer — only a note the desk can see. See
 * ADR-062.
 */
export async function announceReturn(input: { code: string }): Promise<{ title: string }> {
  const actor = await requirePermission("loan.announce_return");

  // A librarian has no shelf of their own. Not-found rather than
  // not-authorized: there is nothing here for them, and the desk has the real
  // return button.
  if (actor.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} is not a member and has no loans of their own`);
  }

  const code = input.code.trim();
  if (!code) {
    throw new RuleViolationError(
      "Return announced without a book code",
      RETURN_ANNOUNCEMENT_MESSAGES.notYours,
    );
  }

  return prisma.$transaction(async (tx) => {
    const loan = await lockOwnActiveLoanByCode(tx, actor, code);
    if (!loan) {
      // One sentence for every miss: no such book, somebody else's book, a
      // book already brought back. A child probing codes learns nothing.
      throw new RuleViolationError(
        `No active loan of ${code} for member ${actor.userId}`,
        RETURN_ANNOUNCEMENT_MESSAGES.notYours,
      );
    }

    /*
     * Saying it twice is not an error worth showing a child. The first notice
     * stands — overwriting the timestamp would move the desk's sense of how
     * long a book has been promised, which is the one thing this date is for.
     */
    if (loan.return_announced_at) {
      return { title: loan.title };
    }

    await tx.loan.update({
      where: { id: loan.id },
      data: { returnAnnouncedAt: new Date(), returnAnnouncedById: actor.userId },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.RETURN_ANNOUNCED,
      entityType: "loan",
      entityId: loan.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: loan.copy_code, dueAt: loan.due_at.toISOString() },
    });

    return { title: loan.title };
  });
}

/**
 * A reader changes their mind and keeps reading.
 *
 * Clears the note and nothing else. The loan was never altered, so there is
 * nothing to put back — and a child who is not finished after all should not
 * have to ask anybody's permission to carry on reading.
 */
export async function withdrawReturnAnnouncement(input: { code: string }): Promise<void> {
  const actor = await requirePermission("loan.announce_return");
  if (actor.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} is not a member and has no loans of their own`);
  }

  const code = input.code.trim();
  if (!code) {
    throw new RuleViolationError(
      "Return announcement withdrawn without a book code",
      RETURN_ANNOUNCEMENT_MESSAGES.noneToCancel,
    );
  }

  await prisma.$transaction(async (tx) => {
    const loan = await lockOwnActiveLoanByCode(tx, actor, code);
    if (!loan || !loan.return_announced_at) {
      throw new RuleViolationError(
        `No announced return of ${code} for member ${actor.userId}`,
        RETURN_ANNOUNCEMENT_MESSAGES.noneToCancel,
      );
    }

    await tx.loan.update({
      where: { id: loan.id },
      data: { returnAnnouncedAt: null, returnAnnouncedById: null },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.RETURN_ANNOUNCEMENT_WITHDRAWN,
      entityType: "loan",
      entityId: loan.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: loan.copy_code },
    });
  });
}

/** The child's version of a refusal: what to do, never which rule. */
function readerBlockedSentence(
  loan: { reader_status: UserStatus; renewal_count: number; due_at: Date },
  settings: { maxRenewals: number; allowRenewalWhenOverdue: boolean; timezone: string },
): string {
  if (!memberMayBorrow(loan.reader_status)) return RENEWAL_REQUEST_MESSAGES.accountUnavailable;
  if (loan.renewal_count >= settings.maxRenewals) return RENEWAL_REQUEST_MESSAGES.noRenewalsLeft;
  return RENEWAL_REQUEST_MESSAGES.overdue;
}

/**
 * A child changes their mind.
 *
 * Only their own, only while it is still pending, and it removes nothing: the
 * request becomes CANCELLED and stays, because a librarian who saw it in the
 * morning should be able to find out what happened to it.
 */
export async function cancelOwnRenewalRequest(input: { code: string }): Promise<void> {
  const actor = await requirePermission("loan.request_renewal");
  if (actor.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} is not a member and has no requests of their own`);
  }

  await prisma.$transaction(async (tx) => {
    const loan = await lockOwnActiveLoanByCode(tx, actor, input.code);
    if (!loan) {
      throw new RuleViolationError(
        `No active loan of ${input.code} for member ${actor.userId}`,
        RENEWAL_REQUEST_MESSAGES.notYours,
      );
    }

    const [request] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM renewal_request
       WHERE loan_id = ${loan.id} AND status = 'PENDING'
       FOR UPDATE
    `;
    if (!request) {
      throw new RuleViolationError(
        `No pending renewal request on loan ${loan.id}`,
        RENEWAL_REQUEST_MESSAGES.noneToCancel,
      );
    }

    await tx.renewalRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date() },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.RENEWAL_REQUEST_CANCELLED,
      entityType: "renewal_request",
      entityId: request.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: loan.copy_code, cancelledByReader: true },
    });
  });
}

/**
 * What is waiting for an answer.
 *
 * Guarded by `loan.renew` — the authority to extend a loan — and not by
 * `loan.view`, which every reader holds. Scoped to the actor's own library
 * through the loan, since a request row has no library of its own.
 */
export async function listPendingRenewalRequests(): Promise<RenewalRequestRow[]> {
  const actor = await requirePermission("loan.renew");
  const { settings } = await getCurrentLibrary();

  const rows = await prisma.$queryRaw<RenewalRequestListRow[]>`
    SELECT r.id AS request_id, r.requested_at,
           u.display_name AS reader_name, u.status AS reader_status,
           coalesce(m.member_code, '') AS member_code,
           t.title, t.cover_media_id, c.copy_code, l.due_at, l.renewal_count
      FROM renewal_request r
      JOIN loan l ON l.id = r.loan_id
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE r.status = 'PENDING'
       AND l.library_id = ${actor.libraryId}
       AND l.status = 'ACTIVE'
     ORDER BY r.requested_at ASC
     LIMIT ${LOAN_PAGE_SIZES.desk}
  `;

  return rows.map((row) => ({
    requestId: row.request_id,
    requestedAt: row.requested_at,
    readerName: row.reader_name,
    memberCode: row.member_code,
    title: row.title,
    coverMediaId: row.cover_media_id,
    copyCode: row.copy_code,
    dueAt: row.due_at,
    renewalCount: row.renewal_count,
    maxRenewals: settings.maxRenewals,
    blockedReason: renewalBlockedReason(
      { reader_status: row.reader_status, renewal_count: row.renewal_count, due_at: row.due_at },
      settings,
    ),
  }));
}

/** For the desk's badge. Same scoping as the list, no rows carried. */
export async function countPendingRenewalRequests(): Promise<number> {
  const actor = await requirePermission("loan.renew");

  const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
      FROM renewal_request r
      JOIN loan l ON l.id = r.loan_id
     WHERE r.status = 'PENDING'
       AND l.library_id = ${actor.libraryId}
       AND l.status = 'ACTIVE'
  `;
  return Number(row?.count ?? 0);
}

/**
 * A librarian answers.
 *
 * Approving performs **the renewal**, through `renewLockedLoan` — the same code
 * the desk's own button runs, in one transaction with the decision. There is no
 * second way to extend a loan in this application, which is the point: a rule
 * added to renewal cannot be missed by this path, because this path has no
 * rules of its own.
 *
 * Order inside the transaction: lock the request, confirm it is still pending,
 * lock the loan, re-check every rule against the loan as it is *now*, renew,
 * then mark the request. Two librarians pressing Approve on the same request
 * queue on the first lock; the second reads a request that is no longer PENDING
 * and is refused. Neither a second renewal nor a second approval is reachable.
 *
 * A refused approval leaves the request PENDING, deliberately. The librarian
 * has learnt something the child could not know — the book went overdue
 * yesterday — and the honest next step is theirs: decline it with a reason, or
 * take the book back. Silently marking it declined would attribute a decision
 * to somebody who never made one.
 */
export async function decideRenewalRequest(input: {
  requestId: string;
  decision: "APPROVE" | "DECLINE";
  reason?: string;
}): Promise<{ decision: "APPROVE" | "DECLINE"; readerName: string; title: string; dueAt: Date | null }> {
  const actor = await requirePermission("loan.renew");
  const { settings } = await getCurrentLibrary();

  const reason = (input.reason ?? "").trim();
  if (input.decision === "DECLINE" && reason.length < 3) {
    // A child gets told something, so somebody has to have written something.
    throw new ValidationError(
      { reason: "Please write a short note for the reader." },
      "Renewal request declined without a reason",
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const [request] = await tx.$queryRaw<
        { id: string; status: string; loan_id: string }[]
      >`
        SELECT r.id, r.status::text AS status, r.loan_id
          FROM renewal_request r
          JOIN loan l ON l.id = r.loan_id
         WHERE r.id = ${input.requestId}
           AND l.library_id = ${actor.libraryId}
         FOR UPDATE OF r
      `;

      if (!request) {
        throw new NotFoundError(
          `Renewal request ${input.requestId} not found in library ${actor.libraryId}`,
        );
      }
      if (request.status !== "PENDING") {
        throw new RuleViolationError(
          `Renewal request ${request.id} is ${request.status}, not PENDING`,
          "Someone has already answered this one.",
        );
      }

      const loan = await lockActiveLoan(tx, actor, request.loan_id);
      const decidedAt = new Date();

      if (input.decision === "DECLINE") {
        await tx.renewalRequest.update({
          where: { id: request.id },
          data: {
            status: "DECLINED",
            decidedById: actor.userId,
            decidedAt,
            decisionNote: reason.slice(0, 500),
          },
        });

        await recordAudit(tx, {
          libraryId: actor.libraryId,
          action: AUDIT_ACTIONS.RENEWAL_REQUEST_DECLINED,
          entityType: "renewal_request",
          entityId: request.id,
          actorUserId: actor.userId,
          actorLabel: actor.displayName,
          metadata: {
            copyCode: loan.copy_code,
            memberUserId: loan.member_user_id,
            reason: reason.slice(0, 500),
          },
        });

        return {
          decision: "DECLINE" as const,
          readerName: loan.reader_name,
          title: loan.title,
          dueAt: null,
        };
      }

      const renewed = await renewLockedLoan(tx, actor, settings, loan, {
        source: "request",
        requestId: request.id,
      });

      await tx.renewalRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          decidedById: actor.userId,
          decidedAt,
          decisionNote: reason ? reason.slice(0, 500) : null,
        },
      });

      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.RENEWAL_REQUEST_APPROVED,
        entityType: "renewal_request",
        entityId: request.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: {
          copyCode: loan.copy_code,
          memberUserId: loan.member_user_id,
          previousDueAt: renewed.previousDueAt.toISOString(),
          dueAt: renewed.dueAt.toISOString(),
        },
      });

      return {
        decision: "APPROVE" as const,
        readerName: loan.reader_name,
        title: loan.title,
        dueAt: renewed.dueAt,
      };
    });
  } catch (error) {
    /*
     * An approval the rules turned down is worth a row of its own, written
     * outside the transaction that rolled back — same reasoning as a refused
     * issue. It is the trace of a librarian trying to do something for a child
     * and the library saying no, which is exactly what somebody asks about
     * later.
     */
    if (error instanceof RuleViolationError || error instanceof ConflictError) {
      await recordAudit(prisma, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.RENEWAL_REQUEST_REFUSED,
        entityType: "renewal_request",
        entityId: input.requestId,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { decision: input.decision, reason: error.message },
      }).catch(() => undefined);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The shared lock
// ---------------------------------------------------------------------------

interface LockedLoanRow {
  id: string;
  copy_id: string;
  copy_code: string;
  member_user_id: string;
  reader_name: string;
  reader_status: UserStatus;
  title: string;
  status: LoanStatus;
  issued_at: Date;
  due_at: Date;
  renewal_count: number;
  return_announced_at: Date | null;
}

/**
 * Loads one ACTIVE loan with its row locked, or explains why it is not one.
 *
 * `FOR UPDATE OF l` locks the loan row only — the joined rows are read, not
 * held — which is what makes "return the same book twice" safe: the second
 * request waits, then reads a loan that is no longer ACTIVE and is refused.
 * Renewing twice in parallel is refused by the same mechanism.
 *
 * The library id comes from the session and is part of the WHERE clause, so a
 * loan id belonging to another community resolves to nothing rather than to a
 * permission error that would confirm it exists.
 */
async function lockActiveLoan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  loanId: string,
): Promise<LockedLoanRow> {
  const [loan] = await tx.$queryRaw<LockedLoanRow[]>`
    SELECT l.id, l.copy_id, c.copy_code, l.member_user_id,
           u.display_name AS reader_name, u.status AS reader_status,
           t.title, l.status, l.issued_at, l.due_at, l.renewal_count,
           l.return_announced_at
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
     WHERE l.id = ${loanId}
       AND l.library_id = ${actor.libraryId}
     FOR UPDATE OF l
  `;

  if (!loan) throw new NotFoundError(`Loan ${loanId} not found in library ${actor.libraryId}`);

  if (loan.status !== "ACTIVE") {
    throw new RuleViolationError(
      `Loan ${loanId} is ${loan.status}, not ACTIVE`,
      CIRCULATION_MESSAGES.loanNotActive,
    );
  }

  return loan;
}

// ---------------------------------------------------------------------------
// Reading — the desk
// ---------------------------------------------------------------------------

interface LoanListRow {
  loan_id: string;
  status: LoanStatus;
  reader_name: string;
  member_code: string;
  member_user_id: string;
  copy_id: string;
  copy_code: string;
  title: string;
  authors: string[];
  cover_media_id: string | null;
  issued_at: Date;
  due_at: Date;
  returned_at: Date | null;
  renewal_count: number;
  condition: CopyCondition;
  return_announced_at: Date | null;
}

export interface LoanQuery {
  filter?: LoanFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The desk's loan list: filtered, counted and paged in PostgreSQL.
 *
 * The browser is never handed every loan the library has ever made. At fifty
 * loans that would work and at fifty thousand it would not, and the tablet in
 * the library room is the device that would notice first.
 *
 * `overdue` is expressed as `due_at < now()` in SQL against the partial index
 * on active loans — the same derivation the child's screen uses, not a stored
 * flag that a missed job could leave wrong.
 */
export async function listLoansForStaff(query: LoanQuery = {}): Promise<Page<StaffLoanRow>> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);
  const pageSize = query.pageSize ?? LOAN_PAGE_SIZES.desk;
  const page = Math.max(1, Math.trunc(query.page ?? 1));

  const clauses: Prisma.Sql[] = [Prisma.sql`l.library_id = ${actor.libraryId}`];

  switch (query.filter ?? "active") {
    case "active":
      clauses.push(Prisma.sql`l.status = 'ACTIVE'`);
      break;
    case "overdue":
      clauses.push(Prisma.sql`l.status = 'ACTIVE' AND l.due_at < now()`);
      break;
    case "returned":
      clauses.push(Prisma.sql`l.status <> 'ACTIVE'`);
      break;
  }

  if (query.search?.trim()) {
    const like = likeTerm(query.search);
    // The five things a librarian actually knows: the child's name, their card,
    // the book's title, its author, or the code on its spine.
    clauses.push(Prisma.sql`(
      lower(u.display_name) LIKE ${like}
      OR lower(m.member_code) LIKE ${like}
      OR lower(t.title) LIKE ${like}
      OR book_title_authors_text(t.authors) LIKE ${like}
      OR lower(c.copy_code) LIKE ${like}
    )`);
  }

  const where = Prisma.join(clauses, " AND ");

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE ${where}
  `;

  const total = Number(count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);

  const rows = await prisma.$queryRaw<LoanListRow[]>`
    SELECT l.id AS loan_id, l.status, u.display_name AS reader_name,
           coalesce(m.member_code, '') AS member_code, l.member_user_id,
           c.id AS copy_id, c.copy_code, c.condition,
           t.title, t.authors, t.cover_media_id,
           l.issued_at, l.due_at, l.returned_at, l.renewal_count,
           l.return_announced_at
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE ${where}
     ORDER BY l.due_at ASC, l.issued_at DESC
     LIMIT ${pageSize} OFFSET ${(safePage - 1) * pageSize}
  `;

  return {
    items: rows.map(toStaffLoanRow),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}

function toStaffLoanRow(row: LoanListRow): StaffLoanRow {
  return {
    loanId: row.loan_id,
    status: row.status,
    readerName: row.reader_name,
    memberCode: row.member_code,
    memberUserId: row.member_user_id,
    copyId: row.copy_id,
    copyCode: row.copy_code,
    title: row.title,
    authors: row.authors,
    coverMediaId: row.cover_media_id,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    renewalCount: row.renewal_count,
    condition: row.condition,
    returnAnnouncedAt: row.return_announced_at,
  };
}

/** How many books are out, and how many are late. For the desk's landing page. */
export async function countDeskLoans(): Promise<{ active: number; overdue: number }> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);

  const [row] = await prisma.$queryRaw<{ active: bigint; overdue: bigint }[]>`
    SELECT count(*) FILTER (WHERE l.status = 'ACTIVE') AS active,
           count(*) FILTER (WHERE l.status = 'ACTIVE' AND l.due_at < now()) AS overdue
      FROM loan l
     WHERE l.library_id = ${actor.libraryId}
  `;

  return { active: Number(row?.active ?? 0), overdue: Number(row?.overdue ?? 0) };
}

/** One loan and its whole story, for the desk's detail panel. */
export async function getLoanForStaff(loanId: string): Promise<StaffLoanDetail> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);
  const { settings } = await getCurrentLibrary();

  const [row] = await prisma.$queryRaw<LoanListRow[]>`
    SELECT l.id AS loan_id, l.status, u.display_name AS reader_name,
           coalesce(m.member_code, '') AS member_code, l.member_user_id,
           c.id AS copy_id, c.copy_code, c.condition,
           t.title, t.authors, t.cover_media_id,
           l.issued_at, l.due_at, l.returned_at, l.renewal_count
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE l.id = ${loanId} AND l.library_id = ${actor.libraryId}
  `;

  if (!row) throw new NotFoundError(`Loan ${loanId} not found in library ${actor.libraryId}`);

  const events = await prisma.loanEvent.findMany({
    where: { loanId },
    orderBy: { occurredAt: "asc" },
    select: {
      type: true,
      occurredAt: true,
      previousDueAt: true,
      newDueAt: true,
      note: true,
      actor: { select: { displayName: true } },
    },
  });

  return {
    ...toStaffLoanRow(row),
    maxRenewals: settings.maxRenewals,
    events: events.map((event) => ({
      type: event.type,
      occurredAt: event.occurredAt,
      actorName: event.actor?.displayName ?? null,
      previousDueAt: event.previousDueAt,
      newDueAt: event.newDueAt,
      note: event.note,
    })),
  };
}

// ---------------------------------------------------------------------------
// Reading — the child
// ---------------------------------------------------------------------------

/**
 * A child's own books.
 *
 * **Takes no member id.** Ownership comes from the session and there is nothing
 * in the request to tamper with — the strongest form of the rule that a child
 * reaches their own record and no other. There is no "whose loans?" parameter
 * to get wrong, no ownership check to forget, and no id in a URL that a curious
 * nine-year-old could increment.
 *
 * Staff get null rather than an error: a librarian has no library card, so
 * "your books" is not a question with an answer for them.
 *
 * What comes back is a projection with no ids in it at all. Nothing here can
 * reveal another child, because nothing here reads another child's row.
 */
export async function listOwnLoans(): Promise<{
  active: ReaderLoanCard[];
  history: ReaderLoanCard[];
  limit: number;
  /** So the child's screen can say "another 14 days" without knowing the number. */
  renewalPeriodDays: number;
} | null> {
  const actor = await requireActor();
  if (!actor.permissions.has("loan.view")) {
    // 404-shaped, not 403: a signed-in account with no reading rights should
    // not be able to learn that this screen exists for other people.
    throw new NotFoundError(`User ${actor.userId} may not read loans`);
  }
  if (actor.kind !== "MEMBER") return null;

  const { settings } = await getCurrentLibrary();

  const loans = await prisma.loan.findMany({
    where: {
      memberUserId: actor.userId,
      // A cancelled loan is one that should never have existed. It stays in the
      // library's records and in the audit log; it is not part of a child's
      // reading history, and showing it would only confuse them.
      status: { in: ["ACTIVE", "RETURNED"] },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { issuedAt: "desc" }],
    take: LOAN_PAGE_SIZES.reader * 2,
    select: {
      status: true,
      issuedAt: true,
      dueAt: true,
      returnedAt: true,
      renewalCount: true,
      returnAnnouncedAt: true,
      /*
       * The child's own most recent ask about this book, and only theirs — this
       * is a nested read of rows belonging to a loan already filtered to
       * `memberUserId = the session`. There is no path from here to another
       * child's request.
       */
      renewalRequests: {
        orderBy: { requestedAt: "desc" },
        take: 1,
        select: { status: true },
      },
      copy: {
        select: {
          copyCode: true,
          title: { select: { title: true, authors: true, coverMediaId: true } },
          donation: {
            select: { donorName: true, donorApartment: true, displayConsent: true },
          },
        },
      },
    },
  });

  const cards: ReaderLoanCard[] = loans.map((loan) => {
    const latestRequest = loan.renewalRequests.at(0)?.status ?? null;
    const renewalState: ReaderRenewalState =
      loan.status !== "ACTIVE" || latestRequest === null || latestRequest === "CANCELLED"
        ? "none"
        : latestRequest === "PENDING"
          ? "pending"
          : latestRequest === "APPROVED"
            ? "approved"
            : "declined";

    /*
     * Why they cannot ask, said the way their own screen says things.
     *
     * Account state is not consulted here and does not need to be: a paused
     * account's sessions are revoked, so nobody reading this page is in one.
     * `requestRenewal` checks it anyway, inside its transaction, because that
     * is where the answer has to be right.
     */
    const overdue = loanCondition(loan, settings.timezone) === "overdue";
    const askBlockedReason =
      loan.status !== "ACTIVE"
        ? null
        : loan.renewalCount >= settings.maxRenewals
          ? RENEWAL_REQUEST_MESSAGES.noRenewalsLeft
          : overdue && !settings.allowRenewalWhenOverdue
            ? RENEWAL_REQUEST_MESSAGES.overdue
            : null;

    return {
    code: loan.copy.copyCode,
    title: loan.copy.title.title,
    authors: loan.copy.title.authors,
    coverMediaId: loan.copy.title.coverMediaId,
    status: loan.status,
    issuedAt: loan.issuedAt,
    dueAt: loan.dueAt,
    returnedAt: loan.returnedAt,
    renewalState,
    canAskToKeep: loan.status === "ACTIVE" && renewalState === "none" && askBlockedReason === null,
    askBlockedReason,
    returnAnnouncedAt: loan.returnAnnouncedAt,
    /*
     * Offered on any book they still hold, including a late one and one they
     * have asked to keep. Bringing a book back is the one thing a reader can
     * always do, and a screen that hid the button on an overdue book would be
     * hiding it exactly when the library most wants it pressed.
     */
    canAnnounceReturn: loan.status === "ACTIVE" && loan.returnAnnouncedAt === null,
    /*
     * The donor's thank-you, exactly as it appears on the book's own page.
     *
     * Note what this is NOT: a link between a donor and a borrower. This card
     * belongs to the child holding the book and says who gave it. Nowhere does
     * the application render "donated by X and borrowed by Y" — the borrower
     * side of that sentence does not exist in any donor-facing view, and the
     * donors page has no borrower column to add one to.
     */
    donorAcknowledgement: donorAcknowledgement(loan.copy.donation),
    };
  });

  return {
    active: cards.filter((card) => card.status === "ACTIVE"),
    history: cards.filter((card) => card.status === "RETURNED").slice(0, LOAN_PAGE_SIZES.reader),
    limit: settings.maxActiveLoans,
    renewalPeriodDays: settings.renewalPeriodDays,
  };
}

/**
 * Whether a copy is currently on loan — for the catalogue's own use only.
 *
 * Returns a boolean and nothing else. **There is no function anywhere in this
 * application that answers "who has this book?" to a reader**, and this is the
 * shape that keeps it that way: a child looking at a borrowed book learns that
 * somebody is reading it, which is true, useful, and the end of it. No name, no
 * card number, no due date, no "back on Tuesday" that would let a determined
 * child work out which of their friends has it.
 */
export async function copyIsOnLoan(copyId: string): Promise<boolean> {
  const count = await prisma.loan.count({ where: { copyId, status: "ACTIVE" } });
  return count > 0;
}

/**
 * How many times a work has been borrowed. A number, and nothing else.
 *
 * Asks for no permission, for the same reason `reviewsForTitle` does not: the
 * catalogue's own gate has already been passed by the caller, and what keeps
 * this safe is the projection rather than a check. There is no borrower here,
 * no date, no loan id — nothing that could be joined back to a child.
 *
 * Two rules, and they are the same two the shelf's SQL applies:
 *
 * **Counted across every copy.** A loan points at a physical copy, but the
 * question a reader is asking is about the book. The library's second copy of a
 * title should not split its answer in two.
 *
 * **CANCELLED excluded.** An issue the desk undid a minute later is a
 * correction, not a reading, and counting it would let a mistake at the desk
 * make a book look popular.
 */
export async function borrowCountForTitle(titleId: string): Promise<number> {
  return prisma.loan.count({
    where: { copy: { titleId }, status: { not: "CANCELLED" } },
  });
}

// ---------------------------------------------------------------------------
// Asking for a book
// ---------------------------------------------------------------------------

/**
 * A child asks for a book they have found in the catalogue.
 *
 * The important thing about this function is everything it does not do. No copy
 * changes status. No loan is created. No due date is calculated. Nothing about
 * the library's account of where its books are moves at all — because the book
 * has not moved. It is on a shelf in the library room, and it stays there until
 * a librarian hands it over.
 *
 * That gap is the whole feature. A child browsing on a tablet at home can find
 * a book and say "this one please"; a child standing in the library room can
 * see the book on the shelf and still needs a librarian to issue it. Both are
 * the same request, and neither takes a book home on its own.
 *
 * The checks here are the friendly first pass. They are re-run for real, under
 * row locks, when a librarian approves — because a request made on Tuesday
 * cannot know what is true on Thursday.
 */
export async function requestBorrow(input: { code: string }): Promise<{ title: string }> {
  const actor = await requirePermission("loan.request");
  const { settings } = await getCurrentLibrary();

  // A librarian has no library card. Shaped as not-found rather than
  // not-authorized: there is nothing here for them.
  if (actor.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} is not a member and cannot ask for books`);
  }

  if (!memberMayBorrow(await readerStatus(actor))) {
    throw new RuleViolationError(
      `Member ${actor.userId} may not borrow`,
      BORROW_REQUEST_MESSAGES.accountUnavailable,
    );
  }

  const code = input.code.trim();
  if (!code) {
    throw new RuleViolationError("Borrow requested without a book code", BORROW_REQUEST_MESSAGES.notAvailable);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const [copy] = await tx.$queryRaw<
        { id: string; copy_code: string; status: CopyStatus; condition: CopyCondition; title: string }[]
      >`
        SELECT c.id, c.copy_code, c.status, c.condition, t.title
          FROM book_copy c
          JOIN book_title t ON t.id = c.title_id
         WHERE c.library_id = ${actor.libraryId}
           AND upper(btrim(c.copy_code)) = upper(btrim(${code}))
         FOR UPDATE OF c
      `;

      if (!copy) {
        // One sentence for every miss, so a child typing codes learns nothing
        // about which books exist in a library they cannot see.
        throw new NotFoundError(`Copy ${code} not found in library ${actor.libraryId}`);
      }

      const blocked = copyBlockedReason(copy.status, copy.condition);
      if (blocked) {
        throw new RuleViolationError(
          `Copy ${copy.copy_code} is ${copy.status}/${copy.condition}`,
          BORROW_REQUEST_MESSAGES.notAvailable,
        );
      }

      const alreadyHave = await tx.loan.count({
        where: { copyId: copy.id, memberUserId: actor.userId, status: "ACTIVE" },
      });
      if (alreadyHave > 0) {
        throw new RuleViolationError(
          `Member ${actor.userId} already has copy ${copy.copy_code}`,
          BORROW_REQUEST_MESSAGES.alreadyHaveIt,
        );
      }

      // A pending request is a book the child is expecting, so it counts
      // against the limit exactly as a borrowed one does. Without this, a child
      // could ask for nine books and a librarian would have to be the one to
      // say no eight times.
      const [loans, asks] = await Promise.all([
        tx.loan.count({ where: { memberUserId: actor.userId, status: "ACTIVE" } }),
        tx.borrowRequest.count({ where: { memberUserId: actor.userId, status: "PENDING" } }),
      ]);
      if (loans + asks >= settings.maxActiveLoans) {
        throw new RuleViolationError(
          `Member ${actor.userId} has ${loans} loans and ${asks} pending requests (limit ${settings.maxActiveLoans})`,
          BORROW_REQUEST_MESSAGES.limitReached(settings.maxActiveLoans),
        );
      }

      // Told apart before the index refuses, because "you already asked" and
      // "somebody else did" are different things to read.
      const waiting = await tx.borrowRequest.findFirst({
        where: { copyId: copy.id, status: "PENDING" },
        select: { memberUserId: true },
      });
      if (waiting) {
        throw new ConflictError(
          `Copy ${copy.copy_code} already has a pending request`,
          waiting.memberUserId === actor.userId
            ? BORROW_REQUEST_MESSAGES.alreadyAsked
            : BORROW_REQUEST_MESSAGES.spokenFor,
        );
      }

      const request = await tx.borrowRequest.create({
        data: { copyId: copy.id, memberUserId: actor.userId, status: "PENDING" },
        select: { id: true },
      });

      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BORROW_REQUESTED,
        entityType: "borrow_request",
        entityId: request.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { copyCode: copy.copy_code },
      });

      return { title: copy.title };
    });
  } catch (error) {
    // The index refused a second open request on the same copy. Two children
    // pressed at the same instant; the loser is told the book is spoken for,
    // which is true.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(
        `Copy ${code} already has a pending borrow request`,
        BORROW_REQUEST_MESSAGES.spokenFor,
      );
    }
    throw error;
  }
}

/** The reader's own account status, read fresh rather than trusted from the session. */
async function readerStatus(actor: Actor): Promise<UserStatus> {
  const [row] = await prisma.$queryRaw<{ status: UserStatus }[]>`
    SELECT status FROM app_user
     WHERE id = ${actor.userId} AND library_id = ${actor.libraryId}
  `;
  if (!row) throw new NotFoundError(`User ${actor.userId} not found in library ${actor.libraryId}`);
  return row.status;
}

/**
 * A child changes their mind.
 *
 * Only their own, only while pending, and it deletes nothing: the request
 * becomes CANCELLED and stays, so a librarian who saw it this morning can find
 * out what happened to it.
 */
export async function cancelOwnBorrowRequest(input: { code: string }): Promise<void> {
  const actor = await requirePermission("loan.request");
  if (actor.kind !== "MEMBER") {
    throw new NotFoundError(`User ${actor.userId} is not a member and has no requests of their own`);
  }

  await prisma.$transaction(async (tx) => {
    const [request] = await tx.$queryRaw<{ id: string; copy_code: string }[]>`
      SELECT r.id, c.copy_code
        FROM borrow_request r
        JOIN book_copy c ON c.id = r.copy_id
       WHERE r.status = 'PENDING'
         AND r.member_user_id = ${actor.userId}
         AND c.library_id = ${actor.libraryId}
         AND upper(btrim(c.copy_code)) = upper(btrim(${input.code}))
       FOR UPDATE OF r
    `;

    if (!request) {
      throw new RuleViolationError(
        `No pending borrow request on ${input.code} for member ${actor.userId}`,
        BORROW_REQUEST_MESSAGES.noneToCancel,
      );
    }

    await tx.borrowRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date() },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BORROW_REQUEST_CANCELLED,
      entityType: "borrow_request",
      entityId: request.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: request.copy_code, cancelledByReader: true },
    });
  });
}

export interface BorrowRequestRow {
  requestId: string;
  requestedAt: Date;
  readerName: string;
  memberCode: string;
  title: string;
  /** Presentation only. The same cover id the catalogue already renders. */
  coverMediaId: string | null;
  copyCode: string;
  /** Null when it can be approved; otherwise why it cannot, in staff wording. */
  blockedReason: string | null;
}

/**
 * What is waiting for an answer.
 *
 * Guarded by `loan.issue` — the authority to give a book to a child — and not
 * by `loan.view`, which every reader holds. Scoped to the actor's own library
 * through the copy, since a request row has no library of its own.
 */
export async function listPendingBorrowRequests(): Promise<BorrowRequestRow[]> {
  const actor = await requirePermission("loan.issue");
  const { settings } = await getCurrentLibrary();

  const rows = await prisma.$queryRaw<
    {
      request_id: string;
      requested_at: Date;
      reader_name: string;
      reader_status: UserStatus;
      member_code: string;
      title: string;
      cover_media_id: string | null;
      copy_code: string;
      copy_status: CopyStatus;
      copy_condition: CopyCondition;
      active_loans: bigint;
    }[]
  >`
    SELECT r.id AS request_id, r.requested_at,
           u.display_name AS reader_name, u.status AS reader_status,
           coalesce(m.member_code, '') AS member_code,
           t.title, t.cover_media_id, c.copy_code,
           c.status AS copy_status, c.condition AS copy_condition,
           (SELECT count(*) FROM loan l
             WHERE l.member_user_id = u.id AND l.status = 'ACTIVE') AS active_loans
      FROM borrow_request r
      JOIN book_copy c ON c.id = r.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = r.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE r.status = 'PENDING'
       AND c.library_id = ${actor.libraryId}
     ORDER BY r.requested_at ASC
     LIMIT ${LOAN_PAGE_SIZES.desk}
  `;

  return rows.map((row) => ({
    requestId: row.request_id,
    requestedAt: row.requested_at,
    readerName: row.reader_name,
    memberCode: row.member_code,
    title: row.title,
    coverMediaId: row.cover_media_id,
    copyCode: row.copy_code,
    blockedReason: borrowRequestBlockedReason(row, settings),
  }));
}

/**
 * Why approving this one would be refused, worked out for the list.
 *
 * Advisory only. The decision re-checks all of it under locks, because this
 * answer was true when the page rendered and the desk is a busy place.
 */
function borrowRequestBlockedReason(
  row: {
    reader_name: string;
    reader_status: UserStatus;
    copy_status: CopyStatus;
    copy_condition: CopyCondition;
    active_loans: bigint;
  },
  settings: { maxActiveLoans: number },
): string | null {
  if (!memberMayBorrow(row.reader_status)) return CIRCULATION_MESSAGES.readerUnavailable;
  const copy = copyBlockedReason(row.copy_status, row.copy_condition);
  if (copy) return copy;
  if (Number(row.active_loans) >= settings.maxActiveLoans) {
    return CIRCULATION_MESSAGES.loanLimitReached(row.reader_name, settings.maxActiveLoans);
  }
  return null;
}

/** For the desk's badge. Same scoping as the list, no rows carried. */
export async function countPendingBorrowRequests(): Promise<number> {
  const actor = await requirePermission("loan.issue");

  const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
      FROM borrow_request r
      JOIN book_copy c ON c.id = r.copy_id
     WHERE r.status = 'PENDING'
       AND c.library_id = ${actor.libraryId}
  `;
  return Number(row?.count ?? 0);
}

/**
 * A librarian answers.
 *
 * Approving performs **the issue**, through `issueLockedLoan` — the same code
 * the desk's own Issue button runs, in one transaction with the decision. There
 * is no second way to lend a book in this application, which is the point: the
 * borrowing limit, the ACTIVE-member rule, the copy's condition and the one
 * active loan per copy are all enforced here without this path knowing any of
 * them, because this path has no rules of its own.
 *
 * Order inside the transaction: lock the request, confirm it is still pending,
 * then issue — which locks the member and then the copy, always in that order.
 * Two librarians pressing Approve on the same request queue on the first lock;
 * the second reads a request that is no longer PENDING and is refused.
 *
 * A refused approval leaves the request PENDING, deliberately, exactly as a
 * refused renewal does. The librarian has learnt something the child could not
 * — the book came back damaged, the child already has two out — and the honest
 * next step is theirs to take: decline it with a reason, or fix the problem and
 * approve. Marking it declined on their behalf would attribute a decision to
 * somebody who never made one.
 */
export async function decideBorrowRequest(input: {
  requestId: string;
  decision: "APPROVE" | "DECLINE";
  reason?: string;
}): Promise<{ decision: "APPROVE" | "DECLINE"; readerName: string; title: string; dueAt: Date | null }> {
  const actor = await requirePermission("loan.issue");
  const { settings } = await getCurrentLibrary();

  const reason = (input.reason ?? "").trim();
  if (input.decision === "DECLINE" && reason.length < 3) {
    // A child gets told something, so somebody has to have written something.
    throw new ValidationError(
      { reason: "Please write a short note for the reader." },
      "Borrow request declined without a reason",
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const [request] = await tx.$queryRaw<
        {
          id: string;
          status: string;
          copy_id: string;
          member_user_id: string;
          copy_code: string;
          title: string;
          reader_name: string;
        }[]
      >`
        SELECT r.id, r.status::text AS status, r.copy_id, r.member_user_id,
               c.copy_code, t.title, u.display_name AS reader_name
          FROM borrow_request r
          JOIN book_copy c ON c.id = r.copy_id
          JOIN book_title t ON t.id = c.title_id
          JOIN app_user u ON u.id = r.member_user_id
         WHERE r.id = ${input.requestId}
           AND c.library_id = ${actor.libraryId}
         FOR UPDATE OF r
      `;

      if (!request) {
        throw new NotFoundError(
          `Borrow request ${input.requestId} not found in library ${actor.libraryId}`,
        );
      }
      if (request.status !== "PENDING") {
        throw new RuleViolationError(
          `Borrow request ${request.id} is ${request.status}, not PENDING`,
          "Someone has already answered this one.",
        );
      }

      const decidedAt = new Date();

      if (input.decision === "DECLINE") {
        await tx.borrowRequest.update({
          where: { id: request.id },
          data: {
            status: "DECLINED",
            decidedById: actor.userId,
            decidedAt,
            decisionNote: reason.slice(0, 500),
          },
        });

        await recordAudit(tx, {
          libraryId: actor.libraryId,
          action: AUDIT_ACTIONS.BORROW_REQUEST_DECLINED,
          entityType: "borrow_request",
          entityId: request.id,
          actorUserId: actor.userId,
          actorLabel: actor.displayName,
          metadata: {
            copyCode: request.copy_code,
            memberUserId: request.member_user_id,
            reason: reason.slice(0, 500),
          },
        });

        return {
          decision: "DECLINE" as const,
          readerName: request.reader_name,
          title: request.title,
          dueAt: null,
        };
      }

      const loan = await issueLockedLoan(tx, actor, settings, {
        memberUserId: request.member_user_id,
        copyId: request.copy_id,
      });

      await tx.borrowRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          decidedById: actor.userId,
          decidedAt,
          decisionNote: reason ? reason.slice(0, 500) : null,
          loanId: loan.loanId,
        },
      });

      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BORROW_REQUEST_APPROVED,
        entityType: "borrow_request",
        entityId: request.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: {
          copyCode: request.copy_code,
          memberUserId: request.member_user_id,
          loanId: loan.loanId,
          dueAt: loan.dueAt.toISOString(),
        },
      });

      return {
        decision: "APPROVE" as const,
        readerName: loan.readerName,
        title: loan.title,
        dueAt: loan.dueAt,
      };
    });
  } catch (error) {
    /*
     * An approval the rules turned down is worth a row of its own, written
     * outside the transaction that rolled back — same reasoning as a refused
     * issue. It is the trace of a librarian trying to do something for a child
     * and the library saying no, which is exactly what somebody asks about
     * later.
     */
    if (error instanceof RuleViolationError || error instanceof ConflictError) {
      await recordAudit(prisma, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BORROW_REQUEST_REFUSED,
        entityType: "borrow_request",
        entityId: input.requestId,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { decision: input.decision, reason: error.message },
      }).catch(() => undefined);
    }
    throw error;
  }
}

/** One book a child has asked for, from the child's own side. */
export interface OwnBorrowRequest {
  copyCode: string;
  title: string;
  coverMediaId: string | null;
  state: ReaderBorrowState;
  requestedAt: Date;
  /** The librarian's note, shown only when they declined. */
  decisionNote: string | null;
}

/**
 * The child's own asks.
 *
 * Takes no member id — ownership comes from the session, exactly as
 * `listOwnLoans` does — so there is no argument anybody could pass to see
 * somebody else's. Approved requests are left out: an approved request became a
 * loan, and the child already sees it under their own books.
 */
export async function listOwnBorrowRequests(): Promise<OwnBorrowRequest[]> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return [];

  const rows = await prisma.$queryRaw<
    {
      copy_code: string;
      title: string;
      cover_media_id: string | null;
      status: string;
      requested_at: Date;
      decision_note: string | null;
    }[]
  >`
    SELECT c.copy_code, t.title, t.cover_media_id, r.status::text AS status,
           r.requested_at, r.decision_note
      FROM borrow_request r
      JOIN book_copy c ON c.id = r.copy_id
      JOIN book_title t ON t.id = c.title_id
     WHERE r.member_user_id = ${actor.userId}
       AND c.library_id = ${actor.libraryId}
       AND r.status IN ('PENDING', 'DECLINED')
     ORDER BY r.requested_at DESC
     LIMIT 20
  `;

  return rows.map((row) => ({
    copyCode: row.copy_code,
    title: row.title,
    coverMediaId: row.cover_media_id,
    state: row.status === "PENDING" ? ("pending" as const) : ("declined" as const),
    requestedAt: row.requested_at,
    decisionNote: row.status === "DECLINED" ? row.decision_note : null,
  }));
}

/**
 * What this child may do about this one book, right now.
 *
 * Answers the book page's only question: show the ask button, show "you have
 * asked", show what the librarian said, or show nothing at all. A signed-out
 * visitor and a librarian both get `canAsk: false` and no state — neither has a
 * shelf of their own.
 */
export async function getOwnBorrowStateForCode(code: string): Promise<{
  canAsk: boolean;
  state: ReaderBorrowState;
  decisionNote: string | null;
  alreadyBorrowed: boolean;
  spokenFor: boolean;
}> {
  const none = {
    canAsk: false,
    state: "none" as const,
    decisionNote: null,
    alreadyBorrowed: false,
    spokenFor: false,
  };

  const actor = await getActor();
  if (!actor || actor.kind !== "MEMBER" || !actor.permissions.has("loan.request")) return none;

  const [row] = await prisma.$queryRaw<
    {
      copy_id: string;
      own_status: string | null;
      own_note: string | null;
      pending_by_other: boolean;
      borrowed_by_me: boolean;
    }[]
  >`
    SELECT c.id AS copy_id,
           own.status::text AS own_status,
           own.decision_note AS own_note,
           EXISTS (
             SELECT 1 FROM borrow_request o
              WHERE o.copy_id = c.id AND o.status = 'PENDING'
                AND o.member_user_id <> ${actor.userId}
           ) AS pending_by_other,
           EXISTS (
             SELECT 1 FROM loan l
              WHERE l.copy_id = c.id AND l.status = 'ACTIVE'
                AND l.member_user_id = ${actor.userId}
           ) AS borrowed_by_me
      FROM book_copy c
      LEFT JOIN LATERAL (
        SELECT r.status, r.decision_note
          FROM borrow_request r
         WHERE r.copy_id = c.id AND r.member_user_id = ${actor.userId}
         ORDER BY r.requested_at DESC
         LIMIT 1
      ) own ON true
     WHERE c.library_id = ${actor.libraryId}
       AND upper(btrim(c.copy_code)) = upper(btrim(${code}))
  `;

  if (!row) return none;

  const state: ReaderBorrowState =
    row.own_status === "PENDING"
      ? "pending"
      : row.own_status === "DECLINED"
        ? "declined"
        : row.own_status === "APPROVED"
          ? "approved"
          : "none";

  return {
    // Asking again is allowed after a decline or a cancellation — a child whose
    // book was out last week should be able to ask again this week.
    canAsk: state !== "pending" && !row.borrowed_by_me && !row.pending_by_other,
    state,
    decisionNote: state === "declined" ? row.own_note : null,
    alreadyBorrowed: row.borrowed_by_me,
    spokenFor: row.pending_by_other,
  };
}
