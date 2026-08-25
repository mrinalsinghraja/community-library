import { describe, expect, it } from "vitest";

import {
  RATING_MAX,
  REVIEW_MAX_WORDS,
  REVIEW_REMINDER_DAYS,
  countWords,
  formatAverage,
  isRating,
  normaliseReviewText,
  ratingSentence,
  reminderHeadline,
  starFills,
} from "@/lib/reviews";

/**
 * The rating vocabulary.
 *
 * Three things are worth holding still. The scale has no zero, so a rating
 * outside 1–5 must be refused rather than clamped. A hundred words is the rule
 * a child was given, so it has to be counted the way a person counts words. And
 * the star row must round to halves — a third of a star renders as a shape
 * nobody can read as a number.
 */

describe("the scale", () => {
  it("has no zero and no six", () => {
    expect(isRating(0)).toBe(false);
    expect(isRating(6)).toBe(false);
    expect(isRating(-1)).toBe(false);
  });

  it("takes the five whole numbers and nothing between them", () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isRating(value)).toBe(true);
    // Half stars are a rendering of an average, never something anyone gives.
    expect(isRating(4.5)).toBe(false);
  });

  it("refuses anything that is not a number at all", () => {
    for (const value of ["4", null, undefined, {}, NaN]) expect(isRating(value)).toBe(false);
  });
});

describe("counting words", () => {
  it("counts the way a person does", () => {
    expect(countWords("The bit I liked best was the bus")).toBe(8);
  });

  it("is not fooled by extra spacing or line breaks", () => {
    expect(countWords("  two   words  ")).toBe(2);
    expect(countWords("one\ntwo\tthree")).toBe(3);
  });

  it("counts nothing as nothing", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
  });

  it("lets exactly the limit through", () => {
    const exactly = Array.from({ length: REVIEW_MAX_WORDS }, () => "word").join(" ");
    expect(countWords(exactly)).toBe(REVIEW_MAX_WORDS);
    expect(countWords(`${exactly} more`)).toBe(REVIEW_MAX_WORDS + 1);
  });
});

describe("storing what was written", () => {
  it("collapses whitespace rather than storing a child's line breaks", () => {
    expect(normaliseReviewText("  I   liked\n\nit  ")).toBe("I liked it");
  });

  it("turns nothing into null, because a blank quotation is not a review", () => {
    expect(normaliseReviewText("")).toBeNull();
    expect(normaliseReviewText("   ")).toBeNull();
    expect(normaliseReviewText(null)).toBeNull();
    expect(normaliseReviewText(undefined)).toBeNull();
  });
});

describe("the average", () => {
  it("always shows one decimal, so a column of them lines up", () => {
    expect(formatAverage(4)).toBe("4.0");
    expect(formatAverage(4.25)).toBe("4.3");
    expect(formatAverage(3.999)).toBe("4.0");
  });

  it("says the count out loud, never only in brackets", () => {
    // The whole defence against 5.0-from-one-reader reading like 5.0 from forty.
    expect(ratingSentence({ average: 4.3333, count: 12 })).toBe(
      `4.3 out of ${RATING_MAX} stars, from 12 readers`,
    );
    expect(ratingSentence({ average: 5, count: 1 })).toContain("from 1 reader");
  });

  it("says so plainly when nobody has rated it", () => {
    expect(ratingSentence({ average: 0, count: 0 })).toBe("No ratings yet");
  });
});

describe("drawing the stars", () => {
  it("rounds to the nearest half, never a third", () => {
    expect(starFills(4.3)).toEqual(["full", "full", "full", "full", "half"]);
    // 4.7 is nearer 4.5 than 5.0, so the fifth star is half — a row that
    // rounded 4.7 up to five would tell a child a book was perfect when the
    // figure beside the stars says it is not.
    expect(starFills(4.7)).toEqual(["full", "full", "full", "full", "half"]);
    expect(starFills(4.8)).toEqual(["full", "full", "full", "full", "full"]);
    expect(starFills(3.5)).toEqual(["full", "full", "full", "half", "empty"]);
  });

  it("always draws five", () => {
    for (const average of [0, 1, 2.5, 4.9, 5]) {
      expect(starFills(average)).toHaveLength(RATING_MAX);
    }
  });

  it("draws nothing filled for an unrated book", () => {
    expect(starFills(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("cannot be pushed past five or below zero", () => {
    expect(starFills(9)).toEqual(["full", "full", "full", "full", "full"]);
    expect(starFills(-3)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });
});

describe("the reminder", () => {
  it("stops after two months", () => {
    // The owner asked for two months. Sixty days is that, said in the unit the
    // query actually uses.
    expect(REVIEW_REMINDER_DAYS).toBe(60);
  });

  it("counts the books rather than scolding about them", () => {
    expect(reminderHeadline(1)).toBe("One book is waiting for your stars");
    expect(reminderHeadline(4)).toBe("4 books are waiting for your stars");

    // No fines, no warnings, no "overdue" anywhere near a rating prompt.
    for (const count of [1, 3, 9]) {
      expect(reminderHeadline(count)).not.toMatch(/overdue|must|fail|late|owe/i);
    }
  });
});
