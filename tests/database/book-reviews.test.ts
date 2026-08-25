import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSessionHandle } from "../stubs/auth-stub";
import { createSession } from "@/server/auth/session-store";
import { REVIEW_REMINDER_DAYS } from "@/lib/reviews";
import { browseCatalogue, getBookByCode } from "@/server/services/catalogue-service";
import {
  deleteOwnReview,
  getOwnReviewStateForCode,
  listOwnReviews,
  pendingReviewPrompts,
  ratingForTitle,
  reviewsForTitle,
  setReviewHidden,
  submitReview,
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
 * Four properties cannot be checked without Postgres, and each is the thing
 * that would quietly break first:
 *
 *   1. A reader who never borrowed the book cannot rate it.
 *   2. Borrowing the same work twice does not buy a second vote — the unique
 *      index on (member, title) is what enforces it, and an ORM-level check
 *      would pass a test while the database disagreed.
 *   3. A hidden review leaves the average, the count, the public list and the
 *      catalogue's own aggregate — all four, or the feature has a leak.
 *   4. The reminder opens the day a book goes back and shuts sixty days later.
 */

let fixture: Fixture;
let librarian: Awaited<ReturnType<typeof createStaff>>;
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

    const summary = await ratingForTitle(sharedTitleId);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(5);
  });

  it("refuses a reader who has never borrowed it", async () => {
    await actingAs(stranger.id);

    // The single reason these numbers mean anything.
    await expect(submitReview({ code: sharedCode, rating: 1 })).rejects.toThrow();
    expect((await ratingForTitle(sharedTitleId)).count).toBe(1);
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
});

describe("one opinion per reader per work", () => {
  it("edits the same row rather than adding a second", async () => {
    await actingAs(reader.id);
    await submitReview({ code: sharedCode, rating: 3, review: "Actually, it was fine." });

    const summary = await ratingForTitle(sharedTitleId);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(3);
  });

  it("does not buy a second vote by borrowing another copy", async () => {
    await actingAs(reader.id);
    // A different copy_code, the same work. Without the unique index on
    // (member, title) this is how a child would rate a book five times.
    await submitReview({ code: sharedSecondCode, rating: 5 });

    const summary = await ratingForTitle(sharedTitleId);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(5);
  });

  it("averages across readers", async () => {
    await actingAs(otherReader.id);
    await submitReview({ code: sharedSecondCode, rating: 3 });

    const summary = await ratingForTitle(sharedTitleId);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4);
  });
});

