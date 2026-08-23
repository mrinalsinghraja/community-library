import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { inflateRawSync } from "node:zlib";

import {
  FORMAT_MIME,
  REPORT_KEYS,
  REPORT_LABELS,
  isReportFormat,
  isReportKey,
  reportFilename,
  rowNoun,
} from "@/lib/reports";
import { buildPdf, __columnWidthsForTest } from "@/server/reports/pdf";
import type { ReportTable } from "@/server/reports/table";
import { buildXlsx } from "@/server/reports/xlsx";

/**
 * The two writers, and the naming around them.
 *
 * Both file formats are produced by hand from a small subset of their
 * specification, which is only safe if something actually opens the result and
 * looks. These tests unzip the spreadsheet and read the XML rather than
 * asserting a byte length: "it produced 4kB" would have passed every version of
 * this code that Excel refused to open.
 */

interface Row {
  code: string;
  title: string;
  count: number;
  when: Date | null;
  ok: boolean;
}

function table(rows: Row[], overrides: Partial<ReportTable<Row>> = {}): ReportTable<Row> {
  return {
    title: "Books",
    libraryName: "Test Library",
    scopeLabel: `All ${rows.length} books`,
    generatedAt: new Date("2026-03-04T09:30:00.000Z"),
    generatedBy: "Test Librarian",
    timezone: "UTC",
    columns: [
      { header: "Book ID", value: (row) => row.code },
      { header: "Title", value: (row) => row.title },
      { header: "Times kept", value: (row) => row.count },
      { header: "Added", value: (row) => row.when, dateOnly: true },
      { header: "Available", value: (row) => row.ok },
    ],
    rows,
    ...overrides,
  };
}

const ROWS: Row[] = [
  { code: "TST-B0001", title: "The Brilliant World", count: 2, when: new Date("2026-01-05T00:00:00.000Z"), ok: true },
  { code: "TST-B0002", title: "Cabin Fever", count: 0, when: null, ok: false },
];

/** Reads one part out of the generated package. */
function unzip(buffer: Buffer): Map<string, string> {
  const parts = new Map<string, string>();
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    parts.set(name, inflateRawSync(buffer.subarray(start, start + compressedSize)).toString("utf8"));
    offset = start + compressedSize;
  }
  return parts;
}

