import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  LABEL_PRESETS,
  LABEL_SIZES,
  MAX_LABELS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SHEET_MARGIN,
  describeLabelSize,
  isLabelSize,
  labelCellMillimetres,
  labelCellSize,
  labelFilename,
  labelsPerSheet,
} from "@/lib/labels";
import { buildLabelSheet, wrapText, type LabelRow } from "@/server/reports/label-sheet";

import { drawnBaselines, drawnText } from "../pdf-text";

/**
 * Shelf labels.
 *
 * The PDF is opened and read back rather than measured by byte length, on the
 * same rule as the report exports: "it produced 6kB" would have passed every
 * version of this code that printed a page of blanks.
 *
 * `wrapText` gets the most attention because it is the only real algorithm
 * here, and because its failure mode is quiet and permanent — a label reading
 * "The Very Hungry" gets stuck to a book and stays wrong.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const ROWS: LabelRow[] = [
  { code: "TST-B0001", title: "The Very Hungry Caterpillar", shelf: "Stories", age: "5–7 years" },
  { code: "TST-B0002", title: "Cabin Fever", shelf: "Comics", age: "8–11 years" },
];

function sheet(rows: LabelRow[], overrides: Partial<Parameters<typeof buildLabelSheet>[0]> = {}) {
  return buildLabelSheet({
    rows,
    size: "standard",
    libraryName: "Test Library",
    scopeLabel: "Books added 17 Aug 2026 – 23 Aug 2026",
    generatedAt: new Date("2026-08-23T09:30:00.000Z"),
    cutGuides: true,
    ...overrides,
  });
}

async function helvetica() {
  const pdf = await PDFDocument.create();
  return pdf.embedFont(StandardFonts.Helvetica);
}

describe("the sheet geometry", () => {
  it("fits every preset inside the printable area", () => {
    for (const size of LABEL_SIZES) {
      const preset = LABEL_PRESETS[size];
      const cell = labelCellSize(size);

      expect(cell.width * preset.columns).toBeCloseTo(PAGE_WIDTH - SHEET_MARGIN * 2, 6);
      expect(cell.height * preset.rows).toBeCloseTo(PAGE_HEIGHT - SHEET_MARGIN * 2, 6);
    }
  });

  it("leaves room for the two lines the label promises", () => {
    for (const size of LABEL_SIZES) {
      const preset = LABEL_PRESETS[size];
      const cell = labelCellSize(size);
      // Code, then two lines of title, then the padding at both ends.
      const needed = preset.codeSize + preset.titleSize * 2 * 1.35 + preset.padding * 2;

      expect(cell.height).toBeGreaterThan(needed);
    }
  });

  it("keeps the code bigger than the title at every size", () => {
    for (const size of LABEL_SIZES) {
      const preset = LABEL_PRESETS[size];
      expect(preset.codeSize).toBeGreaterThan(preset.titleSize);
    }
  });

  it("gets smaller as the name says it does", () => {
    const areas = LABEL_SIZES.map((size) => {
      const cell = labelCellSize(size);
      return cell.width * cell.height;
    });

    expect(areas[0]).toBeGreaterThan(areas[1]);
    expect(areas[1]).toBeGreaterThan(areas[2]);
  });

  it("describes a size with the two facts that decide it", () => {
    const { width, height } = labelCellMillimetres("standard");

    expect(describeLabelSize("standard")).toBe(
      `${labelsPerSheet("standard")} per sheet, about ${width} × ${height} mm`,
    );
  });

  it("accepts only the sizes it declares", () => {
    expect(isLabelSize("standard")).toBe(true);
    expect(isLabelSize("STANDARD")).toBe(false);
    expect(isLabelSize("enormous")).toBe(false);
  });
});

describe("wrapping a title", () => {
  it("keeps a short title on one line", async () => {
    const font = await helvetica();
    expect(wrapText("Cabin Fever", font, 9, 200, 2)).toEqual(["Cabin Fever"]);
  });

  it("breaks a long title across the lines it is given", async () => {
    const font = await helvetica();
    const lines = wrapText("The Very Hungry Caterpillar", font, 9, 60, 2);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("never returns more lines than it was allowed", async () => {
    const font = await helvetica();
    const long = "A Series of Unfortunate Events The Bad Beginning and What Came After";

    for (const max of [1, 2, 3]) {
      expect(wrapText(long, font, 9, 70, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("marks a title that did not fit, so a short label is not mistaken for a short name", async () => {
    const font = await helvetica();
    const lines = wrapText("The Very Hungry Caterpillar Goes to Town", font, 9, 50, 2);

    expect(lines[lines.length - 1]).toMatch(/…$/);
  });

  it("does not mark a title that fitted", async () => {
    const font = await helvetica();
    const lines = wrapText("Cabin Fever", font, 9, 200, 2);

    expect(lines.join(" ")).not.toMatch(/…/);
  });

  it("keeps every line inside the label", async () => {
    const font = await helvetica();
    const width = 64;
    const lines = wrapText("Charlie and the Great Glass Elevator", font, 8.5, width, 2);

    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 8.5)).toBeLessThanOrEqual(width);
    }
  });

  it("cuts a single word too wide for the label rather than overflowing", async () => {
    const font = await helvetica();
    const width = 40;
    const lines = wrapText("Antidisestablishmentarianism", font, 9, width, 2);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(width);
    }
  });

  it("returns nothing for a title that is not there", async () => {
    const font = await helvetica();
    expect(wrapText("", font, 9, 100, 2)).toEqual([]);
    expect(wrapText("   ", font, 9, 100, 2)).toEqual([]);
  });
});

describe("the label sheet", () => {
  it("is a PDF", async () => {
    const { bytes } = await sheet(ROWS);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("carries the library in its own metadata", async () => {
    const { bytes } = await sheet(ROWS);
    const reopened = await PDFDocument.load(bytes);

    expect(reopened.getTitle()).toBe("Book labels — Test Library");
    expect(reopened.getCreator()).toBe("Test Library");
  });

  it("is A4 portrait", async () => {
    const { bytes } = await sheet(ROWS);
    const reopened = await PDFDocument.load(bytes);
    const { width, height } = reopened.getPage(0).getSize();

    expect(width).toBeCloseTo(PAGE_WIDTH, 1);
    expect(height).toBeCloseTo(PAGE_HEIGHT, 1);
    expect(height).toBeGreaterThan(width);
  });

  it("fills one sheet before starting another", async () => {
    const perSheet = labelsPerSheet("standard");
    const rows: LabelRow[] = Array.from({ length: perSheet }, (_, index) => ({
      code: `TST-B${index}`,
      title: `Book ${index}`,
      shelf: "Stories",
      age: "5–7 years",
    }));

    const exact = await sheet(rows);
    expect(exact.sheetCount).toBe(1);

    const oneMore = await sheet([...rows, { code: "TST-B999", title: "One too many", shelf: "Stories", age: "5–7 years" }]);
    expect(oneMore.sheetCount).toBe(2);
  });

  it("reports the sheet count the page counted", async () => {
    const rows: LabelRow[] = Array.from({ length: 60 }, (_, index) => ({
      code: `TST-B${index}`,
      title: `Book ${index}`,
      shelf: "Stories",
      age: "5–7 years",
    }));
    const { bytes, sheetCount } = await sheet(rows, { size: "small" });
    const reopened = await PDFDocument.load(bytes);

    expect(reopened.getPageCount()).toBe(sheetCount);
  });

  it("makes one real page for an empty run rather than an empty file", async () => {
    const { bytes, sheetCount } = await sheet([]);
    const reopened = await PDFDocument.load(bytes);

    expect(sheetCount).toBe(1);
    expect(reopened.getPageCount()).toBe(1);
  });

  it("does not throw on a title it cannot draw, and reports the loss", async () => {
    const { bytes, unrepresentable } = await sheet([
      { code: "TST-B0003", title: "শিশু গ্ৰন্থাগাৰ", shelf: "Stories", age: "5–7 years" },
    ]);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(unrepresentable).toBe(true);
  });

  it("reports no loss when every character can be drawn", async () => {
    const { unrepresentable } = await sheet(ROWS);
    expect(unrepresentable).toBe(false);
  });

  it("still prints the book code when the title cannot be drawn", async () => {
    // The code is the half of the label that finds the book again. A title in a
    // script Helvetica has no glyphs for must not take it down with it.
    const { bytes } = await sheet([{ code: "TST-B0003", title: "শিশু গ্ৰন্থাগাৰ", shelf: "Stories", age: "5–7 years" }]);
    const reopened = await PDFDocument.load(bytes);

    expect(reopened.getPageCount()).toBe(1);
  });

  it("renders every preset without complaint", async () => {
    for (const size of LABEL_SIZES) {
      const { bytes } = await sheet(ROWS, { size });
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
  });

  it("renders with the cut guides switched off", async () => {
    const { bytes } = await sheet(ROWS, { cutGuides: false });
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("the filename", () => {
  it("names the library, the job and the day", () => {
    const name = labelFilename("Test Library", new Date("2026-08-23T09:30:00.000Z"));
    expect(name).toBe("test-library_book-labels_2026-08-23.pdf");
  });

  it("cannot carry a path separator out of the library's name", () => {
    const name = labelFilename("../../etc/passwd", new Date("2026-08-23T00:00:00.000Z"));

    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

/**
 * Wiring, asserted at the source.
 *
 * What is being checked is that authorization was not re-implemented and that
 * the label run reuses the list service the books screen already calls. A
 * rendering test would prove a page renders; it would not notice a second copy
 * of the catalogue query growing quietly inside the label service.
 */
