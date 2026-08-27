/**
 * Where signing in lands you.
 *
 * One constant, because three places have to agree about it and they used to
 * agree only by coincidence: the sign-in action's fallback when no `next` was
 * given, the login page's bounce for somebody who is already signed in, and now
 * the front page itself.
 *
 * `/account` and not `/my-books` or `/desk`: it is the one landing that knows
 * who you are. A reader gets their shelf, their card and their details; a
 * librarian gets the desk, the book list and the catalogue — the same page,
 * rendered in each role's own shell. Sending staff straight to `/desk` would
 * mean two rules to keep in step instead of one.
 */
export const POST_LOGIN_PATH = "/account";
