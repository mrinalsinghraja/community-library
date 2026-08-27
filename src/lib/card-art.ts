/**
 * The card, as geometry.
 *
 * The reader's card is drawn three times — in the browser as elements, onto a
 * canvas for the picture download, and by `pdf-lib` for the PDF. The words and
 * numbers already come from one place (`@/lib/library-card`); this is the same
 * discipline for the drawing. Every coordinate, colour and type size the two
 * pixel renderers use lives here, so a card that is redesigned is redesigned
 * once instead of twice-and-a-bit.
 *
 * The screen version reads the palette but keeps its own layout: it has to be
 * fluid from a phone to a desktop, and a fixed 380-point grid is exactly what a
 * responsive card must not be. What it may not do is drift in *content* or in
 * *colour*, and both of those are pinned below.
 *
 * ## The coordinate system
 *
 * Points, origin top-left, y increasing downwards — the canvas convention,
 * because it is also how anybody reading the layout thinks. PDF space runs the
 * other way, so the PDF renderer flips once, at the edge, with `flip()`.
 *
 * 380 × 240 is a 1.58 rectangle: the proportion of a bank card, which is the
 * object this is meant to feel like when it comes out of a wallet.
 */

export const CARD = {
  width: 380,
  height: 240,
  pad: 24,
  /** The dark field, top. Everything that identifies the reader sits here. */
  fieldHeight: 176,
  /** The colour rule that separates the field from the plinth. */
  foilHeight: 2.5,
} as const;

export const PLINTH_TOP = CARD.fieldHeight + CARD.foilHeight;
export const CONTENT_WIDTH = CARD.width - CARD.pad * 2;
export const CONTENT_RIGHT = CARD.width - CARD.pad;

/**
 * The palette.
 *
 * The field is a deepened form of the house green — the same hue the whole
 * library is built on, taken down far enough that white type sits on it at
 * 15:1 and the mark reads as an inlay rather than a sticker. The code is drawn
 * in the sun tone, which is a fill colour on the light pages and a legible
 * 6.4:1 here; it is the one warm thing on a cold field, and it is the number a
 * librarian actually has to read off the card.
 */
export const CARD_INK = {
  fieldTop: "#17624F",
  fieldBase: "#0A362D",
  white: "#FFFFFF",
  /** The member code, and the one benefit line. */
  sun: "#F2C57C",
  ink: "#2B2118",
  inkSoft: "#5C4F42",
  plinth: "#F6EFE3",
  hairline: "#E3D9C9",
  leaf: "#78B030",
  primary: "#1F6F5C",
  accent: "#A82878",
} as const;

/** How opaque each of the quieter marks on the dark field is. */
export const CARD_ALPHA = {
  community: 0.68,
  cardLabel: 0.6,
  divider: 0.14,
  readerLabel: 0.55,
  meta: 0.72,
  statLabel: 0.58,
  statDivider: 0.18,
  pillBorder: 0.3,
  guilloche: 0.055,
} as const;

/**
 * Where everything goes. Baselines, not boxes: both renderers draw text from a
 * baseline, and a box would have to be converted twice.
 */
export const CARD_LAYOUT = {
  /** The mark's tile: white, rounded, the size of a chip on a bank card. */
  tile: { x: CARD.pad, y: 20, size: 36, radius: 8, inset: 3.5 },

  libraryName: { x: CARD.pad + 36 + 12, baseline: 36, size: 11.5 },
  communityName: { x: CARD.pad + 36 + 12, baseline: 47, size: 7 },
  /** Right-aligned. Two words, wide-tracked, the way a pass is titled. */
  cardLabel: { baseline: 32, size: 6.2, tracking: 1.9, text: "READER CARD" },

  headRule: { y: 66 },

  avatar: { cx: CARD.pad + 19, cy: 104, r: 19, initialSize: 18 },
  readerLabel: { x: CARD.pad + 38 + 14, baseline: 92, size: 6, tracking: 1.5, text: "READER" },
  readerName: { x: CARD.pad + 38 + 14, baseline: 112, size: 19 },
  memberCode: { x: CARD.pad + 38 + 14, baseline: 127, size: 9.5, tracking: 1.7 },

  meta: { x: CARD.pad, baseline: 143, size: 7.5 },
  /** Right-aligned, vertically centred on the meta line. */
  pill: { baseline: 143, height: 15, size: 6.2, tracking: 0.5, padX: 9 },

  stats: {
    dividerTop: 148,
    dividerBottom: 170,
    labelBaseline: 157,
    labelSize: 6,
    labelTracking: 1.2,
    valueBaseline: 168,
    valueSize: 13,
  },

  plinthLabel: { x: CARD.pad, baseline: 192, size: 5.8, tracking: 1.7, text: "LOOKING AFTER A BOOK" },
  rules: { bulletX: 27, bulletR: 1.3, textX: 33, firstBaseline: 205, step: 9.5, size: 7 },
} as const;

/**
 * The engraving.
 *
 * Concentric rings swept from two points outside the card, at an opacity that
 * is felt rather than seen. It is the guilloche of a banknote or a share
 * certificate reduced to its simplest form, and it is the one thing that stops
 * a large flat rectangle of green reading as a coloured box.
 *
 * Neither renderer clips: the rings are drawn onto the field first and the
 * plinth is painted over the bottom of them, which costs nothing and works
 * identically in a canvas and in a PDF.
 */
export const GUILLOCHE: readonly { cx: number; cy: number; radii: readonly number[] }[] = [
  { cx: 330, cy: 16, radii: [46, 67, 88, 109, 130, 151, 172, 193, 214, 235] },
  { cx: 40, cy: 200, radii: [64, 88, 112, 136, 160] },
];

/** Splits the field into strips for a renderer with no gradients of its own. */
export function fieldRamp(steps: number): { y: number; height: number; colour: string }[] {
  const height = CARD.fieldHeight / steps;
  return Array.from({ length: steps }, (_, index) => ({
    y: index * height,
    // A quarter point of overlap, or the strips show as hairlines when the
    // reader zooms in.
    height: height + 0.25,
    colour: mixHex(CARD_INK.fieldTop, CARD_INK.fieldBase, index / (steps - 1)),
  }));
}

/** The foil rule, as a ramp through the three house colours. */
export function foilRamp(steps: number): { x: number; width: number; colour: string }[] {
  const width = CARD.width / steps;
  return Array.from({ length: steps }, (_, index) => {
    const t = index / (steps - 1);
    const colour =
      t < 0.5
        ? mixHex(CARD_INK.leaf, CARD_INK.primary, t * 2)
        : mixHex(CARD_INK.primary, CARD_INK.accent, (t - 0.5) * 2);
    return { x: index * width, width: width + 0.25, colour };
  });
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** Linear blend, `t` from 0 (first) to 1 (second). */
export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (x: number, y: number) =>
    Math.round(x + (y - x) * Math.min(1, Math.max(0, t)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/** Turns a top-left y into the PDF's bottom-left one. */
export function flip(y: number): number {
  return CARD.height - y;
}

/** The mark's true aspect (640 × 690), so nothing is ever squashed. */
export const MARK_RATIO = 690 / 640;

/**
 * The mark packaged with this deployment.
 *
 * A deployment asset, not a platform default: it lives in `public/`, never in
 * `src/`, so another community installing this software replaces one file (or
 * uploads their own logo) without touching a line of code. Named here because
 * three renderers need the same fallback and a path typed three times is a path
 * that will be wrong in one of them.
 */
export const PACKAGED_MARK_URL = "/brand/library-mark.png";
