import "server-only";

import { deflateRawSync } from "node:zlib";

import { formatInTimezone } from "@/lib/dates";
import type { ReportColumn, ReportTable } from "@/server/reports/table";

/**
 * A real `.xlsx`, written by hand.
 *
 * An Office spreadsheet is a ZIP of XML parts, and the subset needed for one
 * sheet of tabular data is small enough to write out completely. That is the
 * whole reason this file exists rather than a dependency: the alternative added
 * a hundred packages, and a transitive advisory, to a system holding children's
 * names. A library that costs more to trust than to replace should be replaced.
 *
 * What is deliberately not here: formulas, charts, merged cells, images,
 * multiple sheets, shared strings. Nothing in a library report needs them.
 *
 * The sheet is *purely tabular* — row 1 is the header, row 2 onwards is data,
 * and nothing else. A title block above the header would look tidier and would
 * break every filter, sort and pivot a librarian might reach for afterwards.
 * Provenance belongs to the filename, the audit log, and the PDF, which is the
 * format meant to be read rather than worked with.
 */

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  body: Buffer;
}

/**
 * A fixed timestamp for every entry.
 *
 * The modification time in a ZIP is local time with no zone, so writing "now"
 * makes the same report produce a different file in every timezone and on every
 * run. Two exports of an unchanged list should be byte-identical; that is worth
 * more than a modification date nobody reads. 1980-01-01 is the epoch of the
 * format itself.
 */
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01

function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.body, { level: 9 });
    const checksum = crc32(entry.body);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/**
 * Drops the characters XML 1.0 cannot express.
 *
 * Excel refuses to open a workbook containing a raw control character, and no
 * escape makes one legal — the grammar simply has no production for most of
 * them. A stray one in a name or a note has to be removed rather than encoded,
 * or one bad byte in one cell makes the whole file unopenable. Tab, newline and
 * carriage return are the three that are legal, and they are kept.
 */
function stripUnrepresentable(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isLegalWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (code < 0x20 && !isLegalWhitespace) continue;
    if (code === 0x7f) continue;
    out += character;
  }
  return out;
}

function xmlText(value: string): string {
  return stripUnrepresentable(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A1, B1 … Z1, AA1. */
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * A date as an Excel serial number, read in the library's own timezone.
 *
 * Excel has no concept of a timezone: a date cell holds a wall-clock reading
 * and nothing else. Deriving the serial from the UTC instant therefore writes
 * whatever the clock said in Greenwich, which for a library at +05:30 is the
 * *previous day* for anything recorded after half past six in the evening — and
 * the PDF, which formats in the library's timezone, would disagree with the
 * spreadsheet about the date of the same donation.
 *
 * So the wall clock is resolved first, in the configured zone, and the serial
 * is built from those parts. The epoch is 1899-12-30 rather than 1900-01-01
 * because Excel deliberately reproduces a 1900 leap-year bug from Lotus 1-2-3,
 * and the shifted epoch is how every implementation agrees with it.
 */
function excelSerial(date: Date, timezone: string): number {
  const [year, month, day, hour, minute, second] = formatInTimezone(
    date,
    timezone,
    "yyyy-MM-dd-HH-mm-ss",
  )
    .split("-")
    .map(Number);

  const days = Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
  return days + (hour * 3600 + minute * 60 + second) / 86_400;
}

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_DATETIME = 2;
const STYLE_DATE = 3;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/*
 * Fills 0 and 1 must be `none` and `gray125`, in that order. Excel indexes the
 * built-in fills positionally and renders every colour wrongly if they are
 * missing — a rule that appears nowhere in the file format's own grammar.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd&quot; &quot;hh:mm"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6F5C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * Excel refuses these characters in a sheet name and truncates past 31. Left as
 * a whole function rather than a regex at the call site because the rule is
 * Excel's, not ours, and it needs somewhere to be written down.
 */
function sheetName(title: string): string {
  const cleaned = title.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Report").slice(0, 31);
}

/** Roughly how wide a column has to be for its widest value to fit. */
function columnWidth<Row>(column: ReportColumn<Row>, rows: Row[]): number {
  let widest = column.header.length;
  for (const row of rows) {
    const cell = column.value(row);
    const text =
      cell === null || cell === undefined
        ? ""
        : cell instanceof Date
          ? "0000-00-00 00:00"
          : String(cell);
    if (text.length > widest) widest = text.length;
    // A single very long note should not push every other column off the screen.
    if (widest >= 60) break;
  }
  return Math.min(Math.max(widest + 2, 8), 60);
}

export function buildXlsx<Row>(table: ReportTable<Row>): Buffer {
  const { columns, rows } = table;

  const cols = columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(column, rows).toFixed(2)}" customWidth="1"/>`,
    )
    .join("");

  const headerCells = columns
    .map(
      (column, index) =>
        `<c r="${columnLetter(index)}1" s="${STYLE_HEADER}" t="inlineStr"><is><t>${xmlText(column.header)}</t></is></c>`,
    )
    .join("");

  const bodyRows = rows
    .map((row, rowIndex) => {
      const reference = rowIndex + 2;
      const cells = columns
        .map((column, columnIndex) => {
          const value = column.value(row);
          const address = `${columnLetter(columnIndex)}${reference}`;

          if (value === null || value === undefined || value === "") {
            return `<c r="${address}" s="${STYLE_DEFAULT}"/>`;
          }
          if (value instanceof Date) {
            const style = column.dateOnly ? STYLE_DATE : STYLE_DATETIME;
            return `<c r="${address}" s="${style}"><v>${excelSerial(value, table.timezone)}</v></c>`;
          }
          if (typeof value === "number") {
            return Number.isFinite(value)
              ? `<c r="${address}" s="${STYLE_DEFAULT}"><v>${value}</v></c>`
              : `<c r="${address}" s="${STYLE_DEFAULT}"/>`;
          }
          if (typeof value === "boolean") {
            return `<c r="${address}" s="${STYLE_DEFAULT}" t="inlineStr"><is><t>${value ? "Yes" : "No"}</t></is></c>`;
          }
          return `<c r="${address}" s="${STYLE_DEFAULT}" t="inlineStr"><is><t>${xmlText(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${reference}">${cells}</row>`;
    })
    .join("");

  const lastColumn = columnLetter(Math.max(columns.length - 1, 0));
  const extent = `A1:${lastColumn}${rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${extent}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData><row r="1" ht="22" customHeight="1">${headerCells}</row>${bodyRows}</sheetData><autoFilter ref="${extent}"/></worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(sheetName(table.title))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  return zip([
    { name: "[Content_Types].xml", body: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", body: Buffer.from(ROOT_RELS, "utf8") },
    { name: "xl/workbook.xml", body: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", body: Buffer.from(WORKBOOK_RELS, "utf8") },
    { name: "xl/styles.xml", body: Buffer.from(STYLES, "utf8") },
    { name: "xl/worksheets/sheet1.xml", body: Buffer.from(sheet, "utf8") },
  ]);
}
