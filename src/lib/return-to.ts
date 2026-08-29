/**
 * Where the book form goes back to.
 *
 * A librarian does not open the book list. They open *a* book list — page three
 * of the damaged comics, sorted by author — work through it, edit one book, and
 * expect to land back where they were. So "back to the list" has to carry the
 * filters, and the filters live in the query string.
 *
 * That query string travels out to a browser and comes back in a form field, so
 * it is an input rather than a fact, and it is checked twice over:
 *
 *   1. The path must be the book list itself. Not a prefix match — a prefix
 *      match makes "/admin/booksomewhere.example.com" a destination — and not a
 *      sub-path either, so an edit form can never redirect to another edit form.
 *   2. The query is rebuilt from a fixed list of keys rather than passed
 *      through, so nothing a person typed into a URL survives the round trip.
 *
 * A form that can only ever return to one page cannot be talked into becoming
 * an open redirect, which is the failure this is shaped to prevent.
 */

import { BOOK_FILTER_KEYS } from "@/lib/book-filter";

export const BOOK_LIST_PATH = "/admin/books";

/**
 * The query keys the book list understands. Everything else is dropped.
 *
 * Taken from the filter's own definition rather than typed out again: a filter
 * this list can show but cannot carry is a filter a librarian loses every time
 * they edit a book, which is exactly the thing this file exists to prevent.
 */
const LIST_KEYS = [...BOOK_FILTER_KEYS, "sort", "page"] as const;

/** Nothing legitimate is longer than this; a filter value is a word or an id. */
const VALUE_MAX = 100;

function render(query: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of LIST_KEYS) {
    const value = query.get(key)?.trim();
    if (value) kept.set(key, value.slice(0, VALUE_MAX));
  }
  const rendered = kept.toString();
  return rendered ? `${BOOK_LIST_PATH}?${rendered}` : BOOK_LIST_PATH;
}

/** The list a page is currently showing, as a link somewhere else can hold it. */
export function bookListUrl(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) query.set(key, single);
  }
  return render(query);
}

/** The same, coming back from a browser: trusted for nothing, checked for all. */
export function safeBookListReturn(value: string | null | undefined): string {
  if (!value) return BOOK_LIST_PATH;

  const [path, query = ""] = value.split("?");
  if (path !== BOOK_LIST_PATH) return BOOK_LIST_PATH;

  return render(new URLSearchParams(query));
}

/**
 * The list, plus a note saying what just happened to which book.
 *
 * The code rides in the URL rather than in a session flash because the redirect
 * is the only thing carrying state between the form and the list, and a book
 * code is not a secret — it is printed on the cover.
 */
export function bookListWithNotice(
  returnTo: string,
  notice: "added" | "saved",
  copyCode: string,
): string {
  const [path, query = ""] = safeBookListReturn(returnTo).split("?");
  const params = new URLSearchParams(query);
  params.set(notice, copyCode);
  return `${path}?${params.toString()}`;
}

/**
 * A book code read back out of the URL, or nothing.
 *
 * Rendered as text by React either way, so this is not an escaping question. It
 * is that a banner should say a book code or say nothing at all, rather than
 * repeating whatever somebody typed after `?added=`.
 */
export function noticeCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(value) ? value : null;
}
