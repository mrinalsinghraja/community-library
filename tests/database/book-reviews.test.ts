import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { REVIEW_REMINDER_DAYS } from "@/lib/reviews";
import { browseCatalogue, getBookByCode } from "@/server/services/catalogue-service";
import {
  countPendingReviews,
  decideReview,
  deleteReviewForever,
  getOwnReviewStateForCode,
  listOwnReviews,
  listReviewsForStaff,
  pendingReviewPrompts,
  ratingForTitle,
  reviewsForTitle,
  submitReview,
  withdrawOwnReview,
} from "@/server/services/review-service";

import {
  createBookCopy,
  createLibraryFixture,
  createMember,
  createStaff,
  db,
  resetDatabase,
  type Fixture,
} from "./helpers";

/**
 * Book ratings, against a real database.
 *
 * Six properties, none of which can be checked without Postgres, and each of
 * which is the thing that would quietly break first:
 *
 *   1. A reader who never borrowed the book cannot rate it.
 *   2. Borrowing the same work twice does not buy a second vote — the unique
 *      index on (member, title) enforces it, and an ORM-level check would pass
 *      a test while the database disagreed.
 *   3. **Nothing reaches a public surface without a decision.** The average, the
 *      count, the public list and the catalogue's own LATERAL aggregate are four
 *      separate pieces of SQL, so all four are asserted separately.
 *   4. **Publication is permanent.** Neither the author nor the librarian who
 *      approved it can edit, withdraw or un-publish afterwards.
 *   5. Only the Super Admin can delete a published review, and the deletion
 *      leaves an audit row behind.
 *   6. The reminder opens the day a book goes back and shuts sixty days later.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let reader: Awaited<ReturnType<typeof createMember>>;
let otherReader: Awaited<ReturnType<typeof createMember>>;
let stranger: Awaited<ReturnType<typeof createMember>>;

const DAY = 24 * 60 * 60 * 1000;

/** The work everybody in this file rates, with two copies of it. */
let sharedCode = "";
let sharedSecondCode = "";
let sharedTitleId = "";
/** A work nobody has borrowed. */
let unreadCode = "";

async function actingAs(userId: string, kind: "STAFF" | "MEMBER" = "MEMBER") {
  __setSessionHandle(await createSession(userId, kind));
}

async function signOut() {
  __setSessionHandle(null);
}

/** The row this member wrote about a work, whatever state it is in. */
async function reviewRow(memberUserId: string, titleId: string = sharedTitleId) {
  return db.bookReview.findFirstOrThrow({
    where: { titleId, memberUserId },
    select: { id: true, status: true, decisionNote: true, decidedAt: true, decidedById: true },
  });
}

/** The desk answering one review. */
async function decide(
  memberUserId: string,
  approve: boolean,
  note?: string,
  titleId: string = sharedTitleId,
) {
  const row = await reviewRow(memberUserId, titleId);
  await actingAs(librarian.id, "STAFF");
  await decideReview(row.id, approve, note);
}

/**
 * A finished loan of one copy.
 *
 * Both sides of the copy/loan pair are written in one transaction: the database
 * triggers that keep `book_copy.status` and the loan in step are DEFERRABLE
 * INITIALLY DEFERRED, so writing one without the other in its own statement is
 * rejected.
 */
async function borrowAndReturn(
  memberUserId: string,
  copyId: string,
  returnedDaysAgo: number,
): Promise<void> {
  const returnedAt = new Date(Date.now() - returnedDaysAgo * DAY);
  const issuedAt = new Date(returnedAt.getTime() - 7 * DAY);

  await db.$transaction(async (tx) => {
    await tx.loan.create({
      data: {
        libraryId: fixture.libraryId,
        copyId,
        memberUserId,
        status: "RETURNED",
        issuedAt,
        dueAt: new Date(issuedAt.getTime() + 14 * DAY),
        returnedAt,
      },
    });
    await tx.bookCopy.update({ where: { id: copyId }, data: { status: "AVAILABLE" } });
  });
}

beforeAll(async () => {
  await resetDatabase();

  fixture = await createLibraryFixture();
  librarian = await createStaff(fixture.libraryId, "LIBRARIAN");
  superAdmin = await createStaff(fixture.libraryId, "SUPER_ADMIN");

  reader = await createMember(fixture.libraryId, { displayName: "Meera Raghunathan" });
  otherReader = await createMember(fixture.libraryId, { displayName: "Aarav Krishnamurthy" });
  stranger = await createMember(fixture.libraryId, { displayName: "Rohan Das" });

  const shared = await createBookCopy(fixture.libraryId);
  sharedCode = shared.copyCode;
  sharedTitleId = shared.titleId;

  // A second physical copy of the SAME work. The rating is per work, so this is
  // what proves borrowing "another one" is not another vote.
  const second = await db.bookCopy.create({
    data: {
      libraryId: fixture.libraryId,
      titleId: shared.titleId,
      copyCode: `${shared.copyCode}-B`,
    },
  });
  sharedSecondCode = second.copyCode;

  const unread = await createBookCopy(fixture.libraryId);
  unreadCode = unread.copyCode;

  // Both readers have had the shared work home; the stranger never has.
  await borrowAndReturn(reader.id, shared.id, 3);
  await borrowAndReturn(otherReader.id, second.id, 5);
});

