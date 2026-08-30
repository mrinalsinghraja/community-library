/**
 * A file size, said the way a person would say it.
 *
 * Isomorphic and dependency-free: the same sentence has to be produced by a
 * field hint in a browser and by an upload refusal on a server, and the two
 * must not drift into "1048576 bytes" and "1 MB".
 */

/** "1 MB", "100 KB", "36 KB" — whichever unit reads as a size a person chose. */
export function describeSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
