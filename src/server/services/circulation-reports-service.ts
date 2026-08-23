import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { requireAnyPermission, requirePermission } from "@/server/authz";

/**
 * What the library did over a stretch of time.
 *
 * Separate from `circulation-service.ts`, which is the desk: issuing, returning,
 * renewing, and the queues a librarian works through on an afternoon. Nothing
 * here changes anything. These are three questions asked about a period and
 * answered by counting, and keeping them apart from the code that moves books
 * around means a reporting query can never accidentally become a write.
 *
 * **A period means "issued in it".** A loan belongs to the report for the window
 * its `issued_at` falls in, and its return state is reported as it stands today.
 * That is the definition a person means by "how many books went out in August",
 * and it is the only one that does not need a paragraph to explain. Whether a
 * book is *still out* or *late* is a fact about now, not about August, and every
 * column that reports one says so.
 *
 * **Nothing here ranks a child.** The reader report answers "how much is each
 * reader reading", which a librarian genuinely needs, and it answers it in
 * alphabetical order. Sorting children by how many books they have read turns a
 * library into a scoreboard, and a child who reads slowly does not need to
 * appear at the bottom of a list that gets forwarded. The counts are all there;
 * the ordering is not an opinion about who is winning.
 */

const CIRCULATION_DESK = ["loan.issue", "loan.return", "loan.renew"] as const;

/**
 * How many rows one period report may hold. Matches the export cap, because
 * exceeding it is what the export refuses on.
 */
export const MAX_PERIOD_ROWS = 5000;

export interface PeriodQuery {
  /** Both inclusive, already resolved to instants in the library's timezone. */
  from?: Date;
  to?: Date;
}

/** The window, as SQL. Absent ends mean "since the beginning" / "until now". */
function issuedWithin(libraryId: string, query: PeriodQuery): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`l.library_id = ${libraryId}`];
  if (query.from) clauses.push(Prisma.sql`l.issued_at >= ${query.from}`);
  if (query.to) clauses.push(Prisma.sql`l.issued_at <= ${query.to}`);
  return Prisma.join(clauses, " AND ");
}

// ---------------------------------------------------------------------------
// The whole period, in one line
// ---------------------------------------------------------------------------

export interface CirculationSummary {
  /** Loans issued inside the window. */
  issued: number;
  /** Of those, how many have since come back. */
  returned: number;
  /** Of those, how many are still out — a fact about now. */
  stillOut: number;
  /** Of those still out, how many are past their due date right now. */
  overdueNow: number;
  /** Times a book issued in this window was kept longer. */
  renewals: number;
  /** Distinct readers who borrowed at least one book in the window. */
  activeReaders: number;
  /** Distinct copies that went out at least once in the window. */
  booksMoved: number;
}