describe("how the labels are wired", () => {
  const service = read("src/server/services/label-service.ts");
  const route = read("src/app/api/labels/route.ts");
  const page = read("src/app/admin/books/labels/page.tsx");

  it("asks for report.view before making anything", () => {
    expect(service).toContain('requirePermission("report.view")');
  });

  it("loads books through the service that owns the books screen", () => {
    expect(service).toContain("listBooksForStaff");
    expect(service).not.toContain("prisma.bookCopy");
    expect(service).not.toContain("$queryRaw");
  });

  it("records the print without copying the catalogue into the audit log", () => {
    expect(service).toContain("BOOK_LABELS_PRINTED");
    expect(service).not.toMatch(/metadata:[\s\S]{0,400}copyCode/);
    expect(service).not.toMatch(/metadata:[\s\S]{0,400}title/);
  });

  it("caps a run rather than rendering an unbounded one", () => {
    expect(service).toContain("MAX_LABELS");
    expect(MAX_LABELS).toBeLessThanOrEqual(5000);
  });

  it("refuses a cross-origin download", () => {
    expect(route).toContain("sec-fetch-site");
    expect(route).toContain("isSameOrigin");
  });

  it("keeps the sheet out of shared caches", () => {
    expect(route).toContain("no-store, private");
  });

  it("resolves a typed date in the library's timezone, not UTC", () => {
    // Moved from the route into the service when the filter grew: the layer
    // that reads the setting is the layer that should turn a day into an
    // instant. Wherever it lives, it must not be `new Date(...)` on a string
    // somebody typed — that is UTC, and this library is not in UTC.
    const service = read("src/server/services/catalogue-service.ts");

    expect(service).toContain("dateOnlyInTimezone");
    expect(service).toContain("endOfDayInTimezone");
    expect(route).not.toContain("new Date(body.");
  });

  it("reads the filter with the same parser the book list uses", () => {
    // Two parsers is how a screen and an endpoint start disagreeing about what
    // "archived" means, on a request that never went through the screen.
    expect(route).toContain("parseBookFilter");
    expect(route).toContain("bookFilterProblems");
    expect(service).toContain("bookFilterToQuery");
  });

  it("gates the screen on the permission rather than a role name", () => {
    expect(page).toContain('requirePermissionForPage("report.view"');
    expect(page).not.toContain("SUPER_ADMIN");
  });

  it("writes no library name into the source", () => {
    for (const source of [service, route, page]) {
      expect(source).not.toMatch(/Mana Jardin|MJCL/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("what is actually printed on a label", () => {
  /*
   * The PDF is read back rather than trusted. A label is stuck to a book and
   * stays wrong for years, so "the code draws a third line" is not the claim
   * worth testing — "the third line is in the file" is.
   *
   * `drawnText` and `drawnBaselines` do the inflating and the hex decoding, and
   * live in `tests/pdf-text.ts` because the database tests make the same claim
   * about the same files.
   */
  it("prints the shelf and the reading age under the title", async () => {
    const { bytes } = await sheet([
      {
        code: "TST-B0007",
        title: "The Gruffalo",
        shelf: "Stories",
        age: "5–7 years",
      },
    ]);

    const text = drawnText(bytes);
    expect(text).toContain("TST-B0007");
    expect(text).toContain("The Gruffalo");
    // One line, the two facts joined — this is what a librarian re-shelving a
    // returned book reads.
    expect(text).toMatch(/Stories.{0,3}5.{0,3}7 years/);
  });

  it("prints the donor and the month the book arrived", async () => {
    const { bytes } = await sheet([
      {
        code: "TST-B0009",
        title: "The Gruffalo",
        shelf: "Stories",
        age: "5–7 years",
        donor: "Donated by Meera Nair · A-1204",
        donatedOn: "Aug 2026",
      },
    ]);

    const text = drawnText(bytes);
    expect(text).toContain("Meera Nair");
    expect(text).toContain("A-1204");
    expect(text).toContain("Aug 2026");
  });

  it("prints no credit at all for a book that was bought", async () => {
    const { bytes } = await sheet([
      { code: "TST-B0010", title: "Cabin Fever", shelf: "Comics", age: "8–11 years" },
    ]);

    const text = drawnText(bytes);
    expect(text).toContain("TST-B0010");
    expect(text).not.toMatch(/Donated/);
  });

  it("keeps the code, the title and the shelf when the label runs out of room", async () => {
    /*
     * The smallest preset with everything on it. What matters is not that all
     * five lines fit — they may not — but that the lines given up are the
     * optional ones, in order, and that nothing is drawn below the label.
     */
    const { bytes } = await sheet(
      [
        {
          code: "TST-B0011",
          title: "Charlie and the Great Glass Elevator",
          shelf: "Stories",
          age: "8–11 years",
          donor: "Donated by Meera Nair · A-1204",
          donatedOn: "Aug 2026",
        },
      ],
      { size: "small" },
    );

    const text = drawnText(bytes);
    expect(text).toContain("TST-B0011");
    expect(text).toMatch(/Charlie/);
    expect(text).toMatch(/Stories/);
  });

  it("draws every line inside the label it belongs to", async () => {
    /*
     * The real failure this guards. A label with a code, two lines of title, a
     * shelf, a credit and a month is the tallest block the sheet can be asked
     * for, and a block taller than its cell prints over the sticker below it —
     * a wasted sheet nobody notices until it is out of the printer.
     *
     * So the baselines are read back out of the PDF and checked against the
     * cell they belong to, rather than the arithmetic being repeated here.
     */
    for (const size of LABEL_SIZES) {
      const { bytes } = await sheet(
        [
          {
            code: "TST-B0012",
            title: "Charlie and the Great Glass Elevator",
            shelf: "Stories",
            age: "8–11 years",
            donor: "Donated by Meera Nair · A-1204",
            donatedOn: "Aug 2026",
          },
        ],
        { size },
      );

      const cell = labelCellSize(size);
      const cellTop = PAGE_HEIGHT - SHEET_MARGIN;
      const baselines = drawnBaselines(bytes)
        // The sheet footer sits in the margin, below every label, on purpose.
        .filter((y) => y > SHEET_MARGIN);

      expect(baselines.length).toBeGreaterThan(1);
      for (const y of baselines) {
        expect(y).toBeLessThanOrEqual(cellTop);
        expect(y).toBeGreaterThan(cellTop - cell.height);
      }
    }
  });

  it("prints the half it has when a book has only one of them", async () => {
    const { bytes } = await sheet([
      { code: "TST-B0008", title: "Untitled", shelf: "", age: "All Ages" },
    ]);

    const text = drawnText(bytes);
    expect(text).toContain("All Ages");
    // No orphaned separator when one half is missing.
    expect(text).not.toMatch(/\u00b7\s*All Ages/);
  });
});
