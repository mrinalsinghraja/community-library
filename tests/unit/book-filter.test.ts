import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BOOK_FILTER_KEYS,
  EMPTY_BOOK_FILTER,
  bookFilterParams,
  bookFilterProblems,
  bookNumber,
  describeBookFilter,
  isFilteringBooks,
  parseBookFilter,
  type BookFilter,
} from "@/lib/book-filter";

/**
 * The one definition of "which books".
 *
 * Three screens read it — the book list, the label sheet and the export — and
 * the promise behind the Print labels button is that they agree. So the round
 * trip is what is tested: a filter written into a link and read back out has to
 * be the same filter, or a librarian prints stickers for a different set of
 * books from the one on their screen.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const filter = (overrides: Partial<BookFilter> = {}): BookFilter => ({
  ...EMPTY_BOOK_FILTER,
  ...overrides,
});

describe("reading a filter out of a query string", () => {
  it("takes every question the screens ask", () => {
    const parsed = parseBookFilter({
      q: "gruffalo",
      category: "cat-1",
      age: "AGE_8_11",
      condition: "FAIR",
      status: "AVAILABLE",
      addedFrom: "2026-08-01",
      addedTo: "2026-08-31",
      donatedFrom: "2026-07-01",
      donatedTo: "2026-07-31",
      codeFrom: "MJCL-B0001",
      codeTo: "MJCL-B0020",
      donor: "Meera",
      flat: "A-1204",
      archived: "1",
    });

    expect(parsed).toEqual({
      search: "gruffalo",
      categoryId: "cat-1",
      ageGroup: "AGE_8_11",
      condition: "FAIR",
      status: "AVAILABLE",
      addedFrom: "2026-08-01",
      addedTo: "2026-08-31",
      donatedFrom: "2026-07-01",
      donatedTo: "2026-07-31",
      codeFrom: "MJCL-B0001",
      codeTo: "MJCL-B0020",
      donorName: "Meera",
      donorFlat: "A-1204",
      includeArchived: true,
    });
  });

  it("survives the round trip into a link and back", () => {
    const original = filter({
      search: "cabin",
      ageGroup: "AGE_5_7",
      donorName: "Nair",
      codeFrom: "1",
      codeTo: "20",
      donatedFrom: "2026-08-01",
      includeArchived: true,
    });

    expect(parseBookFilter(bookFilterParams(original))).toEqual(original);
  });

  it("leaves empty answers out of the link entirely", () => {
    expect(bookFilterParams(EMPTY_BOOK_FILTER)).toEqual({});
    expect(isFilteringBooks(EMPTY_BOOK_FILTER)).toBe(false);
    expect(isFilteringBooks(filter({ donorFlat: "B-302" }))).toBe(true);
  });

  it("refuses a vocabulary this application did not define", () => {
    const parsed = parseBookFilter({
      age: "AGE_99_100",
      condition: "PRISTINE",
      status: "ON_FIRE",
      archived: "yes",
    });

    expect(parsed.ageGroup).toBe("");
    expect(parsed.condition).toBe("");
    expect(parsed.status).toBe("");
    expect(parsed.includeArchived).toBe(false);
  });

  it("refuses a date that is not one", () => {
    const parsed = parseBookFilter({ addedFrom: "yesterday", donatedTo: "31-08-2026" });

    expect(parsed.addedFrom).toBe("");
    expect(parsed.donatedTo).toBe("");
  });

  it("takes the first value when a key arrives twice", () => {
    expect(parseBookFilter({ donor: ["Meera", "Someone Else"] }).donorName).toBe("Meera");
  });

  it("truncates a value long enough to be an attack rather than a name", () => {
    expect(parseBookFilter({ donor: "a".repeat(5000) }).donorName.length).toBeLessThanOrEqual(120);
  });

  it("names every key it reads", () => {
    // The key list is what the book form carries back and what a link is built
    // from. A filter the parser knows and the list does not is one a librarian
    // loses on the way to an edit form and back.
    const params = bookFilterParams(
      filter({
        search: "a",
        categoryId: "b",
        ageGroup: "AGE_5_7",
        condition: "GOOD",
        status: "AVAILABLE",
        addedFrom: "2026-08-01",
        addedTo: "2026-08-02",
        donatedFrom: "2026-08-03",
        donatedTo: "2026-08-04",
        codeFrom: "1",
        codeTo: "2",
        donorName: "c",
        donorFlat: "d",
        includeArchived: true,
      }),
    );

    expect(Object.keys(params).sort()).toEqual([...BOOK_FILTER_KEYS].sort());
  });
});

describe("the number in a book ID", () => {
  it.each([
    ["MJCL-B0001", 1],
    ["MJCL-B0020", 20],
    ["20", 20],
    ["  mjcl-b0007  ", 7],
    ["B12", 12],
  ])("reads %s as %i", (value, expected) => {
    expect(bookNumber(value)).toBe(expected);
  });

  it("has no answer for something with no number in it", () => {
    expect(bookNumber("")).toBeNull();
    expect(bookNumber("MJCL-B")).toBeNull();
    expect(bookNumber("the twentieth one")).toBeNull();
  });
});

describe("what the librarian is told is wrong", () => {
  it("is nothing at all for an empty filter", () => {
    expect(bookFilterProblems(EMPTY_BOOK_FILTER)).toEqual([]);
  });

  it("catches dates the wrong way round, on both ranges", () => {
    expect(bookFilterProblems(filter({ addedFrom: "2026-08-20", addedTo: "2026-08-10" }))).toHaveLength(1);
    expect(
      bookFilterProblems(filter({ donatedFrom: "2026-08-20", donatedTo: "2026-08-10" })),
    ).toHaveLength(1);
  });

  it("accepts a single day as a range of one day", () => {
    expect(bookFilterProblems(filter({ addedFrom: "2026-08-20", addedTo: "2026-08-20" }))).toEqual([]);
  });

  it("catches a book ID range that runs backwards", () => {
    const [problem] = bookFilterProblems(filter({ codeFrom: "MJCL-B0020", codeTo: "MJCL-B0001" }));
    expect(problem).toMatch(/backwards/);
  });

  it("says so when a book ID has no number in it", () => {
    expect(bookFilterProblems(filter({ codeFrom: "the first one" }))).toHaveLength(1);
  });

  it("accepts one end of a range on its own", () => {
    expect(bookFilterProblems(filter({ codeFrom: "1" }))).toEqual([]);
    expect(bookFilterProblems(filter({ donatedTo: "2026-08-01" }))).toEqual([]);
  });
});

describe("saying what a sheet is a sheet of", () => {
  it("says so plainly when nothing is narrowed", () => {
    expect(describeBookFilter(EMPTY_BOOK_FILTER)).toBe("Every book on the shelf");
  });

  it("names each thing that was chosen", () => {
    const described = describeBookFilter(
      filter({ ageGroup: "AGE_8_11", donorFlat: "A-1204", codeFrom: "1", codeTo: "20" }),
      { categoryName: "Comics" },
    );

    expect(described).toContain("Comics");
    expect(described).toContain("8");
    expect(described).toContain("A-1204");
    expect(described).toContain("1");
  });

  it("uses the caller's way of writing a day", () => {
    const described = describeBookFilter(filter({ donatedFrom: "2026-08-01", donatedTo: "2026-08-31" }), {
      formatDay: () => "a day",
    });

    expect(described).toContain("donated a day – a day");
  });
});

/**
 * Wiring, asserted at the source.
 *
 * The donor questions are the reason this file has a section about SQL it never
 * runs. `search` is the box on the child's shelf as well as the desk's; a donor
 * name reachable from it would let anybody type a neighbour's flat number and
 * read back what that family gave.
 */
describe("where the donor questions may be asked", () => {
  const service = read("src/server/services/catalogue-service.ts");

  it("keeps donor fields out of the shared search clause", () => {
    const searchClause = service.slice(
      service.indexOf("if (query.search?.trim())"),
      service.indexOf("// Inclusive at both ends"),
    );

    expect(searchClause).toContain("lower(t.title) LIKE");
    expect(searchClause).not.toContain("donor_name");
    expect(searchClause).not.toContain("donor_apartment");
  });

  it("builds the child's shelf query field by field rather than passing one through", () => {
    const browse = service.slice(
      service.indexOf("export async function browseCatalogue"),
      service.indexOf("export async function getBookByCode"),
    );

    // A spread here would let a donor filter reach the child-facing shelf the
    // day somebody adds one to the caller.
    expect(browse).not.toMatch(/\.\.\.query/);
    expect(browse).not.toContain("donorName");
    expect(browse).not.toContain("donorFlat");
  });

  it("asks about the donation as an EXISTS, so the count query stays valid", () => {
    expect(service).toContain("EXISTS (");
    expect(service).toContain("FROM donation d");
  });
});
