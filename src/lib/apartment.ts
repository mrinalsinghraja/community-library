/**
 * Flat numbers.
 *
 * A flat number is the only piece of a registration that is neither a name nor
 * a date: it is a short structured identifier a building assigns, and this
 * community writes it several ways — `P-15`, `A-102`, `B12`, `Tower-A-15`.
 *
 * The shape is deliberately narrow. Letters, digits and hyphens between them,
 * and nothing else. That is wide enough for every block in the apartment and
 * narrow enough that a value which arrives looking like markup, a path or an
 * email address is refused before it reaches the database — this string is
 * rendered on the desk screens, the reader list and the registration queue, so
 * it is one of the few free-text fields a stranger can put in front of staff.
 *
 * It is NOT applied to names. A child called O'Brien or Anne-Marie must be able
 * to join a library, and a format rule that is right for a door number is wrong
 * for a person.
 *
 * Isomorphic on purpose: the join form, the server action and the service all
 * read this file, so the browser hint and the server's refusal cannot drift.
 */

/** Long enough for `Tower-A-15` and every real variant; short enough to render. */
export const APARTMENT_MAX_LENGTH = 20;

/**
 * One or more alphanumeric groups, joined by single hyphens.
 *
 * Anchored at both ends, with no `.` and no character class that could match a
 * newline, so a multi-line value cannot smuggle a second "line" past the check.
 */
export const APARTMENT_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/**
 * The one message a family ever sees for this field.
 *
 * It shows the format by example rather than describing it, because "letters,
 * digits and hyphens, maximum twenty characters" is a specification and `P-15`
 * is an answer.
 */
export const APARTMENT_ERROR = "Enter a valid flat number, for example P-15.";

/** Hint shown under the field. Same examples, in a friendlier voice. */
export const APARTMENT_HINT = "Letters, numbers and dashes — for example P-15, A-102 or B12.";

/** Trims surrounding whitespace. Does not otherwise rewrite what was typed. */
export function normaliseApartment(value: string): string {
  return value.trim();
}

/**
 * True when `value` — once trimmed — is a flat number this library accepts.
 *
 * Empty is false: a registration without a flat number cannot be delivered to,
 * and the desk cannot find the family.
 */
export function isValidApartment(value: string): boolean {
  const trimmed = normaliseApartment(value);
  if (trimmed.length === 0 || trimmed.length > APARTMENT_MAX_LENGTH) return false;
  return APARTMENT_PATTERN.test(trimmed);
}
