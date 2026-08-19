import type { LoanStatus, UserStatus } from "@prisma/client";

import { daysUntilDue, formatInTimezone } from "@/lib/dates";

/**
 * Circulation's vocabulary, in one place.
 *
 * Isomorphic on purpose (no `server-only`): the service, the React components
 * and the tests all read the same words and the same derivations, so "overdue"
 * cannot mean one thing on the librarian's screen and another on the child's.
 *
 * Two rules shape this whole file.
 *
 * **Overdue is derived, never stored.** There is no OVERDUE column and no
 * OVERDUE loan status. A loan is overdue when it is ACTIVE and its stored due
 * date has passed, evaluated in the library's timezone — which means no failed
 * scheduled job can ever leave the library believing something untrue, and a
 * book becomes overdue at midnight without anything having to run.
 *
 * **The library charges no fines, so the words must not imply one.** A child
 * who is late is not in trouble. Every string below was written to be read by a
 * nine-year-old who already feels bad about it; "YOUR BOOK IS OVERDUE" is
 * exactly the wording this file exists to prevent.
 */

// ---------------------------------------------------------------------------
// Configuration that is real, and configuration that is not
// ---------------------------------------------------------------------------

/**
 * The `library_settings` columns circulation actually reads.
 *
 * Every one of these changes what the software does the moment it is saved.
 */
export const ACTIVE_CIRCULATION_SETTINGS = [
  "borrowingPeriodDays",
  "maxActiveLoans",
  "maxRenewals",
  "renewalPeriodDays",
  "allowRenewalWhenOverdue",
  "timezone",
  // Both implemented in Phase 4, and both left this file's dormant list in the
  // same change that gave them behaviour — which is the rule for that list.
  "overdueRemindersEnabled",
  "overdueReminderOffsets",
] as const;

/**
 * Columns that exist, carry a plausible default, and change nothing.
 *
 * They were laid down in Phase 0 from the blueprint's sketch of a full library
 * system. Phase 3 implemented circulation and deliberately did not give them
 * meaning: `blockOnOverdueDays` would turn a late book into a locked account
 * for a child, and `renewalBlockedWhenReserved` describes reservations that do
 * not exist. Inventing behaviour for either would be inventing policy.
 *
 * `overdueReminderOffsets` was on this list through Phase 3 and is not any
 * more: Phase 4 sends reminders, so it now decides when they go out. That is
 * the only way a key leaves this list — implemented, in the same change.
 *
 * The list exists so a settings screen — there is none yet — cannot render one
 * of these beside a working control and leave a librarian believing they have
 * changed how the library behaves. A field that looks like a rule and is not
 * one is worse than an absent feature: it is a promise the software breaks
 * silently. Anything here must either be hidden, or labelled as not yet in
 * effect, or implemented and removed from this list.
 */
export const DORMANT_CIRCULATION_SETTINGS = [
  "blockOnOverdueDays",
  "renewalBlockedWhenReserved",
  // Sketched as a master switch over all outbound mail. Still unwired, and
  // deliberately: it defaults to false, and a false that quietly stopped
  // activation links would lock families out of the library with nothing on
  // screen to explain it. What actually decides whether mail leaves this server
  // is which provider is configured.
  "emailEnabled",
] as const;

export type DormantCirculationSetting = (typeof DORMANT_CIRCULATION_SETTINGS)[number];

// ---------------------------------------------------------------------------
// Who may borrow
// ---------------------------------------------------------------------------

/**
 * The account states that may take a book home. There is one.
 *
 * Written as a list of what is **allowed** rather than a list of what is
 * blocked, and the difference matters more than it looks. A denylist has to be
 * kept in step with the enum: add a state to `UserStatus` and forget to add it
 * here, and the new state silently gains the right to borrow. An allowlist
 * fails the other way — the new state cannot borrow until somebody decides it
 * should, in this file, on purpose.
 *
 * INVITED is not on the list. An invited account is one whose guardian has not
 * finished setting it up, so nobody has yet confirmed that this child is
 * enrolled on the terms the family agreed to. Handing over a book first and
 * completing the paperwork later is precisely the ordering a children's library
 * should not adopt. The remedy is quick and it is the librarian's to apply:
 * finish the activation, then lend the book.
 */
