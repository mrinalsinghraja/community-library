import type { AgeGroup, CopyCondition, CopyStatus } from "@prisma/client";

import {
  STATUSES,
  ageGroupLabel,
  conditionLabel,
  isAgeGroup,
  isCondition,
  statusDefinition,
} from "@/lib/catalogue";

/**
 * The ways a librarian narrows the shelf.
 *
 * One definition, read by three screens that used to each know their own half
 * of it: the book list, the label sheet and the spreadsheet export. They have
 * to agree, because the whole point of "print labels for what I am looking at"
 * is that the list on the screen and the sheet out of the printer are the same
 * set of books. A filter that exists on one of them and not the others is not
 * a missing feature, it is a wrong answer.
 *
 * Everything here is strings and booleans — the shape a query string has. Dates
 * stay as `yyyy-mm-dd` and are resolved to instants on the server, where the
 * library's timezone is known: "donated in August" means August in Bengaluru.
 *
 * **The donor fields are staff-only and are not part of `search`.** The search
 * box is shared with the child-facing catalogue, and a donor's name there would
 * let anybody type a neighbour's flat number and read back what that family
 * gave. They are separate fields, on screens that already require the
 * catalogue-management permissions, and `browseCatalogue` builds its own query
 * rather than passing this one through.
 */

export interface BookFilter {
  /** Title, author or book ID. The one box that is also on the child's shelf. */
  search: string;
  categoryId: string;
  ageGroup: AgeGroup | "";
  condition: CopyCondition | "";
  status: CopyStatus | "";
  /** `yyyy-mm-dd`, inclusive at both ends. When the book was catalogued. */
  addedFrom: string;
  addedTo: string;
  /** `yyyy-mm-dd`, inclusive at both ends. When the family gave the book. */
  donatedFrom: string;
  donatedTo: string;
  /** A book ID range, typed as whole codes or as bare numbers: 1 to 20. */
  codeFrom: string;
  codeTo: string;
  /** Staff only. Partial and case-insensitive, like every other name search. */
  donorName: string;
  donorFlat: string;
  includeArchived: boolean;
}

/** The query-string keys, in the order a link should carry them. */
export const BOOK_FILTER_KEYS = [
  "q",
  "category",
  "age",
  "condition",
  "status",
  "addedFrom",
  "addedTo",
  "donatedFrom",
  "donatedTo",
  "codeFrom",
  "codeTo",
  "donor",
  "flat",
  "archived",
] as const;

export const EMPTY_BOOK_FILTER: BookFilter = {
  search: "",
  categoryId: "",
  ageGroup: "",
  condition: "",
  status: "",
  addedFrom: "",
  addedTo: "",
  donatedFrom: "",
  donatedTo: "",
  codeFrom: "",
  codeTo: "",
  donorName: "",
  donorFlat: "",
  includeArchived: false,
};

/** Long enough for any real name or flat; short enough not to be an attack. */
const TEXT_MAX = 120;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function one(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, TEXT_MAX);
}

/**
 * Reads a filter out of a query string.
 *
 * Anything unrecognised is dropped rather than passed on, and every value is
 * checked against the vocabulary this application defined rather than cast. A
 * hand-edited URL narrows the list or does nothing; it never reaches SQL as
 * something the code did not expect.
 *
 * The category id is carried as typed and checked by the caller, which is the
 * only place that knows this library's shelves.
 */
export function parseBookFilter(
  params: Record<string, string | string[] | undefined>,
): BookFilter {
  const age = one(params, "age");
  const condition = one(params, "condition");
  const status = one(params, "status");
  const day = (key: string) => {
    const value = one(params, key);
    return DAY.test(value) ? value : "";
  };

  return {
    search: one(params, "q"),
    categoryId: one(params, "category"),
    ageGroup: isAgeGroup(age) ? age : "",
    condition: isCondition(condition) ? condition : "",
    status: STATUSES.find((entry) => entry.value === status)?.value ?? "",
    addedFrom: day("addedFrom"),
    addedTo: day("addedTo"),
    donatedFrom: day("donatedFrom"),
    donatedTo: day("donatedTo"),
    codeFrom: one(params, "codeFrom"),
    codeTo: one(params, "codeTo"),
    donorName: one(params, "donor"),
    donorFlat: one(params, "flat"),
    includeArchived: one(params, "archived") === "1",
  };
}

