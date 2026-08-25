import "server-only";

import type { ReviewAttribution, ReviewStatus } from "@prisma/client";

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
 *  4. **Nothing is published until a grown-up says so.** A review is written
 *     PENDING and is visible to nobody but its author and the desk. A Librarian
 *     or the Super Admin approves it onto the book's page, or declines it with a
 *     note the author can read and rewrite from. Only PUBLISHED reviews reach a
 *     public list, an average or a count.
 *
 *  5. **Publication is permanent, with exactly one exception.** Once approved,
 *     the author cannot edit it and cannot take it down. The Super Admin can
 *     delete it outright — `review.delete`, held by nobody else, irreversible,
 *     and audited with enough to account for it afterwards.
 *
 * Every one of those transitions writes an audit row. See ADR-058.
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
  status: ReviewStatus;
  /** The librarian's words when they declined it. Null otherwise. */
  decisionNote: string | null;
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
  status: ReviewStatus;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
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
    where: { titleId, status: "PUBLISHED" },
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
    // PUBLISHED only. A review waiting for the desk is invisible here, and a
    // declined one never becomes visible unless its author rewrites it.
    where: { titleId, status: "PUBLISHED" },
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
      status: true,
      decisionNote: true,
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
    status: row.status,
    decisionNote: row.decisionNote,
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
  /** They have borrowed it, so the composer belongs on their screen. */
  canReview: boolean;
  mine: {
    rating: number;
    review: string | null;
    attribution: ReviewAttribution;
    status: ReviewStatus;
    decisionNote: string | null;
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
      select: {
        rating: true,
        review: true,
        attribution: true,
        status: true,
        decisionNote: true,
      },
    }),
  ]);

  return { canReview: borrowed, mine };
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
 * **Until it is published.** A PUBLISHED review is refused here: the author
 * cannot edit it and cannot rewrite it, because the record of what a reader
 * thought is the library's and not something that can be quietly changed after
 * other people have read it. A DECLINED one may be rewritten, which returns it
 * to PENDING and clears the decision — being told "not this one" is not meant to
 * be the end of it.
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

  const existing = await prisma.bookReview.findUnique({
    where: { memberUserId_titleId: { memberUserId: actor.userId, titleId: copy.titleId } },
    select: { id: true, status: true },
  });

  if (existing?.status === "PUBLISHED") {
    throw new RuleViolationError(
      `User ${actor.userId} tried to edit published review ${existing.id}`,
      REVIEW_MESSAGES.alreadyPublished,
    );
  }

  const review = await prisma.bookReview.upsert({
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
     * Back to PENDING, and the previous decision is wiped. A rewritten review
     * has not been looked at, and leaving the old note on it would show the
     * author a refusal of words they have already replaced.
     */
    update: {
      rating: input.rating,
      review: text,
      attribution,
      status: "PENDING",
      decidedAt: null,
      decidedById: null,
      decisionNote: null,
    },
    select: { id: true },
  });

  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.REVIEW_SUBMITTED,
    entityType: "book_review",
    entityId: review.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    // The rating, never the words. What was written lives in `book_review`;
    // the log's job is who did what, not a second copy of a child's writing in
    // a table nobody deletes from.
    metadata: {
      titleId: copy.titleId,
      rating: input.rating,
      hasWords: text !== null,
      rewritten: existing !== null,
    },
  });
}

/**
 * A reader taking back what they said — while it is still theirs to take back.
 *
 * Allowed only before publication. Once a review is on the book's page it stays
 * there: other people have read it, and a library whose reviews can be deleted
 * by their authors has a shelf of opinions that quietly rearranges itself. The
 * Super Admin is the only one who can remove a published review.
 */
export async function withdrawOwnReview(code: string): Promise<void> {
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

  const existing = await prisma.bookReview.findUnique({
    where: { memberUserId_titleId: { memberUserId: actor.userId, titleId: copy.titleId } },
    select: { id: true, status: true, rating: true },
  });
  if (!existing) return;

  if (existing.status === "PUBLISHED") {
    throw new RuleViolationError(
      `User ${actor.userId} tried to withdraw published review ${existing.id}`,
      REVIEW_MESSAGES.alreadyPublished,
    );
  }

  await prisma.bookReview.delete({ where: { id: existing.id } });

  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.REVIEW_WITHDRAWN,
    entityType: "book_review",
    entityId: existing.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: { titleId: copy.titleId, rating: existing.rating, status: existing.status },
  });
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

/**
 * Every review in the library, for the screen that decides about them.
 *
 * Waiting first, then everything else newest-first, because the queue is the
 * job and the archive is the context. Guarded by `review.moderate` — the
 * authority to decide, which is exactly the authority to read what is waiting.
 *
 * The author's name is here and is not a leak: a librarian already holds
 * `member.view` and can open that child's page. It is here because moderating
 * anonymous text is how a librarian ends up unable to have a quiet word with the
 * child who wrote it — and a quiet word is almost always the right response to
 * something a nine-year-old typed.
 */