describe("whose name is on it", () => {
  it("publishes a first name and never the rest of it", async () => {
    await actingAs(reader.id);
    await submitReview({ code: sharedCode, rating: 5, review: "Read it.", attribution: "FIRST_NAME" });

    const reviews = await reviewsForTitle(sharedTitleId);
    const mine = reviews.find((review) => review.review === "Read it.");

    expect(mine?.byline).toBe("Meera");
    // The surname is in the display name and must not survive the projection.
    expect(JSON.stringify(reviews)).not.toContain("Raghunathan");
  });

  it("publishes no name at all when the reader asked for none", async () => {
    await actingAs(otherReader.id);
    await submitReview({ code: sharedCode, rating: 2, review: "Not for me.", attribution: "ANONYMOUS" });

    const reviews = await reviewsForTitle(sharedTitleId);
    const theirs = reviews.find((review) => review.review === "Not for me.");

    expect(theirs?.byline).toBe("A reader at the library");
    expect(JSON.stringify(reviews)).not.toContain("Aarav");
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

describe("a review a librarian takes down", () => {
  it("leaves the public list, the average and the catalogue's own aggregate", async () => {
    const before = await ratingForTitle(sharedTitleId);
    expect(before.count).toBe(2);

    const target = await db.bookReview.findFirstOrThrow({
      where: { titleId: sharedTitleId, memberUserId: otherReader.id },
      select: { id: true },
    });

    await actingAs(librarian.id, "STAFF");
    await setReviewHidden(target.id, true, "Names a person");

    const after = await ratingForTitle(sharedTitleId);
    expect(after.count).toBe(1);
    expect(after.average).toBe(5);

    const reviews = await reviewsForTitle(sharedTitleId);
    expect(reviews.map((review) => review.review)).not.toContain("Not for me.");

    // The shelf's own SQL aggregates separately from `ratingForTitle`, so it is
    // asserted separately — a leak here would show a rating the book's own page
    // says does not exist.
    await actingAs(reader.id);
    const page = await browseCatalogue({ search: sharedCode });
    const card = page.items.find((item) => item.code === sharedCode);
    expect(card?.rating).toEqual({ average: 5, count: 1 });
  });

  it("still counts as rated, so the reminder does not come back", async () => {
    await actingAs(otherReader.id);
    const prompts = await pendingReviewPrompts();

    // Their review was removed by a grown-up. Asking them to write it again
    // would be the library nagging a child about a decision it made itself.
    expect(prompts.map((prompt) => prompt.code)).not.toContain(sharedSecondCode);
  });

  it("is admitted to its own author, and to nobody else", async () => {
    await actingAs(otherReader.id);
    const mine = await listOwnReviews();
    expect(mine?.some((review) => review.hidden)).toBe(true);

    const state = await getOwnReviewStateForCode(sharedCode);
    expect(state.mine?.hidden).toBe(true);
  });

  it("comes back when a librarian puts it back", async () => {
    const target = await db.bookReview.findFirstOrThrow({
      where: { titleId: sharedTitleId, memberUserId: otherReader.id },
      select: { id: true },
    });

    await actingAs(librarian.id, "STAFF");
    await setReviewHidden(target.id, false);

    expect((await ratingForTitle(sharedTitleId)).count).toBe(2);
  });

  it("cannot be hidden by a reader", async () => {
    const target = await db.bookReview.findFirstOrThrow({
      where: { titleId: sharedTitleId },
      select: { id: true },
    });

    await actingAs(stranger.id);
    await expect(setReviewHidden(target.id, true)).rejects.toThrow();
  });
});

describe("the reminder", () => {
  let staleCode = "";
  let freshCode = "";

  beforeAll(async () => {
    const stale = await createBookCopy(fixture.libraryId);
    const fresh = await createBookCopy(fixture.libraryId);
    staleCode = stale.copyCode;
    freshCode = fresh.copyCode;

    // One returned inside the window, one returned long enough ago that the
    // library has stopped asking.
    await borrowAndReturn(stranger.id, fresh.id, 2);
    await borrowAndReturn(stranger.id, stale.id, REVIEW_REMINDER_DAYS + 5);
  });

  it("asks about a book brought back recently and not rated", async () => {
    await actingAs(stranger.id);
    const prompts = await pendingReviewPrompts();

    expect(prompts.map((prompt) => prompt.code)).toContain(freshCode);
  });

  it("has stopped asking about a book returned more than two months ago", async () => {
    await actingAs(stranger.id);
    const prompts = await pendingReviewPrompts();

    // A prompt that never expires is not a nudge, it is a debt.
    expect(prompts.map((prompt) => prompt.code)).not.toContain(staleCode);
  });

  it("stops asking the moment the book is rated", async () => {
    await actingAs(stranger.id);
    await submitReview({ code: freshCode, rating: 4 });

    const prompts = await pendingReviewPrompts();
    expect(prompts.map((prompt) => prompt.code)).not.toContain(freshCode);
  });

  it("asks again if the reader takes their own rating back", async () => {
    await actingAs(stranger.id);
    await deleteOwnReview(freshCode);

    const prompts = await pendingReviewPrompts();
    expect(prompts.map((prompt) => prompt.code)).toContain(freshCode);
  });

  it("says nothing at all to a signed-out visitor", async () => {
    await signOut();
    expect(await pendingReviewPrompts()).toEqual([]);
  });
});

describe("what a visitor and a reader each see", () => {
  it("offers no composer to somebody who never borrowed the book", async () => {
    await actingAs(stranger.id);
    const state = await getOwnReviewStateForCode(unreadCode);

    expect(state.canReview).toBe(false);
    expect(state.mine).toBeNull();
  });

  it("offers no composer to a librarian", async () => {
    await actingAs(librarian.id, "STAFF");
    expect((await getOwnReviewStateForCode(sharedCode)).canReview).toBe(false);
  });

  it("carries the rating on the book's own page", async () => {
    await actingAs(reader.id);
    const book = await getBookByCode(sharedCode);

    expect(book.rating.count).toBe(2);
    expect(book.rating.average).toBe(3.5);
  });

  it("reports an unrated book as zero rather than as missing", async () => {
    await actingAs(reader.id);
    const book = await getBookByCode(unreadCode);

    // Every card renders the same shape, so "nobody has rated this" is a state
    // and not an absent field a template has to guess about.
    expect(book.rating).toEqual({ average: 0, count: 0 });
  });
});
