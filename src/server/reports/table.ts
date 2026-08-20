import "server-only";

/**
 * The one shape both writers understand.
 *
 * A report is a title, some provenance and a list of columns that know how to
 * read a value out of a row. Neither writer knows what a book or a reader is,
 * and the registry that does know never mentions a file format. That is what
 * keeps "which columns may this person see" in one place and "how does a
 * spreadsheet encode a date" in another.
 */

export type ReportCell = string | number | boolean | Date | null | undefined;

export interface ReportColumn<Row> {
  header: string;
  value: (row: Row) => ReportCell;
  /** Show the day only, with no time of day. */
  dateOnly?: boolean;
  /**
   * A relative width hint for the PDF, where space is finite and has to be
   * shared out. The spreadsheet measures its own columns and ignores this.
   */
  weight?: number;
}

export interface ReportTable<Row> {
  /** The report's own name, as it appears in the desk's navigation. */
  title: string;
  /** The library's name, read from settings. Never a literal. */
  libraryName: string;
  /** What was asked for, in words: "4 of 4 books", "3 selected books". */
  scopeLabel: string;
  generatedAt: Date;
  /** The display name of the person who pressed the button. */
  generatedBy: string;
  /** The library's configured timezone, for rendering the dates. */
  timezone: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
}
