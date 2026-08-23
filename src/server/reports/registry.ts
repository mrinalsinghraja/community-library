import "server-only";

import {
  STATUSES,
  ageGroupLabel,
  conditionLabel,
  isAgeGroup,
  isCondition,
  statusDefinition,
} from "@/lib/catalogue";
import { isLoanFilter } from "@/lib/circulation";
import type { ReportKey } from "@/lib/reports";
import { REPORT_LABELS } from "@/lib/reports";
import { dateOnlyInTimezone, endOfDayInTimezone } from "@/lib/dates";
import type { Actor } from "@/server/authz";
import { getCurrentLibrary } from "@/server/lib/settings";
import type { ReportColumn } from "@/server/reports/table";
import { listAuditEvents } from "@/server/services/audit-service";
import { listMembers } from "@/server/services/account-service";
import { listBooksForStaff, type CatalogueSort } from "@/server/services/catalogue-service";
import {
  listLoansForStaff,
  listPendingBorrowRequests,
  listPendingRenewalRequests,
} from "@/server/services/circulation-service";
import {
  listBookActivity,
  listCirculation,
  listReaderActivity,
  type PeriodQuery,
} from "@/server/services/circulation-reports-service";
import { listRegistrations } from "@/server/services/registration-service";
import { listStaff } from "@/server/services/staff-service";

/**
 * What each report is made of.
 *
 * The single rule this file exists to enforce: **a report is loaded by the
 * service that already owns the screen**. `listBooksForStaff` asks for the
 * catalogue-management permissions; `listMembers` asks for `member.view` and
 * strips guardian contact details itself when the viewer lacks
 * `member.view_contact`. None of that is repeated here, and none of it can
 * drift, because there is only one copy of it.
 *
 * The consequence is worth stating plainly: an export can never show a person
 * something the corresponding screen would not. Adding a report is choosing
 * which existing list to call, not writing a new query — and a new query is
 * exactly how an export feature ends up being the way somebody reads a table
 * they were never allowed to open.
 *
 * Columns may still narrow further where the format changes the stakes. A
 * spreadsheet gets forwarded in a way a screen does not, so a donor who asked
 * to be credited anonymously has that wish carried alongside their name.
 */

/**
 * How many rows one export may contain.
 *
 * A cap, not a page: the point is that a request cannot ask the database for
 * an unbounded result set and then render every row into a PDF inside a
 * serverless function. Well above any real library's list.
 */
export const MAX_EXPORT_ROWS = 5000;

export interface LoadedReport<Row> {
  rows: Row[];
  columns: ReportColumn<Row>[];
  /** Reads the stable identifier a selection checkbox refers to. */
  rowId: (row: Row) => string;
}

/** Filters carried over from the screen, so "export all" means "all of these". */
export type ReportFilter = Record<string, string>;

function text(value: string | null | undefined): string {
  return value ?? "";
}

const USER_STATUS_LABELS: Record<string, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Closed",
  ARCHIVED: "Archived",
};

const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Out",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Waiting",
  UNDER_REVIEW: "Being looked at",
  APPROVED: "Approved",
  REJECTED: "Not accepted",
};

/**
 * The three choices a donor is actually offered, in the words of the choice.
 *
 * Keyed on `DonorDisplayConsent`, whose members are NAMED, APARTMENT_ONLY and
 * ANONYMOUS. Widened to `Record<string, string>` rather than typed against the
 * enum because a service boundary may not import Prisma types; `statusLabel`
 * falls back to the raw value, which is exactly how a wrong key gets noticed —
 * a column reading "APARTMENT_ONLY" is obviously a bug, where a blank is not.
 */
const DONOR_CREDIT_LABELS: Record<string, string> = {
  NAMED: "Happy to be named",
  APARTMENT_ONLY: "Flat only, no name",
  ANONYMOUS: "Asked to stay anonymous",
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  LIBRARIAN: "Librarian",
  JUNIOR_LIBRARIAN: "Junior Librarian",
  MEMBER: "Reader",
  GUARDIAN: "Parent or Guardian",
};

function statusLabel(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "";
  return map[value] ?? value;
}

/**
 * Turns a person's activation state into the words the desk already uses.
 *
 * The screens say "Waiting to set up" rather than "mustSetPassword = true", and
 * an export that says the second one is describing the database to somebody who
 * asked about the library.
 */
