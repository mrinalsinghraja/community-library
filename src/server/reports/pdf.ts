import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { formatInTimezone } from "@/lib/dates";
import type { ReportColumn, ReportTable } from "@/server/reports/table";

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

const INK = rgb(0.11, 0.13, 0.12);
const INK_SOFT = rgb(0.42, 0.45, 0.43);
const BRAND = rgb(0.122, 0.435, 0.361); // the library's primary green
const HAIRLINE = rgb(0.85, 0.86, 0.85);
const BAND = rgb(0.965, 0.972, 0.96);

/**
 * The characters a standard PDF font can actually draw.
 *
 * The fourteen built-in faces are encoded in WinAnsi, which is Latin-1 plus a
 * short list of typographic extras. A child's name written in Assamese or
 * Devanagari is not in it, and `drawText` throws rather than guessing — so the
 * text has to be filtered before it reaches the page or one name takes the
 * whole export down.
 *
 * Filtering loses information, which is why it is reported rather than hidden:
 * when anything is dropped the page says so and names the spreadsheet, which is
 * UTF-8 and loses nothing. Silently replacing somebody's name with question
 * marks and handing over the file is the one behaviour that is not acceptable.
 */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isDrawable(code: number): boolean {
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(code);
}

interface Sanitised {
  text: string;
  lost: boolean;
}

function winAnsi(value: string): Sanitised {
  let text = "";
  let lost = false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (isDrawable(code)) {
      text += character;
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      text += " ";
    } else {
      lost = true;
    }
  }
  return { text, lost };
}

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
function columnWidths<Row>(
  columns: ReportColumn<Row>[],
  rows: Row[],
  font: PDFFont,
  timezone: string,
  safe: (value: string) => string,
): number[] {
  const natural = columns.map((column) => {
    let widest = font.widthOfTextAtSize(safe(column.header), HEADER_SIZE);
    for (const row of rows.slice(0, 400)) {
      const width = font.widthOfTextAtSize(safe(renderCell(column, row, timezone)), BODY_SIZE);
      if (width > widest) widest = width;
    }
    return (widest + ROW_PADDING * 2) * (column.weight ?? 1);
  });

  const total = natural.reduce((sum, width) => sum + width, 0);

  if (total <= CONTENT_WIDTH) {
    // Everything fits: give the slack to the widest column rather than
    // stretching a column of dates across half the page.
    const slack = CONTENT_WIDTH - total;
    const widths = [...natural];
    widths[natural.indexOf(Math.max(...natural))] += slack;
    return widths;
  }

  const widths = new Array<number>(columns.length).fill(0);
  const settled = new Array<boolean>(columns.length).fill(false);
  let remaining = CONTENT_WIDTH;
  let unsettled = columns.length;

  // Each pass settles at least one column, so this cannot run away.
  for (let pass = 0; pass < columns.length && unsettled > 0; pass += 1) {
    const share = remaining / unsettled;
    let settledThisPass = false;

    for (let index = 0; index < columns.length; index += 1) {
      if (settled[index] || natural[index] > share) continue;
      widths[index] = natural[index];
      settled[index] = true;
      remaining -= natural[index];
      unsettled -= 1;
      settledThisPass = true;
    }

    if (!settledThisPass) break;
  }

  // Whatever is still unsettled genuinely wants more than its share; those are
  // the columns that get truncated, and they split what is left between them.
  if (unsettled > 0) {
    const share = remaining / unsettled;
    for (let index = 0; index < columns.length; index += 1) {
      if (!settled[index]) widths[index] = share;
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