afterAll(async () => {
  await db.$disconnect();
});

// ---------------------------------------------------------------------------

describe("who may rate a book", () => {
  it("lets a reader rate a book they took home", async () => {
    await actingAs(reader.id);
    await submitReview({ code: sharedCode, rating: 5, review: "The bus bit was the best." });

    expect((await reviewRow(reader.id)).status).toBe("PENDING");
  });

  it("refuses a reader who has never borrowed it", async () => {
    await actingAs(stranger.id);

    // The single reason these numbers mean anything.
    await expect(submitReview({ code: sharedCode, rating: 1 })).rejects.toThrow();
  });

  it("refuses a librarian, who has no library card", async () => {
    await actingAs(librarian.id, "STAFF");
    await expect(submitReview({ code: sharedCode, rating: 5 })).rejects.toThrow();
  });

  it("refuses a rating outside the scale", async () => {
    await actingAs(reader.id);
    await expect(submitReview({ code: sharedCode, rating: 0 })).rejects.toThrow();
    await expect(submitReview({ code: sharedCode, rating: 6 })).rejects.toThrow();
  });

  it("refuses more than a hundred words", async () => {
    await actingAs(reader.id);
    const essay = Array.from({ length: 101 }, () => "word").join(" ");
    await expect(submitReview({ code: sharedCode, rating: 4, review: essay })).rejects.toThrow();
  });

  it("records who wrote it in the audit log, and not what they wrote", async () => {
    const rows = await db.auditLog.findMany({
      where: { action: "review.submitted", actorUserId: reader.id },
      select: { metadata: true },
    });

    expect(rows.length).toBeGreaterThan(0);
    // The words live in `book_review`. A second copy of a child's writing in a
    // table nobody ever deletes from is not what an audit log is for.
    expect(JSON.stringify(rows)).not.toContain("bus bit");
  });
});

describe("nothing is published until a grown-up says so", () => {
  it("keeps a new review off the average, the count and the public list", async () => {
    expect(await ratingForTitle(sharedTitleId)).toEqual({ average: 0, count: 0 });
    expect(await reviewsForTitle(sharedTitleId)).toEqual([]);
  });

  it("keeps it off the catalogue's own aggregate too", async () => {
    // Separate SQL from `ratingForTitle` — a LATERAL inside the shelf query —
    // so a leak here would show a rating the book's own page says does not
    // exist.
    await actingAs(reader.id);
    const page = await browseCatalogue({ search: sharedCode });
    const card = page.items.find((item) => item.code === sharedCode);

    expect(card?.rating).toEqual({ average: 0, count: 0 });
  });

  it("shows the author their own review while it waits", async () => {
    await actingAs(reader.id);
    const state = await getOwnReviewStateForCode(sharedCode);

    expect(state.mine?.status).toBe("PENDING");
    expect(state.mine?.rating).toBe(5);
  });

  it("counts it on the desk so the queue is visible", async () => {
    await actingAs(librarian.id, "STAFF");
    expect(await countPendingReviews()).toBeGreaterThan(0);
  });

  it("publishes it when a librarian approves, and records who", async () => {
    await decide(reader.id, true);

    const summary = await ratingForTitle(sharedTitleId);
    expect(summary).toEqual({ average: 5, count: 1 });

    const row = await reviewRow(reader.id);
    expect(row.status).toBe("PUBLISHED");
    expect(row.decidedById).toBe(librarian.id);
    expect(row.decidedAt).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { action: "review.approved", entityId: row.id },
      select: { actorUserId: true },
    });
    expect(audit?.actorUserId).toBe(librarian.id);
  });

  it("refuses a reader who tries to approve their own", async () => {
    const row = await reviewRow(reader.id);
    await actingAs(stranger.id);

    await expect(decideReview(row.id, true)).rejects.toThrow();
  });

  it("keeps a declined review off every public surface", async () => {
    await actingAs(otherReader.id);
    await submitReview({ code: sharedSecondCode, rating: 1, review: "My friend Ravi hated it." });

    await decide(otherReader.id, false, "Please write about the book, not about Ravi.");

    expect((await ratingForTitle(sharedTitleId)).count).toBe(1);
    expect(JSON.stringify(await reviewsForTitle(sharedTitleId))).not.toContain("Ravi");
  });

  it("tells the author what to change, in the librarian's own words", async () => {
    await actingAs(otherReader.id);
    const state = await getOwnReviewStateForCode(sharedSecondCode);

    expect(state.mine?.status).toBe("REJECTED");
    expect(state.mine?.decisionNote).toBe("Please write about the book, not about Ravi.");
  });

  it("returns a rewritten review to the queue and clears the old decision", async () => {
    await actingAs(otherReader.id);
    await submitReview({ code: sharedSecondCode, rating: 3, review: "The middle was slow." });

    const row = await reviewRow(otherReader.id);
    expect(row.status).toBe("PENDING");
    // Showing a child a refusal of words they have already replaced would be
    // the library arguing with a draft that no longer exists.
    expect(row.decisionNote).toBeNull();
    expect(row.decidedAt).toBeNull();
  });

  it("averages across readers once both are published", async () => {
    await decide(otherReader.id, true);

    expect(await ratingForTitle(sharedTitleId)).toEqual({ average: 4, count: 2 });
  });
});

