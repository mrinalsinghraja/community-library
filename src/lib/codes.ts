/**
 * The shape of a human-facing code.
 *
 * This is pure formatting with no database and no `server-only` marker, because
 * three different callers need the same answer and must not disagree about it:
 * the allocator in `server/lib/codes.ts`, the pages that print an example card
 * on the sign-in screen, and the development seed. When the seed re-implemented
 * the rule by hand it produced `LIB-R-0001` for a prefix the allocator formats
 * as `LIB-R0001` — two formats for the same label. One function, one answer.
 */

/**
 * Formats a prefix and a number into a code.
 *
 *   formatCode("LIB",   51, 4)  →  "LIB-0051"
 *   formatCode("LIB-R", 42, 4)  →  "LIB-R0042"
 *
 * The rule: a prefix made only of letters and digits gets a "-" inserted before
 * the number; a prefix that already contains punctuation is treated as complete
 * and the number is appended directly. Without this, a member prefix of "LIB-R"
 * would produce "LIB-R-0042" — not what the card printed for that child says.
 */
export function formatCode(prefix: string, value: number, padding: number): string {
  const trimmed = prefix.trim();
  if (!trimmed) throw new Error("Code prefix must not be empty");
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Code value must be a positive integer, got ${value}`);
  }
  if (!Number.isInteger(padding) || padding < 1 || padding > 10) {
    throw new RangeError(`Code padding must be between 1 and 10, got ${padding}`);
  }

  const prefixIsComplete = /[^A-Za-z0-9]/.test(trimmed);
  const separator = prefixIsComplete ? "" : "-";

  return `${trimmed}${separator}${String(value).padStart(padding, "0")}`;
}

/**
 * What a person typed, reduced to the letters and digits in it.
 *
 *   squashCode("mjcl-r0001")  →  "MJCLR0001"
 *   squashCode("MJCL R 0001") →  "MJCLR0001"
 *
 * A library card is read off a printed card by a nine-year-old or a parent
 * holding a phone. The hyphen gets dropped, a space gets typed instead of it,
 * the caps lock is off. All of those are the same card, and the software should
 * agree with the human about that rather than about punctuation.
 */
export function squashCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Whether what somebody typed could be a card number at all.
 *
 * Deliberately about *shape*, never about existence: it must be safe to tell
 * the person the answer. "Adi" is not a card number and saying so leaks
 * nothing; "MJCL-R0042" might be one, and whether it is stays unsaid.
 *
 * An email address is somebody signing in as staff and is not this function's
 * business — callers test for "@" first.
 */
export function looksLikeCode(input: string): boolean {
  const squashed = squashCode(input);
  // Letters somewhere, a digit at the end: the shape every prefix produces.
  return /[A-Z]/.test(squashed) && /[0-9]$/.test(squashed);
}