export async function circulationSummary(query: PeriodQuery = {}): Promise<CirculationSummary> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);
  const where = issuedWithin(actor.libraryId, query);

  const [row] = await prisma.$queryRaw<
    {
      issued: bigint;
      returned: bigint;
      still_out: bigint;
      overdue_now: bigint;
      renewals: bigint | null;
      active_readers: bigint;
      books_moved: bigint;
    }[]
  >`
    SELECT count(*)                                                        AS issued,
           count(*) FILTER (WHERE l.status = 'RETURNED')                   AS returned,
           count(*) FILTER (WHERE l.status = 'ACTIVE')                     AS still_out,
           count(*) FILTER (WHERE l.status = 'ACTIVE' AND l.due_at < now()) AS overdue_now,
           sum(l.renewal_count)                                            AS renewals,
           count(DISTINCT l.member_user_id)                                AS active_readers,
           count(DISTINCT l.copy_id)                                       AS books_moved
      FROM loan l
     WHERE ${where}
  `;

  return {
    issued: Number(row?.issued ?? 0),
    returned: Number(row?.returned ?? 0),
    stillOut: Number(row?.still_out ?? 0),
    overdueNow: Number(row?.overdue_now ?? 0),
    renewals: Number(row?.renewals ?? 0),
    activeReaders: Number(row?.active_readers ?? 0),
    booksMoved: Number(row?.books_moved ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Every loan in the period
// ---------------------------------------------------------------------------

export interface CirculationRow {
  loanId: string;
  readerName: string;
  memberCode: string;
  copyCode: string;
  title: string;
  authors: string[];
  issuedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  renewalCount: number;
  status: string;
  /** Days between issue and return, or issue and now while it is still out. */
  daysOut: number;
  /** True only while the book is out and past its date. A fact about now. */
  overdueNow: boolean;
  /**
   * Days past the due date — counted to the return for a book that is back, and
   * to today for one that is still out. Null when it was not late at all.
   *
   * One column rather than two. An earlier version had "late now" as a yes/no
   * beside "days late when returned", which meant a book three weeks overdue in
   * somebody's bag showed `Yes` and a blank, and the blank read as "not late".
   * Lateness is one fact and it is measured in days.
   */
  daysLate: number | null;
}

export async function listCirculation(query: PeriodQuery = {}): Promise<CirculationRow[]> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);
  const where = issuedWithin(actor.libraryId, query);

  const rows = await prisma.$queryRaw<
    {
      loan_id: string;
      reader_name: string;
      member_code: string;
      copy_code: string;
      title: string;
      authors: string[];
      issued_at: Date;
      due_at: Date;
      returned_at: Date | null;
      renewal_count: number;
      status: string;
      days_out: number;
      overdue_now: boolean;
      days_late: number | null;
    }[]
  >`
    SELECT l.id AS loan_id,
           u.display_name AS reader_name,
           coalesce(m.member_code, '') AS member_code,
           c.copy_code,
           t.title,
           t.authors,
           l.issued_at,
           l.due_at,
           l.returned_at,
           l.renewal_count,
           l.status::text AS status,
           /* Whole days, counted the same way whether the book is back or not. */
           floor(extract(epoch FROM coalesce(l.returned_at, now()) - l.issued_at) / 86400)::int
             AS days_out,
           (l.status = 'ACTIVE' AND l.due_at < now()) AS overdue_now,
           /* Late is late, whether the book is back or still out. */
           CASE
             WHEN coalesce(l.returned_at, now()) > l.due_at
             THEN floor(extract(epoch FROM coalesce(l.returned_at, now()) - l.due_at) / 86400)::int
             ELSE NULL
           END AS days_late
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN app_user u ON u.id = l.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE ${where}
     ORDER BY l.issued_at DESC, u.display_name ASC
     LIMIT ${MAX_PERIOD_ROWS + 1}
  `;

  return rows.map((row) => ({
    loanId: row.loan_id,
    readerName: row.reader_name,
    memberCode: row.member_code,
    copyCode: row.copy_code,
    title: row.title,
    authors: row.authors,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    renewalCount: row.renewal_count,
    status: row.status,
    daysOut: Number(row.days_out ?? 0),
    overdueNow: row.overdue_now,
    daysLate: row.days_late === null ? null : Number(row.days_late),
  }));
}

// ---------------------------------------------------------------------------
// How much each reader is reading
// ---------------------------------------------------------------------------

export interface ReaderActivityRow {
  memberUserId: string;
  readerName: string;
  memberCode: string;
  apartment: string;
  /** Books borrowed inside the window. */
  borrowed: number;
  /** Of those, how many are back. */
  returned: number;
  /** Of those, how many are still out. A fact about now. */
  stillOut: number;
  /** Of those still out, how many are late right now. */
  overdueNow: number;
  renewals: number;
  /** Distinct titles, so three volumes of one series is three but one book twice is one. */
  distinctTitles: number;
  averageDaysOut: number | null;
  firstBorrowedAt: Date | null;
  lastBorrowedAt: Date | null;
}

/**
 * Per reader, ordered by name.
 *
 * `member.view` on top of the desk permissions: this is the readers list wearing
 * a different hat, and the screen that shows names already asks for it.
 *
 * Readers who borrowed nothing in the window are absent rather than listed with
 * a zero. A list of children who did not read anything is not a thing this
 * library needs to be able to print.
 */
