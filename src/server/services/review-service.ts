import "server-only";

import type { ReviewAttribution } from "@prisma/client";

import {
  NO_RATINGS,
  REVIEW_MAX_CHARS,
  REVIEW_MAX_WORDS,
  REVIEW_MESSAGES,
  REVIEW_REMINDER_DAYS,
  countWords,
  isRating,
  normaliseReviewText,
  type RatingSummary,
} from "@/lib/reviews";
import { getActor, requireActor, requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";

/**
 * What readers thought of the books.
 *
 * Four rules hold this together. Each is here because the obvious version of a
 * ratings feature breaks one of them.
 *
 *  1. **You may rate a book you have taken home, and only that.** Not a book
 *     you asked for, not a book you looked at — one you actually borrowed. The
 *     check is a join against `loan`, made on every write, and it is the single
 *     reason these numbers mean anything.
 *
 *  2. **One opinion per reader per work.** Not per loan and not per copy. A
 *     child who borrowed Matilda three times has one view of Matilda, and
 *     writing again edits what they already said. Without this, the way to give
 *     a book five stars five times would be to borrow it five times, which is a
 *     thing a nine-year-old would work out by the end of the week.
 *
 *  3. **A first name, or nothing.** No surface here returns a display name, a
 *     member code, a flat or an id. The public shape carries a first name that
 *     the reader chose to publish, or the words "A reader at the library" — and
 *     the choice is per review, because it is not the same answer every time.
 *
 *  4. **A librarian can take a review down, and taking it down is not a
 *     punishment.** A hidden review leaves every public list and every average,
 *     but still belongs to its author and still counts as rated: the reminder
 *     does not come back to ask a child to rewrite something a grown-up removed.
 *
 * Moderation is deliberately after the fact. See the note on the model in
 * `prisma/schema.prisma` for why a pre-approval queue was rejected.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One published review, as any reader — signed in or not — may see it. */
export interface PublicReview {
  /** Opaque, and only so React has a key. Not a member id. */
  id: string;
  rating: number;
  review: string | null;
  /** Already resolved through `attribution`. Never a full name. */
  byline: string;
  createdAt: Date;
}

/** A child's own review, on their own history screen. */
export interface OwnReview {
  id: string;
  rating: number;
  review: string | null;
  attribution: ReviewAttribution;
  /** True when a librarian has taken it down. Only the author is told. */
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  authors: string[];
  coverMediaId: string | null;
  /** A copy of this work, so the history can link to the book's page. */
  code: string | null;
}

/** A book brought back and not yet rated, inside the reminder window. */
export interface ReviewPrompt {
  code: string;
  title: string;
  authors: string[];
  coverMediaId: string | null;
  returnedAt: Date;
}

/** One review on the librarian's moderation screen. */
export interface StaffReview {
  id: string;
  rating: number;
  review: string | null;
  attribution: ReviewAttribution;
  createdAt: Date;
  hiddenAt: Date | null;
  hiddenReason: string | null;
  title: string;
  code: string | null;
  /*
   * The desk sees who wrote it. That is not a leak: a librarian already holds
   * `member.view` and can open the member's own page. It is here because
   * moderating anonymous text is how a librarian ends up unable to have a quiet
   * word with the child who wrote it.
   */
  authorName: string;
  authorMemberCode: string | null;
}

// ---------------------------------------------------------------------------
// Reading — the aggregate
// ---------------------------------------------------------------------------

/**
 * The rating for one work.
 *
 * Derived on every read, never stored. A cached average on `book_title` would
 * have to be recomputed on write, would drift the first time a review was
 * hidden, and would be one more column able to disagree with the truth.
 */
export async function ratingForTitle(titleId: string): Promise<RatingSummary> {
  const rows = await prisma.bookReview.aggregate({
    where: { titleId, hiddenAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const count = rows._count._all;
  if (count === 0) return NO_RATINGS;

  return { average: rows._avg.rating ?? 0, count };
}

/**
 * Every published review of one work, newest first.
 *
 * Public: no permission is asked for here, because the catalogue's own gate has
 * already been passed by the caller. What keeps this safe is the projection —
 * a first name resolved through the reader's own choice, and nothing else about
 * them leaves the server.
 */
export async function reviewsForTitle(titleId: string, take = 50): Promise<PublicReview[]> {
  const rows = await prisma.bookReview.findMany({
    where: { titleId, hiddenAt: null },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: {
      id: true,
      rating: true,
      review: true,
      attribution: true,
      createdAt: true,
      member: { select: { displayName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    review: row.review,
    byline: publicByline(row.attribution, row.member.displayName),
    createdAt: row.createdAt,
  }));
}

/**
 * A first name, or nobody.
 *
 * The only function in the application that turns a stored display name into
 * something a stranger may read, and it is deliberately blunt: take the first
 * whitespace-separated word and throw the rest away. A child called "Aarav
 * Menon" is published as "Aarav"; there is no code path here that can emit the
 * surname, whatever the display name happens to hold.
 */
function publicByline(attribution: ReviewAttribution, displayName: string): string {
  if (attribution === "ANONYMOUS") return REVIEW_MESSAGES.anonymousByline;
  const first = displayName.trim().split(/\s+/)[0];
  return first || REVIEW_MESSAGES.anonymousByline;
}

// ---------------------------------------------------------------------------
// Reading — one reader's own
// ---------------------------------------------------------------------------

/**
 * Everything this child has ever said about a book.
 *
 * Takes no member id. It reads the session, exactly like `listOwnLoans`, so
 * there is no parameter for a curious reader to change and no ownership check
 * for a future edit to forget.
 */
export async function listOwnReviews(): Promise<OwnReview[] | null> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return null;

  const rows = await prisma.bookReview.findMany({
    where: { memberUserId: actor.userId, libraryId: actor.libraryId },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      rating: true,
      review: true,
      attribution: true,
      hiddenAt: true,
      createdAt: true,
      updatedAt: true,
      title: {
        select: {
          title: true,
          authors: true,
          coverMediaId: true,
          // Any live copy will do: the reader's page links to the work, and one
          // code is as good as another for getting there.
          copies: {
            where: { status: { not: "ARCHIVED" } },
            orderBy: { copyCode: "asc" },
            take: 1,
            select: { copyCode: true },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    review: row.review,
    attribution: row.attribution,
    hidden: row.hiddenAt !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title.title,
    authors: row.title.authors,
    coverMediaId: row.title.coverMediaId,
    code: row.title.copies.at(0)?.copyCode ?? null,
  }));
}

/**
 * Books brought back and not yet rated — the reminder.
 *
 * The window opens the day the book goes back and closes sixty days later. Two
 * decisions worth keeping:
 *
 *   * **It starts at once, not two months later.** A fourteen-day loan asked
 *     about after two months is a question about a book nobody remembers.
 *   * **It closes for good.** A prompt that never expires stops being a nudge
 *     and becomes a list of chores a child can never finish, and a screen that
 *     always has an unfinished task on it is a screen they stop opening.
 *
 * De-duplicated by work, not by loan: three borrowings of the same book that
 * was never rated is one thing to ask about, not three.
 */
export async function pendingReviewPrompts(now = new Date()): Promise<ReviewPrompt[]> {
  const actor = await getActor();
  if (!actor || actor.kind !== "MEMBER") return [];

  const since = new Date(now.getTime() - REVIEW_REMINDER_DAYS * 24 * 60 * 60 * 1000);

  const loans = await prisma.loan.findMany({
    where: {
      memberUserId: actor.userId,
      libraryId: actor.libraryId,
      status: "RETURNED",
      returnedAt: { gte: since },
      /*
       * The work has no review by this reader. Expressed against the title
       * rather than the loan, so a child who rated Matilda after borrowing it
       * in March is not asked again about the July borrowing of the same book.
       */
      copy: {
        title: {
          reviews: { none: { memberUserId: actor.userId } },
        },
      },
    },
    orderBy: { returnedAt: "desc" },
    select: {
      returnedAt: true,
      copy: {
        select: {
          copyCode: true,
          titleId: true,
          title: { select: { title: true, authors: true, coverMediaId: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const prompts: ReviewPrompt[] = [];

  for (const loan of loans) {
    if (seen.has(loan.copy.titleId)) continue;
    seen.add(loan.copy.titleId);
    prompts.push({
      code: loan.copy.copyCode,
      title: loan.copy.title.title,
      authors: loan.copy.title.authors,
      coverMediaId: loan.copy.title.coverMediaId,
      // `returnedAt` cannot be null on a RETURNED loan; the filter above has
      // already required it to be inside the window.
      returnedAt: loan.returnedAt as Date,
    });
  }

  return prompts;
}

/**
 * What this reader may do about one particular book.
 *
 * Answers the book page's question — show a composer, show what they already
 * wrote, or show nothing at all — in one round trip, from the session. A
 * signed-out visitor and a librarian both get `canReview: false`, which renders
 * no control rather than a disabled one.
 */
export interface OwnReviewState {
  canReview: boolean;
  mine: {
    rating: number;
    review: string | null;
    attribution: ReviewAttribution;
    hidden: boolean;
  } | null;
}

export async function getOwnReviewStateForCode(code: string): Promise<OwnReviewState> {
  const actor = await getActor();
  if (!actor || actor.kind !== "MEMBER") return { canReview: false, mine: null };

  const copy = await prisma.bookCopy.findFirst({
    where: { libraryId: actor.libraryId, copyCode: { equals: code.trim(), mode: "insensitive" } },
    select: { titleId: true },
  });
  if (!copy) return { canReview: false, mine: null };

  const [borrowed, mine] = await Promise.all([
    hasBorrowedTitle(actor.userId, copy.titleId),
    prisma.bookReview.findUnique({
      where: { memberUserId_titleId: { memberUserId: actor.userId, titleId: copy.titleId } },
      select: { rating: true, review: true, attribution: true, hiddenAt: true },
    }),
  ]);

  return {
    canReview: borrowed,
    mine: mine
      ? {
          rating: mine.rating,
          review: mine.review,
          attribution: mine.attribution,
          hidden: mine.hiddenAt !== null,
        }
      : null,
  };
}

/** Has this reader ever had a copy of this work in their bag? */
async function hasBorrowedTitle(memberUserId: string, titleId: string): Promise<boolean> {
  const loan = await prisma.loan.findFirst({
    where: {
      memberUserId,
      status: { in: ["ACTIVE", "RETURNED"] },
      copy: { titleId },
    },
    select: { id: true },
  });
  return loan !== null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface ReviewInput {
  /** The code printed on the book's own label. Never a database id. */
  code: string;
  rating: number;
  review?: string | null;
  attribution?: ReviewAttribution;
}

/**
 * Record what a reader thought.
 *
 * Upsert on (member, work): the first time it writes a row, and every time
 * after that it edits the same one. There is no history of revisions and no
 * append — a child changing their mind about a book has one opinion, not two.
 *
 * The loan is looked up rather than passed in. Which borrowing earned the right
 * to review is the library's business, not the browser's, and taking it from
 * the form would be a field worth tampering with.
 */
export async function submitReview(input: ReviewInput): Promise<void> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") {
    throw new RuleViolationError(
      `User ${actor.userId} is not a member and cannot rate a book`,
      "Only a reader with a library card can rate a book.",
    );
  }

  const fieldErrors: Record<string, string> = {};

  if (!isRating(input.rating)) fieldErrors.rating = REVIEW_MESSAGES.needRating;

  const text = normaliseReviewText(input.review);
  if (text && countWords(text) > REVIEW_MAX_WORDS) fieldErrors.review = REVIEW_MESSAGES.tooLong;
  // The character backstop, matching the database CHECK exactly. A hundred
  // ordinary words never reach it; one pasted 4,000-letter "word" does.
  if (text && text.length > REVIEW_MAX_CHARS) fieldErrors.review = REVIEW_MESSAGES.tooLong;

  if (Object.keys(fieldErrors).length > 0) throw new ValidationError(fieldErrors);

  const copy = await prisma.bookCopy.findFirst({
    where: {
      libraryId: actor.libraryId,
      copyCode: { equals: input.code.trim(), mode: "insensitive" },
    },
    select: { titleId: true },
  });
  if (!copy) throw new NotFoundError(`No book with code ${input.code}`);

  /*
   * The loan that earns the right, newest first. Its absence is the refusal:
   * a book you have not borrowed is a book you may not rate, whatever the form
   * says. ACTIVE counts as well as RETURNED — a child halfway through a book
   * they love should not have to give it back before saying so.
   */
  const loan = await prisma.loan.findFirst({
    where: {
      memberUserId: actor.userId,
      libraryId: actor.libraryId,
      status: { in: ["ACTIVE", "RETURNED"] },
      copy: { titleId: copy.titleId },
    },
    orderBy: { issuedAt: "desc" },
    select: { id: true },
  });

  if (!loan) {
    throw new RuleViolationError(
      `User ${actor.userId} has never borrowed title ${copy.titleId}`,
      REVIEW_MESSAGES.notBorrowed,
    );
  }

  const attribution: ReviewAttribution = input.attribution ?? "FIRST_NAME";

  await prisma.bookReview.upsert({
    where: { memberUserId_titleId: { memberUserId: actor.userId, titleId: copy.titleId } },
    create: {
      libraryId: actor.libraryId,
      titleId: copy.titleId,
      memberUserId: actor.userId,
      loanId: loan.id,
      rating: input.rating,
      review: text,
      attribution,
    },
    /*
     * `hiddenAt` is deliberately not cleared. A child editing a review a
     * librarian took down does not put it back up — a grown-up made that
     * decision and only a grown-up reverses it.
     */
    update: { rating: input.rating, review: text, attribution },
  });
}

/** A reader taking back what they said. Their row goes; nothing is kept. */
export async function deleteOwnReview(code: string): Promise<void> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") {
    throw new RuleViolationError(
      `User ${actor.userId} is not a member and has no reviews`,
      "Only a reader with a library card can do this.",
    );
  }

  const copy = await prisma.bookCopy.findFirst({
    where: { libraryId: actor.libraryId, copyCode: { equals: code.trim(), mode: "insensitive" } },
    select: { titleId: true },
  });
  if (!copy) throw new NotFoundError(`No book with code ${code}`);

  await prisma.bookReview.deleteMany({
    where: { memberUserId: actor.userId, titleId: copy.titleId },
  });
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

/**
 * Every review in the library, newest first, for the one screen that moderates
 * them.
 *
 * Guarded by `book.edit` rather than by a new permission. Somebody who may
 * change what a book's page says is the same person who may decide what stays
 * on it, and a role model grows a key for every screen if you let it.
 */
export async function listReviewsForStaff(options: { onlyWithWords?: boolean } = {}): Promise<
  StaffReview[]
> {
  const actor = await requirePermission("book.edit");

  const rows = await prisma.bookReview.findMany({
    where: {
      libraryId: actor.libraryId,
      ...(options.onlyWithWords ? { review: { not: null } } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      rating: true,
      review: true,
      attribution: true,
      createdAt: true,
      hiddenAt: true,
      hiddenReason: true,
      member: {
        select: { displayName: true, memberProfile: { select: { memberCode: true } } },
      },
      title: {
        select: {
          title: true,
          copies: {
            where: { status: { not: "ARCHIVED" } },
            orderBy: { copyCode: "asc" },
            take: 1,
            select: { copyCode: true },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    review: row.review,
    attribution: row.attribution,
    createdAt: row.createdAt,
    hiddenAt: row.hiddenAt,
    hiddenReason: row.hiddenReason,
    title: row.title.title,
    code: row.title.copies.at(0)?.copyCode ?? null,
    authorName: row.member.displayName,
    authorMemberCode: row.member.memberProfile?.memberCode ?? null,
  }));
}

/**
 * Take a review down, or put it back.
 *
 * Audited both ways. Removing a child's words from a public page is the kind of
 * decision that should have a name and a time against it — both for the family
 * who asks why, and for the librarian who did it and needs to be able to say
 * so.
 */
export async function setReviewHidden(
  reviewId: string,
  hidden: boolean,
  reason?: string,
): Promise<void> {
  const actor = await requirePermission("book.edit");

  const review = await prisma.bookReview.findFirst({
    where: { id: reviewId, libraryId: actor.libraryId },
    select: { id: true, titleId: true },
  });
  if (!review) throw new NotFoundError(`No review ${reviewId} in library ${actor.libraryId}`);

  await prisma.bookReview.update({
    where: { id: review.id },
    data: hidden
      ? {
          hiddenAt: new Date(),
          hiddenById: actor.userId,
          hiddenReason: normaliseReviewText(reason),
        }
      : { hiddenAt: null, hiddenById: null, hiddenReason: null },
  });

  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: hidden ? AUDIT_ACTIONS.REVIEW_HIDDEN : AUDIT_ACTIONS.REVIEW_RESTORED,
    entityType: "book_review",
    entityId: review.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    // No review text and no child's name. What was written is still in the
    // row; the log's job is who decided what, not to keep a second copy of a
    // child's words in a table nobody deletes from.
    metadata: { titleId: review.titleId },
  });
}
