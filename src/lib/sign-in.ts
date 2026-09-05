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
export function audienceFor(next: string | undefined): Audience {
  if (!next) return "reader";
  return next.startsWith("/desk") || next.startsWith("/admin") ? "staff" : "reader";
}