export async function listReviewsForStaff(): Promise<StaffReview[]> {
  const actor = await requirePermission("review.moderate");

  const rows = await prisma.bookReview.findMany({
    where: { libraryId: actor.libraryId },
    /*
     * PENDING sorts before PUBLISHED before REJECTED by the enum's own order,
     * which is the order the desk wants: what needs an answer, what went up,
     * what did not.
     */
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      rating: true,
      review: true,
      attribution: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
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
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    title: row.title.title,
    code: row.title.copies.at(0)?.copyCode ?? null,
    authorName: row.member.displayName,
    authorMemberCode: row.member.memberProfile?.memberCode ?? null,
  }));
}

/** How many reviews are waiting, for the badge on the desk. */
export async function countPendingReviews(): Promise<number> {
  const actor = await getActor();
  if (!actor?.permissions.has("review.moderate")) return 0;

  return prisma.bookReview.count({
    where: { libraryId: actor.libraryId, status: "PENDING" },
  });
}

/**
 * Put a review on the book's page, or decline it.
 *
 * Both directions are audited, and both are one-way in the sense that matters:
 * approving publishes permanently, and declining is a decision the author is
 * shown and can answer by rewriting. What this cannot do is un-publish — that
 * is `deleteReviewForever`, and it belongs to the Super Admin alone.
 */
export async function decideReview(
  reviewId: string,
  approve: boolean,
  note?: string,
): Promise<void> {
  const actor = await requirePermission("review.moderate");

  const review = await prisma.bookReview.findFirst({
    where: { id: reviewId, libraryId: actor.libraryId },
    select: { id: true, titleId: true, status: true, rating: true },
  });
  if (!review) throw new NotFoundError(`No review ${reviewId} in library ${actor.libraryId}`);

  if (review.status === "PUBLISHED") {
    /*
     * Not an oversight: there is no route from PUBLISHED back to PENDING or
     * REJECTED. Publication is permanent, and a librarian who could "decline" a
     * published review would be un-publishing it under another name.
     */
    throw new RuleViolationError(
      `Review ${review.id} is already published and cannot be decided again`,
      "This review is already on the book's page. Only the Super Admin can remove it now.",
    );
  }

  await prisma.bookReview.update({
    where: { id: review.id },
    data: {
      status: approve ? "PUBLISHED" : "REJECTED",
      decidedAt: new Date(),
      decidedById: actor.userId,
      // An approved review carries no note. The note exists to explain a
      // refusal to its author, and there is nothing to explain about a yes.
      decisionNote: approve ? null : normaliseReviewText(note),
    },
  });

  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: approve ? AUDIT_ACTIONS.REVIEW_APPROVED : AUDIT_ACTIONS.REVIEW_DECLINED,
    entityType: "book_review",
    entityId: review.id,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: { titleId: review.titleId, rating: review.rating },
  });
}

/**
 * Erase a published review. Super Admin only, and irreversible.
 *
 * The single exception to publication being permanent, and it is deliberately
 * awkward to reach: `review.delete` is held by nobody but the owner of the
 * library, the same reasoning that keeps `book.delete` and `user.delete` out of
 * the Librarian role.
 *
 * The audit row is the only trace that survives, so unlike every other row in
 * this file it carries the rating and who wrote it — a deletion nobody can
 * account for afterwards is worse than having no deletion control at all. It
 * still does not carry the review text: keeping a copy of the words would
 * defeat the point of removing them.
 */
export async function deleteReviewForever(reviewId: string, reason: string): Promise<void> {
  const actor = await requirePermission("review.delete");

  const review = await prisma.bookReview.findFirst({
    where: { id: reviewId, libraryId: actor.libraryId },
    select: {
      id: true,
      titleId: true,
      rating: true,
      status: true,
      member: {
        select: { displayName: true, memberProfile: { select: { memberCode: true } } },
      },
      title: { select: { title: true } },
    },
  });
  if (!review) throw new NotFoundError(`No review ${reviewId} in library ${actor.libraryId}`);

  const explanation = normaliseReviewText(reason);
  if (!explanation) {
    throw new ValidationError({ reason: "Please say why this is being deleted." });
  }

  /*
   * The audit row is written first and in the same transaction. A deletion that
   * succeeded while its record failed is exactly the state this control exists
   * to make impossible.
   */
  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.REVIEW_DELETED,
      entityType: "book_review",
      entityId: review.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        titleId: review.titleId,
        book: review.title.title,
        rating: review.rating,
        statusWhenDeleted: review.status,
        author: review.member.displayName,
        authorMemberCode: review.member.memberProfile?.memberCode ?? null,
        reason: explanation,
      },
    });

    await tx.bookReview.delete({ where: { id: review.id } });
  });
}
