import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What the catalogue calls the line under the title.
 *
 * Most children's books on these shelves carry no author on the cover -- a
 * graded reader is written by a publisher's own staff and credited to the
 * imprint. A field labelled "Author" makes the librarian either invent a name
 * or feel they are filling the box in wrongly, when typing the publisher is
 * both the honest answer and the one a parent will search for.
 *
 * So the field asks for either, and every place that names it says so: the
 * form, the refusal messages, the sort control and the exports. The failure
 * this guards is drift -- one of them being reworded back on its own, so the
 * form invites a publisher and the error that comes back asks who wrote it.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const FORM = read("src", "app", "admin", "books", "book-form.tsx");
const SERVICE = read("src", "server", "services", "catalogue-service.ts");
const BOOK_LIST = read("src", "app", "admin", "books", "page.tsx");
const REPORTS = read("src", "server", "reports", "registry.ts");

describe("the author field names the publisher too", () => {
  it("is labelled for both on the form that asks", () => {
    expect(FORM).toContain('label="Author/publisher"');
    expect(FORM).not.toContain('label="Author"');
  });

  it("says on the form that the publisher is a real answer, not a fallback", () => {
    expect(FORM).toMatch(/publisher's name is the right answer/);
  });

  it("asks for either when the box comes back empty", () => {
    expect(SERVICE).toContain('"Who wrote or published it?"');
    expect(SERVICE).not.toContain('"Who wrote it?"');
  });

  it("names both when the answer is too long", () => {
    expect(SERVICE).toMatch(/keep the author or publisher under/);
  });

  it("names both on the control that sorts by it", () => {
    expect(BOOK_LIST).toContain('<option value="author">Author/publisher</option>');
  });

  it("names both on every export that carries the column", () => {
    expect(REPORTS).not.toMatch(/header: "Author"/);
    expect(REPORTS.match(/header: "Author\/publisher"/g)).toHaveLength(3);
  });
});