export const BORROWING_ALLOWED_STATUSES: readonly UserStatus[] = ["ACTIVE"];

/**
 * May this account borrow?
 *
 * The whole rule, in one place, used by the desk's preview and by the two
 * writes that matter. A screen may call it to explain a refusal early; it is
 * never what enforces it — `issueBook` and `renewLoan` re-check inside their
 * transactions, after locking the row, because the answer can change between
 * the render and the click.
 */
export function memberMayBorrow(status: UserStatus): boolean {
  return BORROWING_ALLOWED_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Loan status
// ---------------------------------------------------------------------------

export interface LoanStatusDefinition {
  value: LoanStatus;
  /** Wording for the librarian's screens: factual, dense, scannable. */
  staffLabel: string;
  /** Wording for a child. Warmer, and never about the library's paperwork. */
  readerLabel: string;
}

export const LOAN_STATUSES: readonly LoanStatusDefinition[] = [
  { value: "ACTIVE", staffLabel: "Out", readerLabel: "You have this one" },
  { value: "RETURNED", staffLabel: "Returned", readerLabel: "Brought back" },
  // A child never sees this word on their own screen — a cancelled loan is one
  // that should not have existed, and the reader's list simply does not
  // contain it. The label exists for the desk's history view.
  { value: "CANCELLED", staffLabel: "Cancelled", readerLabel: "Cancelled" },
] as const;

export function loanStatusDefinition(value: LoanStatus): LoanStatusDefinition {
  const found = LOAN_STATUSES.find((entry) => entry.value === value);
  // Throwing rather than falling back: an unknown status means the enum and
  // this file have drifted, and a silent "Unknown" would hide it.
  if (!found) throw new Error(`Unknown loan status: ${value}`);
  return found;
}

// ---------------------------------------------------------------------------
// The derived condition
// ---------------------------------------------------------------------------

/**
 * What a loan actually *is* right now, as opposed to what the row says.
 *
 * `dueSoon` is a presentation nicety and nothing depends on it. `overdue` is
 * the one that matters, and it is computed here so that the desk's filter, the
 * child's card and the tests cannot disagree about it.
 */
export type LoanCondition = "active" | "dueSoon" | "overdue" | "returned" | "cancelled";

/** How many days before the due date the desk starts flagging a loan. */
export const DUE_SOON_DAYS = 2;

export function loanCondition(
  loan: { status: LoanStatus; dueAt: Date },
  timezone: string,
  now: Date = new Date(),
): LoanCondition {
  // A returned book is never *currently* overdue, however late it came back.
  // Whatever happened, it is over. This ordering is the rule.
  if (loan.status === "RETURNED") return "returned";
  if (loan.status === "CANCELLED") return "cancelled";

  const days = daysUntilDue(loan.dueAt, timezone, now);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "dueSoon";
  return "active";
}

/**
 * Whole days a loan is past its due date. Zero when it is not.
 *
 * Derived at read time from the stored due date, never persisted. "Days
 * overdue" written into a column would be wrong by morning.
 */
export function daysOverdue(
  loan: { status: LoanStatus; dueAt: Date },
  timezone: string,
  now: Date = new Date(),
): number {
  if (loan.status !== "ACTIVE") return 0;
  const days = daysUntilDue(loan.dueAt, timezone, now);
  return days < 0 ? -days : 0;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export type LoanTone = "available" | "out" | "soon" | "late" | "neutral";

/** The badge a child sees on one of their books. Word first, colour second. */
export function readerLoanBadge(
  loan: { status: LoanStatus; dueAt: Date },
  timezone: string,
  now: Date = new Date(),
): { tone: LoanTone; mark: string; label: string } {
  switch (loanCondition(loan, timezone, now)) {
    case "overdue":
      // Not "LATE", not a red exclamation, not a number of days. The book is
      // ready to come home; that is the whole message.
      return { tone: "late", mark: "🏠", label: "Ready to come home" };
    case "dueSoon":
      return { tone: "soon", mark: "📖", label: "Back soon" };
    case "returned":
      return { tone: "out", mark: "✅", label: "Brought back" };
    case "cancelled":
      return { tone: "neutral", mark: "—", label: "Cancelled" };
    case "active":
      return { tone: "available", mark: "📚", label: "You have this one" };
  }
}

/**
 * The sentence under a child's book card.
 *
 * The overdue case names the date and asks, once, kindly. It does not count
 * days, does not scold, and does not mention a consequence, because there is
 * no consequence: this library has no fines and never will.
 */
export function readerDueSentence(
  loan: { status: LoanStatus; dueAt: Date; returnedAt?: Date | null },
  timezone: string,
  now: Date = new Date(),
): string {
  const due = formatInTimezone(loan.dueAt, timezone, "d MMM");

  switch (loanCondition(loan, timezone, now)) {
    case "overdue":
      return `This book was due back on ${due}. Please return it when you can.`;
    case "dueSoon": {
      const days = daysUntilDue(loan.dueAt, timezone, now);
      if (days === 0) return "Please bring this one back today.";
      if (days === 1) return "Please bring this one back tomorrow.";
      return `Please bring this one back by ${due}.`;
    }
    case "returned":
      return loan.returnedAt
        ? `Brought back on ${formatInTimezone(loan.returnedAt, timezone, "d MMM yyyy")}.`
        : "Brought back.";
    case "cancelled":
      return "This borrowing was cancelled.";
    case "active":
      return `Yours until ${due}.`;
  }
}

/**
 * The librarian's summary of an overdue loan. Days are fine here — this is an
 * operational screen, and the person reading it is deciding who to remind.
 */
export function staffOverdueSummary(
  loan: { status: LoanStatus; dueAt: Date },
  timezone: string,
  now: Date = new Date(),
): string | null {
  const days = daysOverdue(loan, timezone, now);
  if (days === 0) return null;
  return days === 1 ? "1 day over" : `${days} days over`;
}

// ---------------------------------------------------------------------------
// Refusal messages
// ---------------------------------------------------------------------------

/**
 * Why an issue was refused, in words a librarian can act on and a child can
 * hear without being embarrassed.
 *
 * Every one of these is generated from configuration, never from a literal —
 * `maxActiveLoans` is a row in `library_settings`, so a library that allows
 * four books gets a message that says four.
 *
 * None of them expose internal state: no ids, no table names, no account
 * status, no reason a member is suspended. "This library account is currently
 * unavailable for borrowing" is the whole truth a desk needs; why is a
 * conversation, not a tooltip.
 */
export const CIRCULATION_MESSAGES = {
  loanLimitReached: (readerName: string, limit: number): string =>
    limit === 1
      ? `${readerName} already has a book borrowed. Please return it before borrowing another.`
      : `${readerName} already has ${limit} books borrowed. Please return one before borrowing another.`,

  readerUnavailable: "This library account is currently unavailable for borrowing.",

  bookNotAvailable: "This book is not on the shelf right now.",
  bookIsLost: "This book is marked as missing. Find it and put it back on the shelf first.",
  bookIsDamaged:
    "This book is marked as damaged. Mend it and change its condition before lending it out.",
  bookIsArchived: "This book is no longer part of the library.",
  bookAlreadyOut: "Someone just got there first — this book is already out.",

  loanNotActive: "That book has already been brought back.",
  renewalLimitReached: (limit: number): string =>
    limit === 0
      ? "This library does not extend loans."
      : limit === 1
        ? "This book has already been kept for longer once. Please bring it back to the desk."
        : `This book has already been kept for longer ${limit} times. Please bring it back to the desk.`,
  renewalBlockedByOverdue:
    "This book is past its date, so it cannot be kept for longer. Bring it to the desk and it can go straight back out.",
} as const;

// ---------------------------------------------------------------------------
// Asking to keep a book
// ---------------------------------------------------------------------------

/**
 * Why a child cannot ask to keep this one, in words written for the child.
 *
 * The same rules the desk enforces, said differently. A librarian reading
 * "This book has already been kept for longer once" is being told a policy; a
 * nine-year-old reading their own screen is being told what to do next, which
 * is always the same thing — bring it back, ask at the desk, nobody is cross.
 *
 * Nothing here names an account state. A child whose account has been paused
 * sees "Ask the librarian", not "SUSPENDED", for the same reason the desk sees
 * one generic sentence: why an account is paused is a conversation with a
 * family, not a label on a screen.
 */
export const RENEWAL_REQUEST_MESSAGES = {
  invitation: "You can ask the librarian to keep this book for another",
  pending: "You've asked the librarian. They will let you know.",
  approved: "The librarian said yes! You can keep this one longer.",
  declined: "Please bring this one back — the librarian would like it in.",

  alreadyAsked: "You have already asked about this book. The librarian will see it.",
  noRenewalsLeft: "You have already kept this one for longer once. Please bring it back.",
  overdue: "This one was due back already. Please bring it in — you can borrow it again after.",
  notYours: "We could not find that book on your shelf.",
  accountUnavailable: "Please ask the librarian about your library card.",
  noneToCancel: "There is nothing to cancel for this book.",
  cancelled: "That is fine — we have taken your question away.",
} as const;

/** What a child is told about their own request, if they have one open. */
export type ReaderRenewalState = "none" | "pending" | "approved" | "declined";

/**
 * The sentence offering the ask, built from configuration.
 *
 * A library that extends loans by seven days must not show a child the number
 * fourteen, so the period is passed in from `library_settings` and never
 * written here.
 */
export function renewalInvitation(renewalPeriodDays: number): string {
  return renewalPeriodDays === 1
    ? "You can ask the librarian to keep this book for one more day."
    : `You can ask the librarian to keep this book for another ${renewalPeriodDays} days.`;
}

// ---------------------------------------------------------------------------
// Asking for a book
// ---------------------------------------------------------------------------

/**
 * Why a child cannot ask for this one, in words written for the child.
 *
 * Same discipline as the renewal messages: what to do next, never which rule,
 * and never an account state. The one idea every sentence here has to carry is
 * that finding a book is not the same as having it — the book is on a shelf in
 * the library room until a librarian hands it over.
 */
export const BORROW_REQUEST_MESSAGES = {
  invitation: "Ask the librarian for this book",
  pending: "You've asked for this one. The librarian will bring it to you.",
  approved: "It's yours! Collect it from the library room.",
  declined: "The librarian could not lend this one just now.",

  alreadyAsked: "You have already asked for this book. The librarian will see it.",
  spokenFor: "Someone has already asked for this one. Try again in a few days.",
  notAvailable: "This book is not on the shelf right now.",
  alreadyHaveIt: "This one is already on your shelf.",
  limitReached: (limit: number): string =>
    limit === 1
      ? "You have a book out already. Bring it back and you can ask for another."
      : `You can have ${limit} books at a time. Bring one back and you can ask for another.`,
  accountUnavailable: "Please ask the librarian about your library card.",
  noneToCancel: "There is nothing to cancel for this book.",
  cancelled: "That is fine — we have taken your question away.",

  /**
   * The sentence that has to appear wherever a child can ask, because it is the
   * rule the software cannot enforce: the shelves are in a room, and a book
   * leaves it when a librarian says so.
   */
  collectionNote:
    "Books stay in the library room until the librarian hands one over. Please do not take a book home before then.",
} as const;

/** What a child is told about their own request for a book, if they have one. */
export type ReaderBorrowState = "none" | "pending" | "approved" | "declined";

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/**
 * One page of loans, always. Filtering, counting and paging happen in
 * PostgreSQL — the desk is never handed every loan the library has ever made
 * and asked to sort them.
 */
export const LOAN_PAGE_SIZES = {
  /** Dense staff table. */
  desk: 25,
  /** Search results while issuing: enough to pick from, few enough to scan. */
  picker: 8,
  /** A child's own history, as cards. */
  reader: 20,
} as const;

/** The desk's list filters. Anything else in the query string is ignored. */
export const LOAN_FILTERS = ["active", "overdue", "returned"] as const;
export type LoanFilter = (typeof LOAN_FILTERS)[number];

export function isLoanFilter(value: unknown): value is LoanFilter {
  return LOAN_FILTERS.includes(value as LoanFilter);
}
