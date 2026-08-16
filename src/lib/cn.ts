/**
 * Joins class names, dropping falsy values.
 *
 * Deliberately NOT tailwind-merge: this does not resolve conflicts between
 * competing utilities. Component APIs here therefore expose explicit variant
 * props rather than inviting callers to override styling through className.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
