import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  BOOK_LIST_PATH,
  bookListUrl,
  bookListWithNotice,
  noticeCode,
  safeBookListReturn,
} from "@/lib/return-to";

/**
 * Getting back to the list you came from.
 *
 * Two things are under test and they pull in opposite directions. The filters
 * have to survive the round trip, or the feature is pointless — a librarian
 * working down page three of the damaged comics must land back on page three
 * of the damaged comics. And nothing else may survive it, because the value
 * travels through a browser and comes back in a form field, which is where
 * open redirects come from.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("carrying the list along", () => {
  it("keeps the filters, the sort and the page", () => {
    const url = bookListUrl({ q: "gruffalo", condition: "DAMAGED", sort: "author", page: "3" });

    expect(url.startsWith(`${BOOK_LIST_PATH}?`)).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("q")).toBe("gruffalo");
    expect(query.get("condition")).toBe("DAMAGED");
    expect(query.get("sort")).toBe("author");
    expect(query.get("page")).toBe("3");
  });

  it("is the bare list when nothing is filtered", () => {
    expect(bookListUrl({})).toBe(BOOK_LIST_PATH);
  });

  it("drops a key the list does not have", () => {
    expect(bookListUrl({ evil: "1" })).toBe(BOOK_LIST_PATH);
  });

  it("takes the first value when a key arrives twice", () => {
    expect(bookListUrl({ page: ["2", "9"] })).toBe(`${BOOK_LIST_PATH}?page=2`);
  });

  it("survives the round trip out and back", () => {
    const url = bookListUrl({ q: "cabin fever", page: "2" });
    expect(safeBookListReturn(url)).toBe(url);
  });
});

describe("what may be returned to", () => {
  it("falls back to the list when nothing was sent", () => {
    expect(safeBookListReturn(undefined)).toBe(BOOK_LIST_PATH);
    expect(safeBookListReturn("")).toBe(BOOK_LIST_PATH);
  });

  it.each([
    ["another site", "https://example.test/steal"],
    ["a protocol-relative URL", "//example.test/steal"],
    ["a path that merely starts the same way", "/admin/booksomewhere"],
    ["another desk screen", "/desk/loans"],
    ["an edit form", "/admin/books/01a01a79-9371-73c0-b9ee-e047523dcbd7"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a backslash trick", "/\\\\example.test"],
  ])("refuses %s", (_name, value) => {
    expect(safeBookListReturn(value)).toBe(BOOK_LIST_PATH);
  });

  it("keeps the query but not what somebody added to it", () => {
    const returned = safeBookListReturn(`${BOOK_LIST_PATH}?page=2&next=https://example.test`);

    expect(returned).toBe(`${BOOK_LIST_PATH}?page=2`);
    expect(returned).not.toContain("example.test");
  });

  it("truncates a filter value long enough to be an attack rather than a search", () => {
    const returned = safeBookListReturn(`${BOOK_LIST_PATH}?q=${"a".repeat(5000)}`);
    expect(returned.length).toBeLessThan(200);
  });
});

describe("the note left on the list", () => {
  it("names the book that was added, keeping the filters", () => {
    const url = bookListWithNotice(`${BOOK_LIST_PATH}?page=2`, "added", "MJCL-B0005");

    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("page")).toBe("2");
    expect(query.get("added")).toBe("MJCL-B0005");
  });

  it("cannot be pointed anywhere but the list", () => {
    const url = bookListWithNotice("https://example.test", "saved", "MJCL-B0005");
    expect(url).toBe(`${BOOK_LIST_PATH}?saved=MJCL-B0005`);
  });

  it("reads a book code back, and nothing else", () => {
    expect(noticeCode("MJCL-B0005")).toBe("MJCL-B0005");
    expect(noticeCode("")).toBeNull();
    expect(noticeCode(undefined)).toBeNull();
    expect(noticeCode("Your account has been suspended, call 555")).toBeNull();
    expect(noticeCode("<script>alert(1)</script>")).toBeNull();
    expect(noticeCode("a".repeat(64))).toBeNull();
  });
});

/**
 * Wiring, asserted at the source.
 *
 * The redirect has to be reached from outside the try/catch. Inside it, the
 * `NEXT_REDIRECT` that `redirect` throws is caught by the same handler that
 * reports failures — the librarian would be told the book was not saved, and
 * the cover they had just uploaded would be purged, for a book that saved
 * perfectly well. It is the kind of bug that only appears in production, so it
 * is pinned here.
 */
describe("how saving is wired", () => {
  const actions = read("src/server/actions/catalogue-actions.ts");
  const form = read("src/app/admin/books/book-form.tsx");

  it("redirects after a save rather than sitting on the form", () => {
    expect(actions).toContain('redirect(destination)');
    expect(actions.match(/redirect\(destination\)/g)).toHaveLength(2);
  });

  it("never calls redirect inside the block that purges the cover", () => {
    for (const body of actions.split("export async function").slice(1)) {
      const tryBlock = body.slice(body.indexOf("try {"), body.indexOf("} catch"));
      expect(tryBlock).not.toContain("redirect(");
    }
  });

  it("checks the destination instead of trusting the form field", () => {
    expect(actions).toContain("safeBookListReturn");
    expect(actions).not.toMatch(/redirect\(\s*String\(formData/);
  });

  it("sends the same destination to Cancel as to Save", () => {
    expect(form).toContain('name="returnTo"');
    expect(form).toContain("href={returnTo}");
  });
});
