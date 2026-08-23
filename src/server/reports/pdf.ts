import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { formatInTimezone } from "@/lib/dates";
import type { ReportColumn, ReportTable } from "@/server/reports/table";
import { winAnsi } from "@/server/reports/winansi";

/**
 * The printable form of a report.
 *
 * Landscape, because these are tables and a table is read across. Helvetica,
 * because it is one of the fourteen faces every PDF reader already has, and
 * embedding a font to make a list of borrowed books look like the website would
 * add a megabyte to every download for no reader's benefit.
 *
 * This format is for reading and filing. The spreadsheet is the one to use for
 * working with the data, and it is the lossless one — see `winAnsi` below.
 */

const PAGE_WIDTH = 842; // A4 landscape, in points
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const HEADER_SIZE = 7.5;
const BODY_SIZE = 8.5;
const ROW_PADDING = 5;
const HEADER_BAND_HEIGHT = 20;
/** Breathing room so a heading sized to its own width is not ellipsised. */
const HEADER_FIT_MARGIN = 2;

const INK = rgb(0.11, 0.13, 0.12);
const INK_SOFT = rgb(0.42, 0.45, 0.43);
const BRAND = rgb(0.122, 0.435, 0.361); // the library's primary green
const HAIRLINE = rgb(0.85, 0.86, 0.85);
const BAND = rgb(0.965, 0.972, 0.96);

/** Cuts a string to fit a column, with an ellipsis when it had to. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, middle).trimEnd()}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low <= 0 ? "" : `${text.slice(0, low).trimEnd()}…`;
}

function renderCell<Row>(column: ReportColumn<Row>, row: Row, timezone: string): string {
  const value = column.value(row);
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return formatInTimezone(value, timezone, column.dateOnly ? "d MMM yyyy" : "d MMM yyyy, HH:mm");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Shares the page width out between the columns.
 *
 * Width follows the widest thing a column actually holds rather than an
 * author's guess, so a table of short codes does not get the same slice as one
 * of book titles.
 *
 * When it does not all fit, the space is filled like water rather than scaled
 * down uniformly. A proportional squeeze shrinks a ten-character book code by
 * the same fraction as a forty-character title, which is how "MJCL-B0009"
 * became "MJCL…" on a page that still had room: the *narrow* columns are the
 * ones that can least afford it and the ones that need shrinking least. So each
 * pass gives every column the smaller of what it wants and an equal share, and
 * hands whatever the modest columns did not take back to the greedy ones. Only
 * genuinely long text is ever truncated.
 *
 * Measuring is done on the *sanitised* text, not the original.
 * `widthOfTextAtSize` throws on a character the font cannot encode exactly as
 * `drawText` does, so measuring first and filtering later would crash on the
 * row it was supposed to make safe.
 */
/**
 * Exported under a deliberately ugly name for the test that pins the heading
 * rule. Widths are not observable from a compressed content stream, and the
 * alternative — asserting that a rendered PDF "looks right" — is what let two
 * columns both read "DAYS…" for as long as they did.
 */
export const __columnWidthsForTest = columnWidths;