function setupState(mustSetPassword: boolean, emailSent: boolean | null): string {
  if (!mustSetPassword) return "Set up";
  if (emailSent === false) return "Waiting to set up — invitation not sent";
  if (emailSent === null) return "Waiting to set up — nothing sent yet";
  return "Waiting to set up";
}

// ---------------------------------------------------------------------------
// The reports
// ---------------------------------------------------------------------------

async function loadBooks(actor: Actor, filter: ReportFilter) {
  /*
   * The filter arrives from the browser and is validated here, exactly as the
   * books screen validates its own query string: anything unrecognised is
   * dropped rather than passed on. The screen's checks are not load-bearing for
   * this path — a request to the export route never goes through the screen —
   * so they have to exist on both sides.
   */
  const sortRaw = filter.sort;
  const sort: CatalogueSort | undefined =
    sortRaw === "title" || sortRaw === "author" || sortRaw === "code" || sortRaw === "newest"
      ? sortRaw
      : undefined;

  const page = await listBooksForStaff({
    search: filter.search || undefined,
    categoryId: filter.category || undefined,
    ageGroup: isAgeGroup(filter.age) ? filter.age : undefined,
    condition: isCondition(filter.condition) ? filter.condition : undefined,
    status: STATUSES.find((entry) => entry.value === filter.status)?.value,
    includeArchived: filter.archived === "1",
    sort,
    page: 1,
    pageSize: MAX_EXPORT_ROWS,
  });

  const seesRealDonor = actor.permissions.has("donation.view_private");
  type Row = (typeof page.items)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Book ID", value: (row) => row.copyCode },
    { header: "Title", value: (row) => row.title, weight: 2.2 },
    { header: "Author", value: (row) => row.authors.join(", "), weight: 1.4 },
    { header: "Shelf", value: (row) => row.categoryName },
    { header: "Age", value: (row) => ageGroupLabel(row.ageGroup) },
    { header: "Condition", value: (row) => conditionLabel(row.condition) },
    { header: "Status", value: (row) => statusDefinition(row.status).staffLabel },
  ];

  if (seesRealDonor) {
    columns.push(
      { header: "Donated by", value: (row) => text(row.donorName), weight: 1.4 },
      { header: "Flat", value: (row) => text(row.donorApartment) },
      /*
       * The donor's own wish travels with their name.
       *
       * On a screen the name is read by the person who opened the page. A
       * spreadsheet is forwarded, and somebody three messages away should not
       * have to guess whether the person in the "Donated by" column agreed to be
       * named. There are no totals and no ranking here, and there never will be.
       */
      {
        header: "Credit",
        value: (row) => statusLabel(DONOR_CREDIT_LABELS, row.donorDisplayConsent),
        weight: 1.2,
      },
      { header: "Donated on", value: (row) => row.donatedAt, dateOnly: true },
    );
  }

  columns.push({ header: "Added on", value: (row) => row.createdAt, dateOnly: true });

  return { rows: page.items, columns, rowId: (row: Row) => row.copyId };
}

async function loadReaders(actor: Actor, filter: ReportFilter) {
  const members = await listMembers({ search: filter.search || undefined });
  const seesContact = actor.permissions.has("member.view_contact");
  type Row = (typeof members)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Card number", value: (row) => text(row.memberProfile?.memberCode) },
    { header: "Name", value: (row) => row.displayName, weight: 1.6 },
    { header: "Flat", value: (row) => text(row.memberProfile?.apartment) },
    // Year only. The library does not hold a birthday to export.
    { header: "Year of birth", value: (row) => row.memberProfile?.birthYear },
    { header: "Status", value: (row) => statusLabel(USER_STATUS_LABELS, row.status) },
    {
      header: "Account",
      value: (row) => setupState(row.mustSetPassword, row.activationEmailSent),
      weight: 1.6,
    },
    { header: "Last signed in", value: (row) => row.lastLoginAt },
    {
      header: "Parent or guardian",
      value: (row) => row.guardianLinks.map((link) => link.guardian.fullName).join(", "),
      weight: 1.6,
    },
  ];

  /*
   * Contact columns appear only for a viewer who may see contact details.
   *
   * `listMembers` has already nulled them out, so leaving the columns in would
   * merely print a page of empty cells — but an empty column still tells a
   * reader of the file that these people have no email address, which is not
   * true. The honest rendering of "you may not see this" is not showing it.
   */
  if (seesContact) {
    columns.push(
      {
        header: "Guardian email",
        value: (row) => row.guardianLinks.map((link) => text(link.guardian.email)).join(", "),
        weight: 1.8,
      },
      {
        header: "Guardian phone",
        value: (row) => row.guardianLinks.map((link) => text(link.guardian.phone)).join(", "),
        weight: 1.2,
      },
    );
  }

  return { rows: members, columns, rowId: (row: Row) => row.id };
}

