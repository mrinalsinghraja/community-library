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