function columnWidths<Row>(
  columns: ReportColumn<Row>[],
  rows: Row[],
  font: PDFFont,
  timezone: string,
  safe: (value: string) => string,
): number[] {
  /*
   * Two numbers per column.
   *
   * `minimum` is what the heading needs to be readable — measured in the case
   * it is DRAWN in, because `startPage` uppercases it and uppercase Helvetica
   * runs about a sixth wider than mixed case.
   *
   * `natural` is what the column would like: the widest thing in it, header or
   * cell, scaled by the author's weight.
   */
  const minimum = columns.map(
    (column) =>
      font.widthOfTextAtSize(safe(column.header.toUpperCase()), HEADER_SIZE) +
      ROW_PADDING * 2 +
      // A hair of slack. Sized to exactly the heading, `fit` compares a width
      // against itself and a float away from equal is enough to ellipsise a
      // heading that does fit.
      HEADER_FIT_MARGIN,
  );

  const natural = columns.map((column, index) => {
    let widest = 0;
    for (const row of rows.slice(0, 400)) {
      const width = font.widthOfTextAtSize(safe(renderCell(column, row, timezone)), BODY_SIZE);
      if (width > widest) widest = width;
    }
    return Math.max(minimum[index], (widest + ROW_PADDING * 2) * (column.weight ?? 1));
  });

  const total = natural.reduce((sum, width) => sum + width, 0);

  if (total <= CONTENT_WIDTH) {
    /*
     * Everything fits. The leftover is shared out in proportion to what each
     * column already holds, so the wordy columns get most of it and a column of
     * one-digit counts is not stretched across an inch of paper — but neither
     * does one column swallow the lot, which is what dumping the whole slack on
     * the single widest one did.
     */
    const slack = CONTENT_WIDTH - total;
    return natural.map((width) => width + (width / total) * slack);
  }

  /*
   * It does not fit, so something must give — and it must not be the headings.
   *
   * The rule is that every column keeps enough room for its own heading, and
   * the squeeze is shared out across whatever each column wanted *above* that
   * minimum, in proportion. A truncated title still names a recognisable book;
   * a truncated heading turns a column of numbers into a mystery, and two
   * different columns reading "DAYS…" is worse than either.
   *
   * Earlier this filled each column like water to an equal share, which had no
   * notion of a heading at all: a column of one-character counts under a long
   * heading was handed a narrow share and shortened to "BA…".
   */
  const floorTotal = minimum.reduce((sum, width) => sum + width, 0);

  if (floorTotal >= CONTENT_WIDTH) {
    /*
     * Even the headings alone overflow the page. Nothing can be shown in full,
     * so every column is scaled down together — an honest last resort, and the
     * signal that a report has been given more columns than A4 can hold.
     */
    const scale = CONTENT_WIDTH / floorTotal;
    return minimum.map((width) => width * scale);
  }

  const spare = CONTENT_WIDTH - floorTotal;
  const appetite = natural.map((width, index) => width - minimum[index]);

  /*
   * The spare is shared out by the SQUARE ROOT of what each column wants.
   *
   * Straight proportion sounds fairer and is not. A title column asks for four
   * hundred points and a date column for ten, so proportion hands almost the
   * whole surplus to the title and leaves the date ten points short of "19 Aug
   * 2026" — which then prints as "19 Aug 2…" and has lost the year. Damping the
   * appetite still favours the wordy columns, which genuinely need the room,
   * without letting one of them starve every fixed-width neighbour.
   *
   * The asymmetry is deliberate: a clipped title is still a recognisable book,
   * where a clipped date or a clipped book code is no longer information.
   */
  const share = appetite.map((want) => Math.sqrt(Math.max(want, 0)));
  const totalShare = share.reduce((sum, want) => sum + want, 0);

  if (totalShare <= 0) return [...minimum];

  const widths = minimum.map((width, index) => width + (share[index] / totalShare) * spare);

  /*
   * Nothing may end up wider than it asked for. A column that reached its
   * natural width hands the excess back, and the loop re-shares it among the
   * columns still short — so the surplus ends where it is actually wanted
   * rather than padding a column of two-digit counts.
   */
  for (let pass = 0; pass < 4; pass += 1) {
    let returned = 0;
    const hungry: number[] = [];

    widths.forEach((width, index) => {
      if (width > natural[index]) {
        returned += width - natural[index];
        widths[index] = natural[index];
      } else if (width < natural[index]) {
        hungry.push(index);
      }
    });

    if (returned <= 0.01 || hungry.length === 0) break;

    const hungryShare = hungry.reduce((sum, index) => sum + share[index], 0);
    if (hungryShare <= 0) break;
    for (const index of hungry) {
      widths[index] += (share[index] / hungryShare) * returned;
    }
  }

  return widths;
}

interface Chrome {
  page: PDFPage;
  y: number;
}

export interface RenderedPdf {
  bytes: Buffer;
  /**
   * True when at least one character could not be drawn in a standard font.
   *
   * Returned rather than kept private because it is the one thing about this
   * file a caller might need to act on, and because a page's own footnote is
   * not something a test can read back out of a compressed content stream.
   */
  unrepresentable: boolean;
}

