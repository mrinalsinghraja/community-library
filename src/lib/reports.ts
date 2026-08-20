/**
 * What may be exported, and what it is called.
 *
 * Isomorphic on purpose: the export toolbar in the browser, the route handler,
 * the report registry and the tests all read this same list, so a report cannot
 * exist on a screen and not on the server, or be spelled differently in two
 * places.
 *
 * There is no permission in this file. Permissions are not a presentation
 * concern and they are not a list the browser is allowed to hold an opinion
 * about — every report is authorised on the server by the service that loads
 * it. See `src/server/reports/registry.ts`.
 */

export const REPORT_KEYS = [
  "books",
  "readers",
  "staff",
  "loans",
  "borrow-requests",
  "renewal-requests",
  "registrations",
  "audit",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

export const REPORT_FORMATS = ["xlsx", "pdf"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function isReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}

export const FORMAT_LABELS: Record<ReportFormat, string> = {
  xlsx: "Excel",
  pdf: "PDF",
};

export const FORMAT_MIME: Record<ReportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export const FORMAT_EXTENSION: Record<ReportFormat, string> = {
  xlsx: "xlsx",
  pdf: "pdf",
};

/**
 * The words on the screen, matched to the desk's own navigation.
 *
 * A librarian looking at "Books asked for" should be offered a report called
 * "Books asked for". Naming it `borrow-requests` in the interface because that
 * is what the table is called would be describing the software to somebody who
 * came here to describe the library.
 */
export const REPORT_LABELS: Record<ReportKey, string> = {
  books: "Books",
  readers: "Readers",
  staff: "Staff",
  loans: "Books out",
  "borrow-requests": "Books asked for",
  "renewal-requests": "Asks to keep",
  registrations: "New members",
  audit: "Audit log",
};

/** The row noun, for "3 books selected" / "3 readers selected". */
export const REPORT_ROW_NOUN: Record<ReportKey, { one: string; many: string }> = {
  books: { one: "book", many: "books" },
  readers: { one: "reader", many: "readers" },
  staff: { one: "staff member", many: "staff" },
  loans: { one: "book out", many: "books out" },
  "borrow-requests": { one: "request", many: "requests" },
  "renewal-requests": { one: "ask", many: "asks" },
  registrations: { one: "registration", many: "registrations" },
  audit: { one: "entry", many: "entries" },
};

export function rowNoun(key: ReportKey, count: number): string {
  const noun = REPORT_ROW_NOUN[key];
  return count === 1 ? noun.one : noun.many;
}

/**
 * The download's filename.
 *
 * Carries the library's own name so that a folder of exports from several
 * places stays legible, and the date so that two exports of the same list do
 * not overwrite each other. Everything is reduced to letters, digits and
 * hyphens: a filename crosses into the operating system, and a title with a
 * slash or a quote in it has no business arriving there intact.
 */
export function reportFilename(
  libraryName: string,
  key: ReportKey,
  format: ReportFormat,
  now: Date,
): string {
  const slug = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40);

  const day = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const parts = [slug(libraryName), slug(REPORT_LABELS[key]), day].filter(Boolean);
  return `${parts.join("_")}.${FORMAT_EXTENSION[format]}`;
}