async function loadStaff() {
  const staff = await listStaff();
  type Row = (typeof staff)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Name", value: (row) => row.displayName, weight: 1.6 },
    { header: "Email", value: (row) => text(row.email), weight: 2 },
    {
      header: "Role",
      value: (row) => row.roleKeys.map((key) => ROLE_LABELS[key] ?? key).join(", "),
    },
    { header: "Status", value: (row) => statusLabel(USER_STATUS_LABELS, row.status) },
    {
      header: "Account",
      value: (row) => setupState(row.mustSetPassword, row.invitationEmailSent),
      weight: 1.8,
    },
    { header: "Added", value: (row) => row.createdAt, dateOnly: true },
    { header: "Last signed in", value: (row) => row.lastLoginAt },
  ];

  return { rows: staff, columns, rowId: (row: Row) => row.id };
}

async function loadLoans(filter: ReportFilter) {
  const page = await listLoansForStaff({
    search: filter.search || undefined,
    filter: isLoanFilter(filter.filter) ? filter.filter : undefined,
    page: 1,
    pageSize: MAX_EXPORT_ROWS,
  });
  type Row = (typeof page.items)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Reader", value: (row) => row.readerName, weight: 1.6 },
    { header: "Card", value: (row) => row.memberCode },
    { header: "Book ID", value: (row) => row.copyCode },
    { header: "Title", value: (row) => row.title, weight: 2.2 },
    { header: "Author", value: (row) => row.authors.join(", "), weight: 1.4 },
    { header: "Issued", value: (row) => row.issuedAt, dateOnly: true },
    { header: "Due", value: (row) => row.dueAt, dateOnly: true },
    { header: "Returned", value: (row) => row.returnedAt, dateOnly: true },
    { header: "Times kept longer", value: (row) => row.renewalCount },
    { header: "Status", value: (row) => statusLabel(LOAN_STATUS_LABELS, row.status) },
  ];

  return { rows: page.items, columns, rowId: (row: Row) => row.loanId };
}

async function loadBorrowRequests() {
  const requests = await listPendingBorrowRequests();
  type Row = (typeof requests)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Asked", value: (row) => row.requestedAt },
    { header: "Reader", value: (row) => row.readerName, weight: 1.6 },
    { header: "Card", value: (row) => row.memberCode },
    { header: "Book ID", value: (row) => row.copyCode },
    { header: "Title", value: (row) => row.title, weight: 2.2 },
    {
      header: "Can it be said yes to?",
      value: (row) => row.blockedReason ?? "Yes",
      weight: 2,
    },
  ];

  return { rows: requests, columns, rowId: (row: Row) => row.requestId };
}

async function loadRenewalRequests() {
  const requests = await listPendingRenewalRequests();
  type Row = (typeof requests)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Asked", value: (row) => row.requestedAt },
    { header: "Reader", value: (row) => row.readerName, weight: 1.6 },
    { header: "Card", value: (row) => row.memberCode },
    { header: "Book ID", value: (row) => row.copyCode },
    { header: "Title", value: (row) => row.title, weight: 2.2 },
    { header: "Due now", value: (row) => row.dueAt, dateOnly: true },
    { header: "Times kept longer", value: (row) => `${row.renewalCount} of ${row.maxRenewals}` },
    {
      header: "Can it be said yes to?",
      value: (row) => row.blockedReason ?? "Yes",
      weight: 2,
    },
  ];

  return { rows: requests, columns, rowId: (row: Row) => row.requestId };
}

async function loadRegistrations(filter: ReportFilter) {
  /*
   * The screen shows what is waiting. "Include decided" widens it to the whole
   * history, which is the one thing an export is more likely to want than a
   * screen is — a year-end list of who joined.
   */
  const requests = await listRegistrations(
    filter.decided === "1"
      ? ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]
      : undefined,
  );
  type Row = (typeof requests)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Sent in", value: (row) => row.submittedAt },
    { header: "Status", value: (row) => statusLabel(REGISTRATION_STATUS_LABELS, row.status) },
    { header: "Child", value: (row) => row.childName, weight: 1.6 },
    { header: "Year of birth", value: (row) => row.childBirthYear },
    { header: "Flat", value: (row) => row.apartment },
    { header: "Parent or guardian", value: (row) => row.guardianName, weight: 1.6 },
    { header: "Guardian email", value: (row) => text(row.guardianEmail), weight: 2 },
    { header: "Guardian phone", value: (row) => text(row.guardianPhone), weight: 1.2 },
    { header: "Permissions given", value: (row) => row.consentComplete },
    {
      header: "Guardian checked",
      value: (row) => (row.verification.satisfied ? "Yes" : "Not yet"),
    },
    { header: "Looked at", value: (row) => row.reviewedAt },
  ];

  return { rows: requests, columns, rowId: (row: Row) => row.id };
}

