/**
 * Who is signing in. It changes what the form calls the first box and nothing
 * else — the same field, the same action, the same answer from the server.
 */
export type Audience = "reader" | "staff";

/**
 * Where a person was headed decides which half of the form they see first.
 *
 * Somebody bounced here from `/desk/loans` works at the library; somebody who
 * pressed "Sign in" on the front page is almost certainly a family. The guess
 * costs nothing when it is wrong — the switch is right there — and saves the
 * right person a click every single time.
 *
 * Only the two prefixes the desk actually lives under. `/account` is
 * everybody's, so it says nothing about who you are.
 */
/**
 * Where to send somebody after they sign in, or `fallback` if the request
 * named anywhere unsafe.
 *
 * Only a path on this site. "Starts with one slash and not two" is NOT enough,
 * and was the check here until 2026-09-22: browsers treat a backslash in a URL
 * as a forward slash and silently drop tabs and newlines, so `/\evil.example`
 * and `/\t/evil.example` both leave the site while passing that test. A family
 * who followed a crafted "sign in to the library" link would type their
 * child's password here and then land on a look-alike page asking for it again.
 *
 * So the value is resolved the way a browser would resolve it, against a
 * throwaway origin, and accepted only if it is still on that origin — and any
 * backslash or control character is refused outright before that, rather than
 * trusting every URL parser to agree.
 */
export function safeNextPath(next: unknown, fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;

  const base = "https://library.invalid";
  let resolved: URL;
  try {
    resolved = new URL(next, base);
  } catch {
    return fallback;
  }
  if (resolved.origin !== base) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function audienceFor(next: string | undefined): Audience {
  if (!next) return "reader";
  return next.startsWith("/desk") || next.startsWith("/admin") ? "staff" : "reader";
}
