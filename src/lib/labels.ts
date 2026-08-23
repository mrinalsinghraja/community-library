/**
 * Shelf labels: what a sheet of them looks like, and what to call the file.
 *
 * Isomorphic. The form in the browser, the route handler and the PDF writer all
 * read the same presets, so a size cannot exist on a screen and not on the
 * server, or mean two different things in two places.
 *
 * **These sheets are for plain A4 and a pair of scissors, not for pre-cut label
 * stock.** That is a deliberate choice rather than a shortcut. Every brand of
 * 24-up sheet places its die cuts a millimetre or two differently, and a
 * millimetre of error at the top of a page is eight millimetres by the bottom —
 * so a generator that guesses at Avery geometry does not produce slightly
 * imperfect labels, it produces a wasted sheet of stock and no way to tell in
 * advance. A printed grid with cut guides is honest about what it is, costs a
 * sheet of ordinary paper, and a glue stick finishes the job.
 */

/** A4, in PDF points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

/** Sheet margin. Below roughly this, a domestic inkjet clips the edge. */
export const SHEET_MARGIN = 34;

export const LABEL_SIZES = ["large", "standard", "small"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

export function isLabelSize(value: string): value is LabelSize {
  return (LABEL_SIZES as readonly string[]).includes(value);
}

export interface LabelPreset {
  columns: number;
  rows: number;
  /** The book code. Big and bold — it is what someone reads from arm's length. */
  codeSize: number;
  /** The title, under it. */
  titleSize: number;
  /** Breathing room inside one label, so the cut edge never touches ink. */
  padding: number;
}

/**
 * Three sizes, because a picture book's front board and a chapter book's spine
 * are not the same surface.
 *
 * The type sizes are not derived from the cell — they are chosen per preset so
 * that the code stays comfortably readable at every size. Scaling type with the
 * box is how the small preset ends up with a book code nobody can read across a
 * room, which is the entire job of the label.
 */
export const LABEL_PRESETS: Record<LabelSize, LabelPreset> = {
  large: { columns: 2, rows: 7, codeSize: 22, titleSize: 10.5, padding: 12 },
  standard: { columns: 3, rows: 8, codeSize: 16, titleSize: 8.5, padding: 9 },
  small: { columns: 4, rows: 10, codeSize: 12, titleSize: 6.5, padding: 6 },
};

export function labelsPerSheet(size: LabelSize): number {
  const preset = LABEL_PRESETS[size];
  return preset.columns * preset.rows;
}

/** One label's footprint, in points. */
export function labelCellSize(size: LabelSize): { width: number; height: number } {
  const preset = LABEL_PRESETS[size];
  return {
    width: (PAGE_WIDTH - SHEET_MARGIN * 2) / preset.columns,
    height: (PAGE_HEIGHT - SHEET_MARGIN * 2) / preset.rows,
  };
}

const MM_PER_POINT = 25.4 / 72;

/** The same footprint in millimetres, for a human choosing a size. */
export function labelCellMillimetres(size: LabelSize): { width: number; height: number } {
  const { width, height } = labelCellSize(size);
  return {
    width: Math.round(width * MM_PER_POINT),
    height: Math.round(height * MM_PER_POINT),
  };
}

export const LABEL_SIZE_LABELS: Record<LabelSize, string> = {
  large: "Large",
  standard: "Standard",
  small: "Small",
};

/** "24 per sheet, about 61 × 34 mm" — the two facts that decide the choice. */
export function describeLabelSize(size: LabelSize): string {
  const { width, height } = labelCellMillimetres(size);
  return `${labelsPerSheet(size)} per sheet, about ${width} × ${height} mm`;
}

/**
 * How many labels a print run may hold.
 *
 * A cap rather than a page. A whole catalogue rendered into one PDF inside a
 * serverless function is the request that times out, and nobody has ever
 * wanted to stick nine hundred stickers in one sitting.
 */
export const MAX_LABELS = 1000;

/**
 * The download's filename.
 *
 * Carries the library's own name and the day, on the same rule as the report
 * exports: a folder of these stays legible, and two runs on different days do
 * not overwrite each other. Reduced to letters, digits and hyphens, because a
 * filename crosses into an operating system.
 */
export function labelFilename(libraryName: string, now: Date): string {
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

  return `${[slug(libraryName), "book-labels", day].filter(Boolean).join("_")}.pdf`;
}