describe("publication is permanent", () => {
  it("refuses the author editing what is already on the page", async () => {
    await actingAs(reader.id);
    await expect(submitReview({ code: sharedCode, rating: 1 })).rejects.toThrow();

    expect((await ratingForTitle(sharedTitleId)).average).toBe(4);
  });

  it("refuses the author taking it back", async () => {
    await actingAs(reader.id);
    await expect(withdrawOwnReview(sharedCode)).rejects.toThrow();

    expect((await ratingForTitle(sharedTitleId)).count).toBe(2);
  });

  it("refuses a librarian un-publishing it under the name of declining", async () => {
    const row = await reviewRow(reader.id);
    await actingAs(librarian.id, "STAFF");

    // There is no route from PUBLISHED back to PENDING or REJECTED. A librarian
    // who could "decline" a published review would be un-publishing it.
    await expect(decideReview(row.id, false, "changed my mind")).rejects.toThrow();
    expect((await reviewRow(reader.id)).status).toBe("PUBLISHED");
  });

  it("lets a reader take back one that has not been answered yet", async () => {
    const spare = await createBookCopy(fixture.libraryId);
    await borrowAndReturn(stranger.id, spare.id, 1);

    await actingAs(stranger.id);
    await submitReview({ code: spare.copyCode, rating: 2 });
    await withdrawOwnReview(spare.copyCode);

    expect(
      await db.bookReview.count({ where: { titleId: spare.titleId, memberUserId: stranger.id } }),
    ).toBe(0);
  });
});

describe("only the Super Admin deletes", () => {
  it("refuses a librarian", async () => {
    const row = await reviewRow(reader.id);
    await actingAs(librarian.id, "STAFF");

    // `review.delete` is deliberately not in the Librarian grant.
    await expect(deleteReviewForever(row.id, "no")).rejects.toThrow();
    expect((await ratingForTitle(sharedTitleId)).count).toBe(2);
  });

  it("refuses a reader", async () => {
    const row = await reviewRow(reader.id);
    await actingAs(stranger.id);

    await expect(deleteReviewForever(row.id, "no")).rejects.toThrow();
  });

  it("refuses even the Super Admin without a reason", async () => {
    const row = await reviewRow(reader.id);
    await actingAs(superAdmin.id, "STAFF");

    await expect(deleteReviewForever(row.id, "   ")).rejects.toThrow();
    expect((await ratingForTitle(sharedTitleId)).count).toBe(2);
  });

  it("erases it, and leaves an audit row that can account for it", async () => {
    const row = await reviewRow(reader.id);
    await actingAs(superAdmin.id, "STAFF");

    await deleteReviewForever(row.id, "Guardian asked us to remove it.");

    expect(await db.bookReview.count({ where: { id: row.id } })).toBe(0);
    expect((await ratingForTitle(sharedTitleId)).count).toBe(1);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "review.deleted", entityId: row.id },
      select: { actorUserId: true, metadata: true },
    });

    expect(audit.actorUserId).toBe(superAdmin.id);
    // The only trace left, so it carries enough to answer "who removed what".
    const metadata = audit.metadata as Record<string, unknown>;
    expect(metadata.reason).toBe("Guardian asked us to remove it.");
    expect(metadata.author).toBe("Meera Raghunathan");
    expect(metadata.rating).toBe(5);
    // But never the words themselves — keeping a copy would defeat the point.
    expect(JSON.stringify(metadata)).not.toContain("bus bit");
  });
});