export async function listReaderActivity(query: PeriodQuery = {}): Promise<ReaderActivityRow[]> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);
  await requirePermission("member.view");
  const where = issuedWithin(actor.libraryId, query);

  const rows = await prisma.$queryRaw<
    {
      member_user_id: string;
      reader_name: string;
      member_code: string;
      apartment: string;
      borrowed: bigint;
      returned: bigint;
      still_out: bigint;
      overdue_now: bigint;
      renewals: bigint | null;
      distinct_titles: bigint;
      average_days_out: number | null;
      first_borrowed_at: Date | null;
      last_borrowed_at: Date | null;
    }[]
  >`
    SELECT l.member_user_id,
           u.display_name AS reader_name,
           coalesce(m.member_code, '') AS member_code,
           coalesce(m.apartment, '') AS apartment,
           count(*)                                                        AS borrowed,
           count(*) FILTER (WHERE l.status = 'RETURNED')                   AS returned,
           count(*) FILTER (WHERE l.status = 'ACTIVE')                     AS still_out,
           count(*) FILTER (WHERE l.status = 'ACTIVE' AND l.due_at < now()) AS overdue_now,
           sum(l.renewal_count)                                            AS renewals,
           count(DISTINCT c.title_id)                                      AS distinct_titles,
           avg(extract(epoch FROM coalesce(l.returned_at, now()) - l.issued_at) / 86400)
             AS average_days_out,
           min(l.issued_at) AS first_borrowed_at,
           max(l.issued_at) AS last_borrowed_at
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN app_user u ON u.id = l.member_user_id
      LEFT JOIN member_profile m ON m.user_id = u.id
     WHERE ${where}
     GROUP BY l.member_user_id, u.display_name, m.member_code, m.apartment
     /*
      * By name. Never by count. Ordering this by borrowed DESC is one word
      * away and would turn it into a league table of children. The counts are
      * all present for anybody who needs them; the order is not an opinion
      * about who is winning.
      */
     ORDER BY lower(u.display_name) ASC
     LIMIT ${MAX_PERIOD_ROWS + 1}
  `;

  return rows.map((row) => ({
    memberUserId: row.member_user_id,
    readerName: row.reader_name,
    memberCode: row.member_code,
    apartment: row.apartment,
    borrowed: Number(row.borrowed),
    returned: Number(row.returned),
    stillOut: Number(row.still_out),
    overdueNow: Number(row.overdue_now),
    renewals: Number(row.renewals ?? 0),
    distinctTitles: Number(row.distinct_titles),
    averageDaysOut:
      row.average_days_out === null ? null : Math.round(Number(row.average_days_out) * 10) / 10,
    firstBorrowedAt: row.first_borrowed_at,
    lastBorrowedAt: row.last_borrowed_at,
  }));
}

// ---------------------------------------------------------------------------
// How much each book is read
// ---------------------------------------------------------------------------

export interface BookActivityRow {
  titleId: string;
  title: string;
  authors: string[];
  categoryName: string;
  /** Copies of this title the library holds, archived ones excluded. */
  copies: number;
  /** Times any copy went out inside the window. */
  timesBorrowed: number;
  /** Distinct readers who took it. */
  readers: number;
  renewals: number;
  averageDaysOut: number | null;
  lastBorrowedAt: Date | null;
}

/**
 * Per title, most borrowed first.
 *
 * Ranking is right here and wrong for readers, and the difference is the whole
 * reason the two are separate functions. "Which books does this library actually
 * need more copies of" is a question about stock, and the answer is a list in
 * order. A book is not a child.
 */
export async function listBookActivity(query: PeriodQuery = {}): Promise<BookActivityRow[]> {
  const actor = await requireAnyPermission(CIRCULATION_DESK);
  const where = issuedWithin(actor.libraryId, query);

  const rows = await prisma.$queryRaw<
    {
      title_id: string;
      title: string;
      authors: string[];
      category_name: string;
      copies: bigint;
      times_borrowed: bigint;
      readers: bigint;
      renewals: bigint | null;
      average_days_out: number | null;
      last_borrowed_at: Date | null;
    }[]
  >`
    SELECT t.id AS title_id,
           t.title,
           t.authors,
           cat.name AS category_name,
           (SELECT count(*) FROM book_copy bc
             WHERE bc.title_id = t.id AND bc.status <> 'ARCHIVED')          AS copies,
           count(*)                                                         AS times_borrowed,
           count(DISTINCT l.member_user_id)                                 AS readers,
           sum(l.renewal_count)                                             AS renewals,
           avg(extract(epoch FROM coalesce(l.returned_at, now()) - l.issued_at) / 86400)
             AS average_days_out,
           max(l.issued_at) AS last_borrowed_at
      FROM loan l
      JOIN book_copy c ON c.id = l.copy_id
      JOIN book_title t ON t.id = c.title_id
      JOIN book_category cat ON cat.id = t.category_id
     WHERE ${where}
     GROUP BY t.id, t.title, t.authors, cat.name
     ORDER BY count(*) DESC, lower(t.title) ASC
     LIMIT ${MAX_PERIOD_ROWS + 1}
  `;

  return rows.map((row) => ({
    titleId: row.title_id,
    title: row.title,
    authors: row.authors,
    categoryName: row.category_name,
    copies: Number(row.copies),
    timesBorrowed: Number(row.times_borrowed),
    readers: Number(row.readers),
    renewals: Number(row.renewals ?? 0),
    averageDaysOut:
      row.average_days_out === null ? null : Math.round(Number(row.average_days_out) * 10) / 10,
    lastBorrowedAt: row.last_borrowed_at,
  }));
}
