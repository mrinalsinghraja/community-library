import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  LABEL_PRESETS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SHEET_MARGIN,
  labelCellSize,
  type LabelSize,
} from "@/lib/labels";
import { winAnsi } from "@/server/reports/winansi";

/**
 * A sheet of shelf labels.
 *
 * Portrait, unlike the table exports, because labels tile and a portrait A4
 * tiles into more of them. Helvetica, for the same reason the tables use it:
 * one of the fourteen faces every PDF reader already has, so nothing has to be
 * embedded and the file stays small enough to print from a phone.
 *
 * The code is set large and bold because it is what somebody reads while
 * crouched at a shelf; the title sits under it in a size chosen to fit two
 * lines of a real children's book title; and under that, quietly, the shelf and
 * the reading age.
 *
 * That third line was added because the first two answer "which book is this?"
 * and neither answers "where does it go back?". A returned book with a code and
 * a title on it still had to be looked up before it could be re-shelved, which
 * is the one job a shelf label exists to save. It stays small and grey: it is
 * read by somebody already holding the book, not from across the room.
 */

const INK = rgb(0.11, 0.13, 0.12);
const INK_SOFT = rgb(0.42, 0.45, 0.43);
const BRAND = rgb(0.122, 0.435, 0.361); // the library's primary green
const GUIDE = rgb(0.8, 0.82, 0.8);

/** The gap between the code's baseline and the first line of the title. */
const LINE_GAP = 1.35;
/** At most two lines of title, which is what "two lines" in the brief means. */
const MAX_TITLE_LINES = 2;

export interface LabelRow {
  code: string;
  title: string;
  /**
   * The shelf this book belongs on, and the age it was written for, already
   * turned into words by the caller.
   *
   * Words, not enum keys, because this file draws — it must not know that
   * `AGE_8_11` exists, and the catalogue's own vocabulary lives in one place in
   * `src/lib/catalogue.ts`. Either may be empty and the line is then skipped.
   */
  shelf: string;
  age: string;
}

export interface LabelSheetRequest {
  rows: LabelRow[];
  size: LabelSize;
  libraryName: string;
  /** "Books added 17–23 August 2026" — printed once, in the sheet footer. */
  scopeLabel: string;
  generatedAt: Date;
  /** Hairlines on the grid, for cutting. Off when printing onto die-cut stock. */
  cutGuides: boolean;
}

export interface RenderedLabels {
  bytes: Buffer;
  /** True when a title held characters Helvetica cannot draw. See `winAnsi`. */
  unrepresentable: boolean;
  sheetCount: number;
}

/**
 * Breaks a title into at most `maxLines` lines that each fit `maxWidth`.
 *
 * Wraps on spaces, and falls back to cutting mid-word for the kind of single
 * long token — a hyphenated compound, a transliterated name — that would
 * otherwise overflow the label silently. The last line is ellipsised when there
 * is more title than room, so a truncated label looks truncated rather than
 * looking like the book is called something shorter than it is.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const width = (value: string) => font.widthOfTextAtSize(value, size);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines < 1 || maxWidth <= 0) return [];

  /*
   * Tokens first, then lines.
   *
   * A word wider than the whole label — a hyphenated compound, a transliterated
   * name — is cut into pieces that do fit before any line is built. Doing it
   * here rather than inside the wrapping loop keeps the loop to one rule: take
   * the next token if it fits, otherwise start a line.
   */
  const tokens: string[] = [];
  for (const word of words) {
    if (width(word) <= maxWidth) {
      tokens.push(word);
      continue;
    }
    let piece = "";
    for (const character of word) {
      if (piece && width(piece + character) > maxWidth) {
        tokens.push(piece);
        piece = character;
      } else {
        piece += character;
      }
    }
    if (piece) tokens.push(piece);
  }

  const lines: string[] = [];
  let current = "";
  let consumed = 0;

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (width(candidate) <= maxWidth) {
      current = candidate;
      consumed += 1;
      continue;
    }
    lines.push(current);
    if (lines.length === maxLines) break;
    current = token;
    consumed += 1;
  }

  if (current && lines.length < maxLines) lines.push(current);

  /*
   * Anything left over is marked, never dropped quietly. A label reading "The
   * Very Hungry" is a label for a book that does not exist; "The Very Hungry…"
   * is a label for a book whose name did not fit, and a person can tell the
   * difference at a glance.
   */
  if (consumed < tokens.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last && width(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = last ? `${last}…` : "…";
  }

  return lines;
}