describe("whose name is on it", () => {
  it("publishes a first name and never the rest of it", async () => {
    const reviews = await reviewsForTitle(sharedTitleId);
    const theirs = reviews.find((review) => review.review === "The middle was slow.");

    expect(theirs?.byline).toBe("Aarav");
    expect(JSON.stringify(reviews)).not.toContain("Krishnamurthy");
  });

  it("publishes no name at all when the reader asked for none", async () => {
    const spare = await createBookCopy(fixture.libraryId);
    await borrowAndReturn(stranger.id, spare.id, 1);

    await actingAs(stranger.id);
    await submitReview({
      code: spare.copyCode,
      rating: 4,
      review: "Quietly good.",
      attribution: "ANONYMOUS",
    });
    await decide(stranger.id, true, undefined, spare.titleId);

    const reviews = await reviewsForTitle(spare.titleId);
    expect(reviews[0]?.byline).toBe("A reader at the library");
    expect(JSON.stringify(reviews)).not.toContain("Rohan");
  });

  it("carries no id, member code or display name in the public shape", async () => {
    const reviews = await reviewsForTitle(sharedTitleId);

    for (const review of reviews) {
      expect(Object.keys(review).sort()).toEqual(
        ["byline", "createdAt", "id", "rating", "review"].sort(),
      );
    }
  });
});

describe("the desk's own list", () => {
  it("is refused to a reader", async () => {
    await actingAs(stranger.id);
    await expect(listReviewsForStaff()).rejects.toThrow();
  });

  it("shows a librarian who wrote each one", async () => {
    await actingAs(librarian.id, "STAFF");
    const rows = await listReviewsForStaff();

    // Not a leak: a librarian already holds `member.view`. It is here so they
    // can have a quiet word with the child rather than moderating anonymously.
    expect(rows.some((row) => row.authorName === "Aarav Krishnamurthy")).toBe(true);
  });
});

describe("the reminder", () => {
  let staleCode = "";
  let freshCode = "";
  let freshTitleId = "";

  beforeAll(async () => {
    const stale = await createBookCopy(fixture.libraryId);
    const fresh = await createBookCopy(fixture.libraryId);
    staleCode = stale.copyCode;
    freshCode = fresh.copyCode;
    freshTitleId = fresh.titleId;

    await borrowAndReturn(stranger.id, fresh.id, 2);
    await borrowAndReturn(stranger.id, stale.id, REVIEW_REMINDER_DAYS + 5);
  });

  it("asks about a book brought back recently and not rated", async () => {
    await actingAs(stranger.id);
    expect((await pendingReviewPrompts()).map((p) => p.code)).toContain(freshCode);
  });

  it("has stopped asking about a book returned more than two months ago", async () => {
    await actingAs(stranger.id);
    // A prompt that never expires is not a nudge, it is a debt.
    expect((await pendingReviewPrompts()).map((p) => p.code)).not.toContain(staleCode);
  });

  it("stops the moment a review is written, before anybody has approved it", async () => {
    await actingAs(stranger.id);
    await submitReview({ code: freshCode, rating: 4 });

    // The child has done their part. Nagging them while they wait for the desk
    // would be the library chasing itself.
    expect((await pendingReviewPrompts()).map((p) => p.code)).not.toContain(freshCode);
  });

  it("keeps quiet while a review is waiting and after it is declined", async () => {
    await decide(stranger.id, false, "Have another go.", freshTitleId);

    await actingAs(stranger.id);
    expect((await pendingReviewPrompts()).map((p) => p.code)).not.toContain(freshCode);
  });

  it("says nothing at all to a signed-out visitor", async () => {
    await signOut();
    expect(await pendingReviewPrompts()).toEqual([]);
  });
});

describe("what a visitor and a reader each see", () => {
  it("offers no composer to somebody who never borrowed the book", async () => {
    await actingAs(otherReader.id);
    const state = await getOwnReviewStateForCode(unreadCode);

    expect(state.canReview).toBe(false);
    expect(state.mine).toBeNull();
  });

  it("offers no composer to a librarian", async () => {
    await actingAs(librarian.id, "STAFF");
    expect((await getOwnReviewStateForCode(sharedCode)).canReview).toBe(false);
  });

  it("carries only published ratings on the book's own page", async () => {
    await actingAs(otherReader.id);
    const book = await getBookByCode(sharedCode);

    expect(book.rating).toEqual({ average: 3, count: 1 });
  });

  it("reports an unrated book as zero rather than as missing", async () => {
    await actingAs(otherReader.id);
    const book = await getBookByCode(unreadCode);

    // Every card renders the same shape, so "nobody has rated this" is a state
    // and not an absent field a template has to guess about.
    expect(book.rating).toEqual({ average: 0, count: 0 });
  });
});
