import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import { getAvatar } from "@/lib/avatars";
import {
  CARD,
  CARD_ALPHA,
  CARD_INK,
  CARD_LAYOUT,
  CONTENT_RIGHT,
  CONTENT_WIDTH,
  GUILLOCHE,
  PLINTH_TOP,
  fieldRamp,
  flip,
  foilRamp,
  hexToRgb,
} from "@/lib/card-art";
import { formatInTimezone } from "@/lib/dates";
import { CARD_MESSAGES, cardAllowances, shortRules, type LibraryCardFacts } from "@/lib/library-card";
import { monogram } from "@/lib/readers-board";
import { packagedMarkPng } from "@/server/reports/packaged-mark";
import { winAnsi } from "@/server/reports/winansi";
import type { CardMark } from "@/server/reports/card-mark";

/**
 * The card, as a file a family can keep.
 *
 * One page, card-shaped rather than A4: this is meant to be looked at on a
 * phone or printed and cut out, and a credit-card rectangle centred on a sheet
 * of A4 is neither. Every coordinate comes from `@/lib/card-art`, which the
 * canvas renderer reads too — the picture download and this file are the same
 * drawing, and they can only stay that way if there is one set of numbers.
 *
 * Helvetica and Courier, for the reason the reports use Helvetica: they are
 * among the fourteen faces every reader already has, and embedding the site's
 * own display face to make one card match the website would put most of a
 * megabyte into every download. The colours are the design system's.
 *
 * **No photograph.** The avatar disc is drawn, the child's own picture is not.
 * A PDF is a thing that gets forwarded, and a file carrying a child's face plus
 * their name plus their flat number is a different object from a card in a
 * pocket. The disc and the initial carry enough recognition at none of the
 * risk. The library's own mark is the only image embedded here.
 */

const WIDTH = CARD.width;
const HEIGHT = CARD.height;
const PAD = CARD.pad;

const WHITE = rgb(1, 1, 1);

/** The design system's hex, as pdf-lib's 0–1 triples. */
function ink(hex: string): RGB {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
}

const INK = ink(CARD_INK.ink);
const INK_SOFT = ink(CARD_INK.inkSoft);
const SUN = ink(CARD_INK.sun);
const PLINTH = ink(CARD_INK.plinth);
const LEAF = ink(CARD_INK.leaf);

/** Cuts a string to fit, with an ellipsis when it had to. Same rule as the reports. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, middle).trimEnd()}...`, size) <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low <= 0 ? "" : `${text.slice(0, low).trimEnd()}...`;
}

/** Everything drawn goes through here, or one Kannada name takes the file down. */
function safe(value: string): string {
  return winAnsi(value).text;
}

interface TrackedOptions {
  x: number;
  /** Top-left y, like everything in `card-art`. Flipped here, once. */
  y: number;
  size: number;
  font: PDFFont;
  color: RGB;
  tracking: number;
  opacity?: number;
}

/**
 * Letter-spaced text.
 *
 * `pdf-lib` exposes no character-spacing operator, and the tracked capitals are
 * most of what makes a pass look like a pass rather than a form. One glyph at a
 * time is slower and completely predictable, which for a dozen short labels on
 * one page is the right trade.
 */
function drawTracked(page: PDFPage, text: string, options: TrackedOptions): number {
  const { x, y, size, font, color, tracking, opacity } = options;
  let cursor = x;
  for (const character of text) {
    page.drawText(character, { x: cursor, y: flip(y), size, font, color, opacity });
    cursor += font.widthOfTextAtSize(character, size) + tracking;
  }
  return cursor - tracking - x;
}

function trackedWidth(text: string, font: PDFFont, size: number, tracking: number): number {
  const glyphs = [...text];
  return (
    glyphs.reduce((total, character) => total + font.widthOfTextAtSize(character, size), 0) +
    tracking * Math.max(0, glyphs.length - 1)
  );
}

/** A rounded rectangle, as an SVG path anchored at its top-left corner. */
function roundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    "Z",
  ].join(" ");
}

