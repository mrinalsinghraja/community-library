import { describe, expect, it } from "vitest";

import {
  agesDuringYear,
  describeAge,
  eligibleBirthYears,
  isEligibleBirthYear,
  isPlausibleBirthYear,
} from "@/lib/birth-year";

/**
 * Age, when the library has deliberately not asked for a birthday.
 *
 * The library used to collect a child's full date of birth to answer one
 * question: are they roughly old enough. That is one of the few facts which
 * identifies a person for life, it was being typed into a public form by a
 * parent, and the year answers the question just as well.
 *
 * What has to be right now is the arithmetic that replaces it — and in
 * particular that it never becomes a reason to turn a child away. The library
 * chose not to know the birthday; a child must not pay for that choice.
 */

const THIS_YEAR = 2026;

describe("the two ages a birth year can mean", () => {
  it("gives both, because the birthday is unknown", () => {
    // Born 2016: 9 until their birthday, 10 after it.
    expect(agesDuringYear(2016, THIS_YEAR)).toEqual({ beforeBirthday: 9, afterBirthday: 10 });
  });
});

describe("who the library accepts", () => {
  it("takes a year squarely inside the range", () => {
    expect(isEligibleBirthYear(2016, 5, 14, THIS_YEAR)).toBe(true);
  });

  it("takes the child at the older edge, whichever side of their birthday they are", () => {
    /*
     * Born 2011, range ending at 14: they are 14 until their birthday and 15
     * after it. Refusing them in January because of a birthday in November
     * would turn a child away on the strength of a fact the library decided not
     * to collect — so the year is accepted and the librarian, who meets the
     * family, decides.
     */
    expect(isEligibleBirthYear(2011, 5, 14, THIS_YEAR)).toBe(true);
  });

  it("takes the child at the younger edge for the same reason", () => {
    // Born 2021: turns 5 this year, and is 4 until then.
    expect(isEligibleBirthYear(2021, 5, 14, THIS_YEAR)).toBe(true);
  });

  it("refuses a year that cannot be the right age either way", () => {
    // Born 2024: 1 or 2 all year. Born 2000: 25 or 26.
    expect(isEligibleBirthYear(2024, 5, 14, THIS_YEAR)).toBe(false);
    expect(isEligibleBirthYear(2000, 5, 14, THIS_YEAR)).toBe(false);
  });

  it("moves with the calendar rather than being pinned to a release", () => {
    // The same child, a year later, is a year older.
    expect(isEligibleBirthYear(2011, 5, 14, THIS_YEAR)).toBe(true);
    expect(isEligibleBirthYear(2011, 5, 14, THIS_YEAR + 1)).toBe(false);
  });
});

describe("the years a form offers", () => {
  it("matches what the server will accept", () => {
    // Every year the dropdown offers must pass the server's own check, or a
    // parent picks a year from a list and is then told it is wrong.
    for (const year of eligibleBirthYears(5, 14, THIS_YEAR)) {
      expect(isEligibleBirthYear(year, 5, 14, THIS_YEAR), String(year)).toBe(true);
    }
  });

  it("offers the newest year first, because most joiners are young", () => {
    const years = eligibleBirthYears(5, 14, THIS_YEAR);

    expect(years[0]).toBe(2021);
    expect(years.at(-1)).toBe(2011);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });
});

describe("what a librarian reads", () => {
  it("says the age is one they turn, never one they are", () => {
    /*
     * "9 years old" would be a claim the library cannot make, and a librarian
     * seeing a precise age would reasonably assume somebody recorded a
     * birthday.
     */
    expect(describeAge(2017, THIS_YEAR)).toBe("turns 9 in 2026");
    expect(describeAge(2017, THIS_YEAR)).not.toMatch(/years old/);
  });
});

describe("a typed year that is not a year", () => {
  it("refuses nonsense without pretending to know the library's range", () => {
    expect(isPlausibleBirthYear(2016, THIS_YEAR)).toBe(true);
    expect(isPlausibleBirthYear(1899, THIS_YEAR)).toBe(false);
    // A date that landed in the wrong field.
    expect(isPlausibleBirthYear(12, THIS_YEAR)).toBe(false);
    expect(isPlausibleBirthYear(2016.5, THIS_YEAR)).toBe(false);
    // Nobody is born next year.
    expect(isPlausibleBirthYear(THIS_YEAR + 1, THIS_YEAR)).toBe(false);
  });
});