export async function buildPdf<Row>(table: ReportTable<Row>): Promise<RenderedPdf> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`${table.title} — ${table.libraryName}`);
  pdf.setCreator(table.libraryName);
  pdf.setProducer(table.libraryName);
  pdf.setCreationDate(table.generatedAt);

  let anythingLost = false;

  /** The single gate every string passes through before a font ever sees it. */
  const safe = (value: string): string => {
    const { text, lost } = winAnsi(value);
    if (lost) anythingLost = true;
    return text;
  };

  const widths = columnWidths(table.columns, table.rows, regular, table.timezone, safe);
  const rowHeight = BODY_SIZE + ROW_PADDING * 2;

  const draw = (page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, colour = INK) => {
    const drawable = safe(text);
    if (drawable) page.drawText(drawable, { x, y, size, font, color: colour });
  };

  const pages: PDFPage[] = [];

  const startPage = (): Chrome => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    let y = PAGE_HEIGHT - MARGIN;

    if (pages.length === 1) {
      // The masthead appears once. Repeating the library's name and the
      // generation time on page nine helps nobody; the column headers do have
      // to repeat, and they do.
      draw(page, table.libraryName.toUpperCase(), MARGIN, y - 9, 8, bold, BRAND);
      y -= 26;
      draw(page, table.title, MARGIN, y - 16, 20, bold);
      y -= 34;
      const provenance = `${table.scopeLabel} · exported ${formatInTimezone(table.generatedAt, table.timezone, "d MMM yyyy, HH:mm")} by ${table.generatedBy}`;
      draw(page, provenance, MARGIN, y - 8, 8.5, regular, INK_SOFT);
      y -= 22;
    } else {
      draw(page, `${table.title} — continued`, MARGIN, y - 9, 10, bold, INK_SOFT);
      y -= 24;
    }

    // Column header band.
    page.drawRectangle({
      x: MARGIN,
      y: y - HEADER_BAND_HEIGHT,
      width: CONTENT_WIDTH,
      height: HEADER_BAND_HEIGHT,
      color: BRAND,
    });
    let x = MARGIN;
    table.columns.forEach((column, index) => {
      draw(
        page,
        fit(safe(column.header.toUpperCase()), bold, HEADER_SIZE, widths[index] - ROW_PADDING * 2),
        x + ROW_PADDING,
        y - HEADER_BAND_HEIGHT + 7,
        HEADER_SIZE,
        bold,
        rgb(1, 1, 1),
      );
      x += widths[index];
    });
    y -= HEADER_BAND_HEIGHT;

    return { page, y };
  };

  let chrome = startPage();

  if (table.rows.length === 0) {
    draw(chrome.page, "Nothing to export.", MARGIN, chrome.y - 20, 10, regular, INK_SOFT);
  }

  table.rows.forEach((row, rowIndex) => {
    if (chrome.y - rowHeight < MARGIN + 24) chrome = startPage();

    const top = chrome.y;
    if (rowIndex % 2 === 1) {
      chrome.page.drawRectangle({
        x: MARGIN,
        y: top - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: BAND,
      });
    }

    let x = MARGIN;
    table.columns.forEach((column, index) => {
      const text = safe(renderCell(column, row, table.timezone));
      draw(
        chrome.page,
        fit(text, regular, BODY_SIZE, widths[index] - ROW_PADDING * 2),
        x + ROW_PADDING,
        top - rowHeight + ROW_PADDING + 1,
        BODY_SIZE,
        regular,
      );
      x += widths[index];
    });

    chrome.page.drawLine({
      start: { x: MARGIN, y: top - rowHeight },
      end: { x: MARGIN + CONTENT_WIDTH, y: top - rowHeight },
      thickness: 0.5,
      color: HAIRLINE,
    });

    chrome.y = top - rowHeight;
  });

  // Footers last, so the page count is known and the "characters dropped" note
  // is only made once every row has actually been through the encoder.
  pages.forEach((page, index) => {
    const left = anythingLost
      ? "Some characters cannot be shown in this format. The Excel export has the exact text."
      : "";
    if (left) {
      const { text } = winAnsi(left);
      page.drawText(text, { x: MARGIN, y: MARGIN - 14, size: 7.5, font: regular, color: INK_SOFT });
    }
    const label = `Page ${index + 1} of ${pages.length}`;
    page.drawText(label, {
      x: MARGIN + CONTENT_WIDTH - regular.widthOfTextAtSize(label, 7.5),
      y: MARGIN - 14,
      size: 7.5,
      font: regular,
      color: INK_SOFT,
    });
  });

  return { bytes: Buffer.from(await pdf.save()), unrepresentable: anythingLost };
}