export async function renderLibraryCardPdf(
  facts: LibraryCardFacts,
  timezone: string,
  mark: CardMark = { bytes: packagedMarkPng, format: "png" },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  pdf.setTitle(safe(`${facts.libraryName} — reader card`));
  pdf.setCreator(safe(facts.libraryName));
  // No author: the author would be a child.

  const page = pdf.addPage([WIDTH, HEIGHT]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const serial = await pdf.embedFont(StandardFonts.CourierBold);

  // ---- The field ----------------------------------------------------------
  // A ramp rather than a gradient: PDF has shading dictionaries, pdf-lib does
  // not expose them, and sixty-four strips are indistinguishable at any zoom a
  // person will use on a card.
  for (const strip of fieldRamp(64)) {
    page.drawRectangle({
      x: 0,
      y: flip(strip.y + strip.height),
      width: WIDTH,
      height: strip.height,
      color: ink(strip.colour),
    });
  }

  // The engraving. Rings swept from two points outside the card; the plinth is
  // painted over the bottom of them a moment later, which is the cheapest
  // clipping there is.
  for (const family of GUILLOCHE) {
    for (const radius of family.radii) {
      page.drawCircle({
        x: family.cx,
        y: flip(family.cy),
        size: radius,
        borderColor: WHITE,
        borderOpacity: CARD_ALPHA.guilloche,
        borderWidth: 0.7,
      });
    }
  }

  // ---- The plinth, and the rule between ------------------------------------
  page.drawRectangle({
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT - PLINTH_TOP,
    color: PLINTH,
  });

  for (const strip of foilRamp(96)) {
    page.drawRectangle({
      x: strip.x,
      y: flip(PLINTH_TOP),
      width: strip.width,
      height: CARD.foilHeight,
      color: ink(strip.colour),
    });
  }

  // ---- The mark ------------------------------------------------------------
  const tile = CARD_LAYOUT.tile;
  page.drawSvgPath(roundedRectPath(tile.size, tile.size, tile.radius), {
    x: tile.x,
    y: flip(tile.y),
    color: WHITE,
  });

  const image =
    mark.format === "png" ? await pdf.embedPng(mark.bytes) : await pdf.embedJpg(mark.bytes);
  const markBox = tile.size - tile.inset * 2;
  // Contain, never stretch: an uploaded logo is any shape at all.
  const scale = Math.min(markBox / image.width, markBox / image.height);
  const markWidth = image.width * scale;
  const markHeight = image.height * scale;
  page.drawImage(image, {
    x: tile.x + (tile.size - markWidth) / 2,
    y: flip(tile.y + (tile.size + markHeight) / 2),
    width: markWidth,
    height: markHeight,
  });

  // ---- The header ----------------------------------------------------------
  const name = CARD_LAYOUT.libraryName;
  const label = CARD_LAYOUT.cardLabel;
  const labelWidth = trackedWidth(label.text, bold, label.size, label.tracking);
  const nameRoom = CONTENT_RIGHT - name.x - labelWidth - 16;

  page.drawText(fit(safe(facts.libraryName), bold, name.size, nameRoom), {
    x: name.x,
    y: flip(name.baseline),
    size: name.size,
    font: bold,
    color: WHITE,
  });

  const community = CARD_LAYOUT.communityName;
  page.drawText(fit(safe(facts.communityName), body, community.size, nameRoom), {
    x: community.x,
    y: flip(community.baseline),
    size: community.size,
    font: body,
    color: WHITE,
    opacity: CARD_ALPHA.community,
  });

  drawTracked(page, label.text, {
    x: CONTENT_RIGHT - labelWidth,
    y: label.baseline,
    size: label.size,
    font: bold,
    color: WHITE,
    tracking: label.tracking,
    opacity: CARD_ALPHA.cardLabel,
  });

  page.drawLine({
    start: { x: PAD, y: flip(CARD_LAYOUT.headRule.y) },
    end: { x: CONTENT_RIGHT, y: flip(CARD_LAYOUT.headRule.y) },
    thickness: 0.6,
    color: WHITE,
    opacity: CARD_ALPHA.divider,
  });

  // ---- The person ----------------------------------------------------------
  const issued = Boolean(facts.memberCode);
  const avatar = CARD_LAYOUT.avatar;

  if (issued) {
    page.drawCircle({
      x: avatar.cx,
      y: flip(avatar.cy),
      size: avatar.r,
      color: ink(getAvatar(facts.avatarKey).color),
      borderColor: WHITE,
      borderOpacity: 0.22,
      borderWidth: 1,
    });

    // A letter, not the emoji: Helvetica has no emoji and `drawText` would throw.
    const initial = safe(monogram(facts.readerName ?? "?"));
    page.drawText(initial, {
      x: avatar.cx - bold.widthOfTextAtSize(initial, avatar.initialSize) / 2,
      y: flip(avatar.cy + avatar.initialSize * 0.35),
      size: avatar.initialSize,
      font: bold,
      color: WHITE,
    });
  }

  const readerLabel = CARD_LAYOUT.readerLabel;
  drawTracked(page, readerLabel.text, {
    x: readerLabel.x,
    y: readerLabel.baseline,
    size: readerLabel.size,
    font: bold,
    color: WHITE,
    tracking: readerLabel.tracking,
    opacity: CARD_ALPHA.readerLabel,
  });

  const readerName = CARD_LAYOUT.readerName;
  const nameWidth = CONTENT_RIGHT - readerName.x;
  page.drawText(fit(safe(facts.readerName ?? CARD_MESSAGES.specimenName), bold, readerName.size, nameWidth), {
    x: readerName.x,
    y: flip(readerName.baseline),
    size: readerName.size,
    font: bold,
    color: WHITE,
    opacity: issued ? 1 : 0.55,
  });

  if (issued) {
    const code = CARD_LAYOUT.memberCode;
    drawTracked(page, safe(facts.memberCode ?? ""), {
      x: code.x,
      y: code.baseline,
      size: code.size,
      font: serial,
      color: SUN,
      tracking: code.tracking,
    });
  }

  // ---- Home, joined, and the one benefit line ------------------------------
  const meta = CARD_LAYOUT.meta;
  const details: string[] = [];
  if (facts.apartment) details.push(`Home ${safe(facts.apartment)}`);
  if (facts.joinedAt) {
    details.push(`Reader since ${formatInTimezone(facts.joinedAt, timezone, "MMM yyyy")}`);
  }
  if (details.length > 0) {
    page.drawText(fit(details.join("   ·   "), body, meta.size, CONTENT_WIDTH * 0.55), {
      x: meta.x,
      y: flip(meta.baseline),
      size: meta.size,
      font: body,
      color: WHITE,
      opacity: CARD_ALPHA.meta,
    });
  }

  const pill = CARD_LAYOUT.pill;
  const pillText = safe(CARD_MESSAGES.free);
  const pillTextWidth = trackedWidth(pillText, bold, pill.size, pill.tracking);
  const pillWidth = pillTextWidth + pill.padX * 2;
  const pillLeft = CONTENT_RIGHT - pillWidth;
  const pillTop = pill.baseline - pill.height + 4.5;

  page.drawSvgPath(roundedRectPath(pillWidth, pill.height, pill.height / 2), {
    x: pillLeft,
    y: flip(pillTop),
    borderColor: WHITE,
    borderOpacity: CARD_ALPHA.pillBorder,
    borderWidth: 0.7,
  });
  drawTracked(page, pillText, {
    x: pillLeft + pill.padX,
    y: pill.baseline,
    size: pill.size,
    font: bold,
    color: SUN,
    tracking: pill.tracking,
  });

  // ---- What the card allows ------------------------------------------------
  if (facts.rules) {
    const stats = CARD_LAYOUT.stats;
    const columns = cardAllowances(facts.rules);
    const columnWidth = CONTENT_WIDTH / columns.length;

    columns.forEach((item, index) => {
      const x = PAD + columnWidth * index;

      if (index > 0) {
        page.drawLine({
          start: { x: x - 10, y: flip(stats.dividerTop) },
          end: { x: x - 10, y: flip(stats.dividerBottom) },
          thickness: 0.6,
          color: WHITE,
          opacity: CARD_ALPHA.statDivider,
        });
      }

      drawTracked(page, safe(item.label.toUpperCase()), {
        x,
        y: stats.labelBaseline,
        size: stats.labelSize,
        font: bold,
        color: WHITE,
        tracking: stats.labelTracking,
        opacity: CARD_ALPHA.statLabel,
      });
      page.drawText(fit(safe(item.value), bold, stats.valueSize, columnWidth - 12), {
        x,
        y: flip(stats.valueBaseline),
        size: stats.valueSize,
        font: bold,
        color: WHITE,
      });
    });
  }

  // ---- House rules along the bottom ----------------------------------------
  const plinthLabel = CARD_LAYOUT.plinthLabel;
  drawTracked(page, plinthLabel.text, {
    x: plinthLabel.x,
    y: plinthLabel.baseline,
    size: plinthLabel.size,
    font: bold,
    color: INK_SOFT,
    tracking: plinthLabel.tracking,
  });

  const rules = CARD_LAYOUT.rules;
  shortRules(facts.rules).forEach((rule, index) => {
    const baseline = rules.firstBaseline + rules.step * index;
    page.drawCircle({
      x: rules.bulletX,
      y: flip(baseline - 2.2),
      size: rules.bulletR,
      color: LEAF,
    });
    page.drawText(fit(safe(rule), body, rules.size, CONTENT_RIGHT - rules.textX), {
      x: rules.textX,
      y: flip(baseline),
      size: rules.size,
      font: body,
      color: INK,
    });
  });

  return pdf.save();
}