describe("the spreadsheet", () => {
  it("is a ZIP holding the parts Excel requires", () => {
    const parts = unzip(buildXlsx(table(ROWS)));

    expect([...parts.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("starts with the ZIP signature", () => {
    expect(buildXlsx(table(ROWS)).subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("writes the header in row 1 and the data from row 2", () => {
    const sheet = unzip(buildXlsx(table(ROWS))).get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain("<t>Book ID</t>");
    expect(sheet).toContain("<t>TST-B0001</t>");
    expect(sheet).toContain('r="A2"');
    // No title block above the header: the sheet has to stay sortable.
    expect(sheet).not.toContain("<t>Test Library</t>");
  });

  it("writes numbers as numbers and dates as serial numbers, not text", () => {
    const sheet = unzip(buildXlsx(table(ROWS))).get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain("<v>2</v>");
    // 2026-01-05 is 46027 days after the 1899-12-30 epoch Excel uses.
    expect(sheet).toContain("<v>46027</v>");
    expect(sheet).not.toContain("<t>2</t>");
  });

  it("writes the day the library saw, not the day Greenwich saw", () => {
    /*
     * 2026-01-05 20:00 UTC is already 2026-01-06 in Asia/Kolkata. A cell holds
     * a wall-clock reading with no timezone attached, so it has to be the
     * library's wall clock — otherwise the spreadsheet and the PDF disagree
     * about the date of the same donation.
     */
    const evening: Row[] = [
      { code: "A", title: "Late", count: 1, when: new Date("2026-01-05T20:00:00.000Z"), ok: true },
    ];

    const utc = unzip(buildXlsx(table(evening, { timezone: "UTC" })))
      .get("xl/worksheets/sheet1.xml") ?? "";
    const kolkata = unzip(buildXlsx(table(evening, { timezone: "Asia/Kolkata" })))
      .get("xl/worksheets/sheet1.xml") ?? "";

    // 46027 = 5 January, 46028 = 6 January.
    expect(utc).toMatch(/<v>46027\./);
    expect(kolkata).toMatch(/<v>46028\./);
  });

  it("escapes the characters that would end the XML early", () => {
    const rows: Row[] = [
      { code: "<>&\"", title: "Ampersand & <script>", count: 1, when: null, ok: true },
    ];
    const sheet = unzip(buildXlsx(table(rows))).get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain("&amp;");
    expect(sheet).toContain("&lt;");
    expect(sheet).not.toContain("<script>");
  });

  it("drops control characters, which no escape can make legal", () => {
    const rows: Row[] = [
      { code: "A", title: `bad${String.fromCharCode(7)}title`, count: 1, when: null, ok: true },
    ];
    const sheet = unzip(buildXlsx(table(rows))).get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain("<t>badtitle</t>");
    expect(sheet).not.toContain(String.fromCharCode(7));
  });

  it("keeps text in UTF-8, so a name in any script survives", () => {
    const rows: Row[] = [
      { code: "A", title: "শিশু গ্ৰন্থাগাৰ", count: 1, when: null, ok: true },
    ];
    const sheet = unzip(buildXlsx(table(rows))).get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain("শিশু গ্ৰন্থাগাৰ");
  });

  it("names the sheet after the report, within Excel's 31-character limit", () => {
    const workbook = unzip(buildXlsx(table(ROWS, { title: "A".repeat(50) })))
      .get("xl/workbook.xml") ?? "";
    const name = /name="([^"]*)"/.exec(workbook)?.[1] ?? "";

    expect(name.length).toBe(31);
  });

  it("produces the same bytes twice for the same rows", () => {
    expect(buildXlsx(table(ROWS)).equals(buildXlsx(table(ROWS)))).toBe(true);
  });

  it("writes a header even when there is nothing to export", () => {
    const sheet = unzip(buildXlsx(table([]))).get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain("<t>Book ID</t>");
  });
});

describe("the PDF", () => {
  it("is a PDF", async () => {
    const { bytes } = await buildPdf(table(ROWS));
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("carries the library and the report in its own metadata", async () => {
    const { bytes } = await buildPdf(table(ROWS));
    const reopened = await PDFDocument.load(bytes);

    expect(reopened.getTitle()).toBe("Books — Test Library");
    expect(reopened.getCreator()).toBe("Test Library");
  });

  it("does not throw on a name it cannot draw, and reports the loss", async () => {
    const rows: Row[] = [
      { code: "A", title: "শিশু গ্ৰন্থাগাৰ", count: 1, when: null, ok: true },
    ];
    const { bytes, unrepresentable } = await buildPdf(table(rows));

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(unrepresentable).toBe(true);
  });

  it("reports no loss when every character can be drawn", async () => {
    const { unrepresentable } = await buildPdf(table(ROWS));
    expect(unrepresentable).toBe(false);
  });

  it("renders an empty report as one real page rather than an empty file", async () => {
    const { bytes } = await buildPdf(table([]));
    const reopened = await PDFDocument.load(bytes);

    expect(reopened.getPageCount()).toBe(1);
  });

  it("adds pages as the list grows rather than running off the first one", async () => {
    const many: Row[] = Array.from({ length: 120 }, (_, index) => ({
      code: `TST-B${index}`,
      title: `Book ${index}`,
      count: index,
      when: null,
      ok: true,
    }));
    const { bytes } = await buildPdf(table(many));

    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});

describe("naming and vocabulary", () => {
  it("every report has a label and a row noun", () => {
    for (const key of REPORT_KEYS) {
      expect(REPORT_LABELS[key]).toBeTruthy();
      expect(rowNoun(key, 1)).toBeTruthy();
      expect(rowNoun(key, 2)).toBeTruthy();
    }
  });

  it("builds a filename from the library, the report and the day", () => {
    const name = reportFilename("Test Library", "books", "xlsx", new Date("2026-03-04T22:00:00Z"));
    expect(name).toBe("test-library_books_2026-03-04.xlsx");
  });

  it("reduces a filename to characters an operating system cannot misread", () => {
    const name = reportFilename('../../etc/"pass', "readers", "pdf", new Date("2026-03-04T00:00:00Z"));

    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).not.toContain('"');
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("accepts only the reports and formats that exist", () => {
    expect(isReportKey("books")).toBe(true);
    expect(isReportKey("salaries")).toBe(false);
    expect(isReportFormat("xlsx")).toBe(true);
    expect(isReportFormat("exe")).toBe(false);
  });

  it("declares the real Office and PDF content types", () => {
    expect(FORMAT_MIME.xlsx).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(FORMAT_MIME.pdf).toBe("application/pdf");
  });
});

/**
 * Column widths.
 *
 * The rule this pins: a heading is never shortened while there is room on the
 * page for it. Headings are drawn uppercase and were measured mixed-case, so a
 * column sized to "Days out" had to draw the wider "DAYS OUT" and ellipsised it
 * — which on a report with both "Days out" and "Days late" produced two columns
 * that each read "DAYS…". A truncated title still names a recognisable book; a
 * truncated heading turns a column of numbers into a guess.
 */
describe("the PDF's column widths", () => {
  interface Narrow {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: string;
  }

  /** Long headings over one-character data — the case that used to truncate. */
  function narrowTable(): ReportTable<Narrow> {
    return {
      title: "Counts",
      libraryName: "Test Library",
      scopeLabel: "All 1 rows",
      generatedAt: new Date("2026-03-04T09:30:00.000Z"),
      generatedBy: "Test Librarian",
      timezone: "UTC",
      columns: [
        { header: "Days out", value: (row) => row.a },
        { header: "Days late", value: (row) => row.b },
        { header: "Different books", value: (row) => row.c },
        { header: "Times kept longer", value: (row) => row.d },
        { header: "Still out", value: (row) => row.e },
        { header: "Reader", value: (row) => row.f, weight: 1.5 },
      ],
      rows: [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: "Aarav Krishnamurthy" }],
    };
  }

  it("gives every column room for its own heading as it is drawn", async () => {
    const table = narrowTable();
    const pdf = await PDFDocument.create();
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const widths = __columnWidthsForTest(table.columns, table.rows, bold, "UTC", (value) => value);

    table.columns.forEach((column, index) => {
      const drawn = bold.widthOfTextAtSize(column.header.toUpperCase(), 7.5);
      // The width the header is fitted into, once the cell padding is removed.
      expect(widths[index] - 10).toBeGreaterThanOrEqual(drawn);
    });
  });

  it("uses the whole page and no more", async () => {
    const table = narrowTable();
    const pdf = await PDFDocument.create();
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const widths = __columnWidthsForTest(table.columns, table.rows, bold, "UTC", (value) => value);
    const total = widths.reduce((sum, width) => sum + width, 0);

    expect(total).toBeCloseTo(842 - 36 * 2, 1);
  });

  it("still renders a table whose headings alone overflow the page", async () => {
    // Twenty long headings cannot all be shown. The writer must scale rather
    // than throw, and say so by shortening everything together.
    const columns = Array.from({ length: 20 }, (_, index) => ({
      header: `A rather long heading number ${index}`,
      value: () => index,
    }));

    const { bytes } = await buildPdf({
      ...narrowTable(),
      columns,
      rows: [{ a: 1, b: 1, c: 1, d: 1, e: 1, f: "x" }],
    } as unknown as ReportTable<Narrow>);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