/** The same filter as a link carries it. Empty values are left out entirely. */
export function bookFilterParams(filter: BookFilter): Record<string, string> {
  const params: Record<string, string> = {};
  const put = (key: string, value: string) => {
    if (value) params[key] = value;
  };

  put("q", filter.search);
  put("category", filter.categoryId);
  put("age", filter.ageGroup);
  put("condition", filter.condition);
  put("status", filter.status);
  put("addedFrom", filter.addedFrom);
  put("addedTo", filter.addedTo);
  put("donatedFrom", filter.donatedFrom);
  put("donatedTo", filter.donatedTo);
  put("codeFrom", filter.codeFrom);
  put("codeTo", filter.codeTo);
  put("donor", filter.donorName);
  put("flat", filter.donorFlat);
  if (filter.includeArchived) params.archived = "1";

  return params;
}

/** True when the filter asks for anything at all beyond "every book". */
export function isFilteringBooks(filter: BookFilter): boolean {
  return Object.keys(bookFilterParams(filter)).length > 0;
}

/**
 * The number in a book ID.
 *
 * A librarian typing a range types what is printed on the book — the whole code
 * — or, once they have typed the first one, often just the number. Both are the
 * same question, so the trailing digits are what is compared rather than the
 * string: comparing codes as text also breaks the day the code padding changes
 * and a book numbered 9 starts sorting after one numbered 10.
 */
export function bookNumber(value: string): number | null {
  const digits = /(\d+)\s*$/.exec(value.trim());
  if (!digits) return null;
  const parsed = Number.parseInt(digits[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * What is wrong with this filter, in the librarian's words.
 *
 * Returned rather than thrown: these are all things somebody can fix by typing
 * again, and the screen should say so beside the fields rather than refusing
 * the page.
 */
export function bookFilterProblems(filter: BookFilter): string[] {
  const problems: string[] = [];

  if (filter.addedFrom && filter.addedTo && filter.addedFrom > filter.addedTo) {
    problems.push("The first “added” date is after the last one. Swap them and try again.");
  }
  if (filter.donatedFrom && filter.donatedTo && filter.donatedFrom > filter.donatedTo) {
    problems.push("The first “donated” date is after the last one. Swap them and try again.");
  }

  const from = bookNumber(filter.codeFrom);
  const to = bookNumber(filter.codeTo);
  if (filter.codeFrom && from === null) {
    problems.push("That first book ID has no number in it. Type the number from the book, like 1.");
  }
  if (filter.codeTo && to === null) {
    problems.push("That last book ID has no number in it. Type the number from the book, like 20.");
  }
  if (from !== null && to !== null && from > to) {
    problems.push("That book ID range runs backwards. Put the smaller number first.");
  }

  return problems;
}

/**
 * The filter as a sentence, for the top of a screen and the foot of a printed
 * sheet.
 *
 * A sheet of stickers outlives the screen that made it, so it says what it is a
 * sheet of. "Books added 17–23 Aug 2026" is the answer to the question somebody
 * asks a week later holding a page of labels they did not print.
 *
 * The shelf is passed in by name because only the caller knows this library's
 * shelves; a filter carries an id.
 */
export function describeBookFilter(
  filter: BookFilter,
  options: { categoryName?: string; formatDay?: (day: string) => string } = {},
): string {
  const day = options.formatDay ?? ((value: string) => value);
  const parts: string[] = [];

  if (filter.search) parts.push(`matching “${filter.search}”`);
  if (options.categoryName) parts.push(options.categoryName);
  if (filter.ageGroup) parts.push(ageGroupLabel(filter.ageGroup));
  if (filter.condition) parts.push(conditionLabel(filter.condition));
  if (filter.status) parts.push(statusDefinition(filter.status).staffLabel);

  const range = (from: string, to: string, verb: string) => {
    if (from && to) parts.push(`${verb} ${day(from)} – ${day(to)}`);
    else if (from) parts.push(`${verb} from ${day(from)}`);
    else if (to) parts.push(`${verb} up to ${day(to)}`);
  };
  range(filter.addedFrom, filter.addedTo, "added");
  range(filter.donatedFrom, filter.donatedTo, "donated");

  const from = bookNumber(filter.codeFrom);
  const to = bookNumber(filter.codeTo);
  if (from !== null && to !== null) parts.push(`book IDs ${filter.codeFrom} – ${filter.codeTo}`);
  else if (from !== null) parts.push(`book IDs from ${filter.codeFrom}`);
  else if (to !== null) parts.push(`book IDs up to ${filter.codeTo}`);

  if (filter.donorName) parts.push(`given by ${filter.donorName}`);
  if (filter.donorFlat) parts.push(`given from ${filter.donorFlat}`);
  if (filter.includeArchived) parts.push("including archived");

  return parts.length === 0 ? "Every book on the shelf" : `Books ${parts.join(" · ")}`;
}