/**
 * The audit log, one page at a time.
 *
 * The only report that does not export its whole filtered set. `listAuditEvents`
 * pages in SQL and has no "give me everything" mode, and inventing one for an
 * export would mean a second query against the table that exists to be the
 * record of last resort — at a size that grows forever. The screen's own page is
 * what is offered, the toolbar counts only the rows on it, and narrowing by date
 * is how a wider slice is taken.
 */
async function loadAudit(filter: ReportFilter) {
  const page = await listAuditEvents({
    from: filter.from || undefined,
    to: filter.to || undefined,
    action: filter.action || undefined,
    actor: filter.actor || undefined,
    entityType: filter.entityType || undefined,
    page: Number(filter.page) || 1,
  });
  type Row = (typeof page.entries)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "When", value: (row) => row.occurredAt },
    { header: "Who", value: (row) => row.actorLabel, weight: 1.6 },
    { header: "What happened", value: (row) => row.action, weight: 2 },
    { header: "Record", value: (row) => row.entityType, weight: 1.2 },
    /*
     * The details column is JSON and is copied through as text rather than
     * flattened into columns of its own. It differs by action, it is written
     * for an administrator reading one row, and inventing a column per key
     * would produce a spreadsheet a hundred columns wide that is empty almost
     * everywhere.
     */
    {
      header: "Details",
      value: (row) => (row.details === null ? "" : JSON.stringify(row.details)),
      weight: 2.5,
    },
  ];

  return { rows: page.entries, columns, rowId: (row: Row) => row.id };
}

// ---------------------------------------------------------------------------
// The period reports
// ---------------------------------------------------------------------------

/**
 * Turns the two dates the screen carries into the window the services want.
 *
 * The filter arrives from the browser as strings and is resolved here against
 * the library's own timezone, exactly as the screen resolves it — a request to
 * the export route never goes through the screen, so the conversion has to
 * exist on both sides. An unparseable date is dropped rather than passed on,
 * which widens the window rather than narrowing it to nothing.
 */
async function periodFrom(filter: ReportFilter): Promise<PeriodQuery> {
  const { settings } = await getCurrentLibrary();

  const fromDay = filter.from ? dateOnlyInTimezone(filter.from, settings.timezone) : null;
  const toDay = filter.to ? dateOnlyInTimezone(filter.to, settings.timezone) : null;

  return {
    // `dateOnlyInTimezone` already lands on the first instant of the day.
    from: fromDay ?? undefined,
    to: toDay ? endOfDayInTimezone(toDay, settings.timezone) : undefined,
  };
}

const LOAN_PERIOD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Still out",
  RETURNED: "Back",
  CANCELLED: "Cancelled",
};

async function loadCirculation(filter: ReportFilter) {
  const rows = await listCirculation(await periodFrom(filter));
  type Row = (typeof rows)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Issued", value: (row) => row.issuedAt, dateOnly: true },
    { header: "Reader", value: (row) => row.readerName, weight: 1.6 },
    { header: "Card", value: (row) => row.memberCode },
    { header: "Book ID", value: (row) => row.copyCode },
    /*
     * No author column. Eleven columns is what fits an A4 page before headers
     * start truncating to "TIMES KEPT L…", and of the candidates the author is
     * the one nobody needs here: the book ID and the title each identify the
     * book on their own. The books report carries authors; this one is about
     * where books went.
     */
    { header: "Title", value: (row) => row.title, weight: 2.4 },
    { header: "Due", value: (row) => row.dueAt, dateOnly: true },
    { header: "Returned", value: (row) => row.returnedAt, dateOnly: true },
    { header: "Days out", value: (row) => row.daysOut },
    { header: "Kept longer", value: (row) => row.renewalCount },
    /*
     * Status carries lateness for a book that is still out, and "Days late"
     * measures it for every late loan whether it is back or not. Thirteen
     * columns did not fit an A4 page and two of them said the same thing.
     */
    {
      header: "Status",
      value: (row) =>
        row.overdueNow ? "Late" : statusLabel(LOAN_PERIOD_STATUS_LABELS, row.status),
      weight: 1.3,
    },
    { header: "Late by", value: (row) => row.daysLate ?? "" },
  ];

  return { rows, columns, rowId: (row: Row) => row.loanId };
}