/** Shrinks a code until it fits the label, so a long code is never clipped. */
function fitSize(text: string, font: PDFFont, start: number, maxWidth: number): number {
  let size = start;
  while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

export async function buildLabelSheet(request: LabelSheetRequest): Promise<RenderedLabels> {
  const preset = LABEL_PRESETS[request.size];
  const cell = labelCellSize(request.size);
  const perSheet = preset.columns * preset.rows;

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`Book labels — ${request.libraryName}`);
  pdf.setCreator(request.libraryName);
  pdf.setProducer(request.libraryName);
  pdf.setCreationDate(request.generatedAt);

  let anythingLost = false;

  /** The single gate every string passes through before a font ever sees it. */
  const safe = (value: string): string => {
    const { text, lost } = winAnsi(value);
    if (lost) anythingLost = true;
    return text;
  };

  const sheetCount = Math.max(1, Math.ceil(request.rows.length / perSheet));
  const pages: PDFPage[] = [];

  for (let sheet = 0; sheet < sheetCount; sheet += 1) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);

    if (request.cutGuides) {
      for (let column = 0; column <= preset.columns; column += 1) {
        const x = SHEET_MARGIN + column * cell.width;
        page.drawLine({
          start: { x, y: SHEET_MARGIN },
          end: { x, y: PAGE_HEIGHT - SHEET_MARGIN },
          thickness: 0.4,
          color: GUIDE,
        });
      }
      for (let row = 0; row <= preset.rows; row += 1) {
        const y = SHEET_MARGIN + row * cell.height;
        page.drawLine({
          start: { x: SHEET_MARGIN, y },
          end: { x: PAGE_WIDTH - SHEET_MARGIN, y },
          thickness: 0.4,
          color: GUIDE,
        });
      }
    }

    const slice = request.rows.slice(sheet * perSheet, (sheet + 1) * perSheet);

    slice.forEach((row, index) => {
      const column = index % preset.columns;
      const line = Math.floor(index / preset.columns);

      const left = SHEET_MARGIN + column * cell.width + preset.padding;
      const innerWidth = cell.width - preset.padding * 2;

      const code = safe(row.code);
      const codeSize = fitSize(code, bold, preset.codeSize, innerWidth);
      const titleLines = wrapText(
        safe(row.title),
        regular,
        preset.titleSize,
        innerWidth,
        MAX_TITLE_LINES,
      );

      /*
       * The two lines are measured, then centred in the label.
       *
       * Hanging them from the top is what the first version did, and it left
       * most of every sticker blank — a one-line title on a standard label sat
       * in the top third with two centimetres of nothing under it. A label is
       * cut out and looked at on its own, so the block has to sit in the middle
       * of the piece of paper somebody is actually holding.
       */
      /*
       * "Stories · 8–11 years", or whichever half of it exists. One line, never
       * wrapped: a shelf name that will not fit is shortened by `wrapText`
       * rather than allowed to push the block out of the label.
       */
      const meta = [row.shelf, row.age].filter(Boolean).join(" · ");
      const metaLines = meta
        ? wrapText(safe(meta), regular, preset.metaSize, innerWidth, 1)
        : [];

      const blockHeight =
        codeSize +
        titleLines.length * preset.titleSize * LINE_GAP +
        metaLines.length * preset.metaSize * LINE_GAP;
      // Rows fill from the top of the page; PDF's origin is the bottom.
      const cellTop = PAGE_HEIGHT - SHEET_MARGIN - line * cell.height;
      const blockTop = cellTop - Math.max(preset.padding, (cell.height - blockHeight) / 2);
      const codeBaseline = blockTop - codeSize;

      if (code) {
        page.drawText(code, { x: left, y: codeBaseline, size: codeSize, font: bold, color: BRAND });
      }

      titleLines.forEach((text, lineIndex) => {
        page.drawText(text, {
          x: left,
          y: codeBaseline - preset.titleSize * LINE_GAP * (lineIndex + 1),
          size: preset.titleSize,
          font: regular,
          color: INK,
        });
      });

      const titleBottom = codeBaseline - preset.titleSize * LINE_GAP * titleLines.length;
      metaLines.forEach((text, lineIndex) => {
        page.drawText(text, {
          x: left,
          y: titleBottom - preset.metaSize * LINE_GAP * (lineIndex + 1),
          size: preset.metaSize,
          font: regular,
          color: INK_SOFT,
        });
      });
    });
  }

  /*
   * The footer is drawn last, once every label has been through the encoder, so
   * the note about dropped characters can only be made when something really
   * was dropped. It sits in the sheet margin rather than in a label, so it is
   * cut away with the offcuts and never ends up stuck to a book.
   */
  pages.forEach((page, index) => {
    const note = anythingLost
      ? "Some characters cannot be printed in this format — check those titles before sticking."
      : `${request.libraryName} · ${request.scopeLabel}`;
    const { text } = winAnsi(note);
    page.drawText(text, {
      x: SHEET_MARGIN,
      y: SHEET_MARGIN - 16,
      size: 7,
      font: regular,
      color: anythingLost ? INK : INK_SOFT,
    });

    const counter = `Sheet ${index + 1} of ${pages.length}`;
    page.drawText(counter, {
      x: PAGE_WIDTH - SHEET_MARGIN - regular.widthOfTextAtSize(counter, 7),
      y: SHEET_MARGIN - 16,
      size: 7,
      font: regular,
      color: INK_SOFT,
    });
  });

  return {
    bytes: Buffer.from(await pdf.save()),
    unrepresentable: anythingLost,
    sheetCount: pages.length,
  };
}
