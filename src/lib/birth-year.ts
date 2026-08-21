/**
 * How old a child is, when the library has deliberately not asked their birthday.
 *
 * A free library in one apartment block needs exactly one fact about a child's
 * age: are they roughly the right age to be a member. A full date of birth
 * answers that and also hands over one of the two or three fields that identify
 * a person for life — the thing asked for by every bank, every school form and
 * every fraudster. It is the single most sensitive field this software could
 * hold about a child, it was being typed into a public form by a parent, and it
 * was never needed.
 *
 * So the library asks for the year and nothing else.
 *
 * The cost is that an exact age is no longer knowable, and this file is where
 * that is handled honestly rather than papered over. A child born in 2016 is,
 * on some day in 2026, either 9 or 10 — and which one depends on a birthday the
 * library has chosen not to know. Every function here returns or reasons about
 * **both** possibilities rather than picking one and pretending.
 */

/** The two ages a child born in `birthYear` can be at some point during `year`. */
export function agesDuringYear(
  birthYear: number,
  year: number,
): { beforeBirthday: number; afterBirthday: number } {
  const afterBirthday = year - birthYear;
  return { beforeBirthday: afterBirthday - 1, afterBirthday };
}

/**
 * Whether this child is the right age for the library.
 *
 * Deliberately generous: a birth year is accepted when **either** of the two
 * ages it could mean falls inside the library's range. A child born in 2011,
 * with a range ending at 14, is 14 until their birthday and 15 after it — and
 * refusing them in January because of a birthday in November would be turning a
 * child away on the strength of a fact the library decided not to collect.
 *
 * The librarian meets the family anyway, and a registration is approved by a
 * person. This check exists to catch a typed year that is obviously wrong, not
 * to be the gate.
 */
export function isEligibleBirthYear(
  birthYear: number,
  ageMin: number,
  ageMax: number,
  year: number,
): boolean {
  const { beforeBirthday, afterBirthday } = agesDuringYear(birthYear, year);
  return (
    (beforeBirthday >= ageMin && beforeBirthday <= ageMax) ||
    (afterBirthday >= ageMin && afterBirthday <= ageMax)
  );
}

/**
 * The years a form should accept, widest first.
 *
 * Derived from the library's own range so the dropdown and the server agree, and
 * padded by one year at each end for exactly the boundary case above.
 */
export function eligibleBirthYears(ageMin: number, ageMax: number, year: number): number[] {
  const newest = year - ageMin;
  const oldest = year - ageMax - 1;

  const years: number[] = [];
  for (let candidate = newest; candidate >= oldest; candidate -= 1) years.push(candidate);
  return years;
}

/**
 * What a librarian reads on screen.
 *
 * "turns 9 in 2026" rather than "9 years old", because the second is a claim the
 * library cannot make and the first is exactly true — and a librarian who sees a
 * precise age will reasonably assume somebody recorded a birthday.
 */
export function describeAge(birthYear: number, year: number): string {
  return `turns ${agesDuringYear(birthYear, year).afterBirthday} in ${year}`;
}

/**
 * Sanity bounds for a typed year, independent of any library's settings.
 *
 * Wide on purpose. The real check is `isEligibleBirthYear`, which knows the
 * library's own range; this only rejects a value that cannot be a year at all,
 * such as a mistyped date or a day-of-month landing in the wrong field.
 */
export const BIRTH_YEAR_FLOOR = 1900;

export function isPlausibleBirthYear(value: number, year: number): boolean {
  return Number.isInteger(value) && value >= BIRTH_YEAR_FLOOR && value <= year;
}