async function loadReaderActivity(filter: ReportFilter) {
  const rows = await listReaderActivity(await periodFrom(filter));
  type Row = (typeof rows)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Reader", value: (row) => row.readerName, weight: 1.5 },
    /*
     * Short headings, on purpose.
     *
     * Ten columns of one-character counts are sized by their headings, not
     * their data, and "Books borrowed" / "Times kept longer" / "Average days
     * kept" together want more than an A4 page is wide — at which point the
     * writer has no choice but to shorten all of them and the sheet becomes a
     * row of mysteries. These say the same thing in fewer letters.
     */
    { header: "Card", value: (row) => row.memberCode },
    { header: "Flat", value: (row) => row.apartment },
    { header: "Borrowed", value: (row) => row.borrowed },
    /*
     * Different titles, so a child who renewed one book six times is not
     * reported as having read six books.
     */
    { header: "Different books", value: (row) => row.distinctTitles },
    /*
     * No "back" column. It is exactly "borrowed" minus "still out", and every
     * numeric column here is one or two characters of data under a long
     * heading — so the headings are what set the width, and the eleventh one
     * squeezed "Back" down to "BA…". A derivable column is the right one to
     * lose.
     */
    { header: "Still out", value: (row) => row.stillOut },
    { header: "Late now", value: (row) => row.overdueNow },
    { header: "Kept longer", value: (row) => row.renewals },
    { header: "Days kept", value: (row) => row.averageDaysOut ?? "" },
    /*
     * Last borrowed, not first. Twelve columns did not fit an A4 page, and of
     * the two the last one is the question somebody actually asks — "has this
     * child been in lately" — where the first is only interesting if you
     * already know the answer.
     */
    { header: "Last borrowed", value: (row) => row.lastBorrowedAt, dateOnly: true },
  ];

  return { rows, columns, rowId: (row: Row) => row.memberUserId };
}

async function loadBookActivity(filter: ReportFilter) {
  const rows = await listBookActivity(await periodFrom(filter));
  type Row = (typeof rows)[number];

  const columns: ReportColumn<Row>[] = [
    { header: "Title", value: (row) => row.title, weight: 2.4 },
    { header: "Author", value: (row) => row.authors.join(", "), weight: 1.6 },
    { header: "Shelf", value: (row) => row.categoryName },
    { header: "Copies", value: (row) => row.copies },
    { header: "Times borrowed", value: (row) => row.timesBorrowed },
    { header: "Readers", value: (row) => row.readers },
    { header: "Kept longer", value: (row) => row.renewals },
    { header: "Days kept", value: (row) => row.averageDaysOut ?? "" },
    { header: "Last borrowed", value: (row) => row.lastBorrowedAt, dateOnly: true },
  ];

  return { rows, columns, rowId: (row: Row) => row.titleId };
}

/**
 * Loads one report.
 *
 * Returns `unknown` rows on purpose. Every caller wants to count them, filter
 * them by id and hand them to a writer, and none of them wants to know what a
 * loan looks like — the columns already do. Keeping the row type inside this
 * file is what lets each report define its own shape without the route handler
 * growing a union of eight.
 */
export async function loadReport(
  key: ReportKey,
  actor: Actor,
  filter: ReportFilter,
): Promise<LoadedReport<never>> {
  const loaded = await (async () => {
    switch (key) {
      case "books":
        return loadBooks(actor, filter);
      case "readers":
        return loadReaders(actor, filter);
      case "staff":
        return loadStaff();
      case "loans":
        return loadLoans(filter);
      case "borrow-requests":
        return loadBorrowRequests();
      case "renewal-requests":
        return loadRenewalRequests();
      case "registrations":
        return loadRegistrations(filter);
      case "audit":
        return loadAudit(filter);
      case "circulation":
        return loadCirculation(filter);
      case "reader-activity":
        return loadReaderActivity(filter);
      case "book-activity":
        return loadBookActivity(filter);
    }
  })();

  return loaded as unknown as LoadedReport<never>;
}

export function reportTitle(key: ReportKey): string {
  return REPORT_LABELS[key];
}
