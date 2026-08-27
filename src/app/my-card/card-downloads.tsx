"use client";

import { useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getAvatar } from "@/lib/avatars";
import {
  CARD,
  CARD_ALPHA,
  CARD_INK,
  CARD_LAYOUT,
  CONTENT_RIGHT,
  CONTENT_WIDTH,
  GUILLOCHE,
  PACKAGED_MARK_URL,
  PLINTH_TOP,
  foilRamp,
} from "@/lib/card-art";
import {
  CARD_MESSAGES,
  cardAllowances,
  cardFileName,
  shortRules,
  type CardRules,
} from "@/lib/library-card";
import { monogram } from "@/lib/readers-board";

/**
 * Taking the card away with you.
 *
 * Two formats, because families use two things: a picture goes in a phone's
 * gallery and into a message, a PDF prints at the right size and survives being
 * emailed. The PDF is a link to a route — the server already draws it — and the
 * picture is drawn here, on a canvas.
 *
 * ## Why the canvas, and what it costs
 *
 * Rasterising the rendered card would mean either a screenshot library (a
 * dependency this application does not need) or an SVG `foreignObject` (which
 * silently loses self-hosted fonts). Drawing it is a third renderer of the same
 * card, which is a real cost — so every word it draws comes from
 * `@/lib/library-card` and every coordinate from `@/lib/card-art`, the same two
 * modules the page and the PDF read. Only the typeface differs, and it differs
 * in the picture's favour: this one has the library's own face to draw with.
 *
 * ## The mark, and the face that is not here
 *
 * The library's logo is drawn — same source the screen uses, same tile — so the
 * saved picture is the card and not an approximation of it. The child's
 * photograph is not, and neither is their avatar's emoji, which the PDF's
 * standard fonts cannot draw and which would make the two downloads two
 * different cards. Both saved formats carry the coloured disc and the initial.
 *
 * A file gets forwarded; a picture carrying a child's face, their name and
 * their flat number together is a different object from a card in a pocket.
 */

/** Drawn at three times the card's point size, so it is crisp on a phone. */
const SCALE = 3;
const W = CARD.width * SCALE;
const H = CARD.height * SCALE;

export interface CardDownloadFacts {
  readerName: string;
  memberCode: string;
  apartment: string | null;
  joinedLabel: string | null;
  avatarKey: string | null;
  libraryName: string;
  communityName: string;
  logoUrl: string | null;
  rules: CardRules | null;
}

export function CardDownloads({ facts }: { facts: CardDownloadFacts }) {
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function downloadPng() {
    setFailed(false);
    setWorking(true);
    try {
      // Self-hosted faces are not ready the instant the component mounts, and a
      // canvas drawn before they load falls back to a system serif.
      if (document.fonts?.ready) await document.fonts.ready;

      const mark = await loadMark(facts.logoUrl ?? PACKAGED_MARK_URL);

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");

      drawCard(ctx, facts, mark);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("no blob");

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = cardFileName(facts.memberCode, "png");
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      // The PDF below does the same job, so this is a note and not a dead end.
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-3">
        <Button onClick={downloadPng} disabled={working} icon={<Icon name="camera" />}>
          {working ? CARD_MESSAGES.preparing : CARD_MESSAGES.downloadPng}
        </Button>

        {/*
          A plain link, not a fetch. The browser's own download handling is
          better than anything reimplemented here, and it works with the
          keyboard, the context menu and "save to Files" on a phone.
        */}
        <ButtonLink href="/api/my-card/pdf" variant="secondary" icon={<Icon name="save" />}>
          {CARD_MESSAGES.downloadPdf}
        </ButtonLink>
      </div>

      {failed ? (
        <p role="status" className="mt-3 text-base text-ink-soft">
          {CARD_MESSAGES.pngFailed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The library's mark, ready to draw.
 *
 * Always a same-origin URL — either `/api/media/<id>` for an uploaded logo or
 * the packaged file — so the canvas is never tainted and `toBlob` keeps
 * working. Returns null rather than throwing: a card with an empty tile is a
 * card, and a download that failed because a logo was slow is not.
 */
async function loadMark(src: string): Promise<HTMLImageElement | null> {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/** The body face, as the page is actually serving it. */
function bodyFont(weight: number, px: number): string {
  const family =
    typeof window === "undefined"
      ? "sans-serif"
      : getComputedStyle(document.body).fontFamily || "sans-serif";
  return `${weight} ${px * SCALE}px ${family}`;
}

/** The face the member code is set in, everywhere it appears. */
function serialFont(px: number): string {
  return `700 ${px * SCALE}px ui-monospace, "SF Mono", Menlo, monospace`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Letter-spaced text, drawn a glyph at a time. Returns where it ended. */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  spacing: number,
): number {
  let cursor = x;
  for (const character of text) {
    ctx.fillText(character, cursor, baseline);
    cursor += ctx.measureText(character).width + spacing * SCALE;
  }
  return cursor;
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  const glyphs = [...text];
  return (
    glyphs.reduce((total, character) => total + ctx.measureText(character).width, 0) +
    spacing * SCALE * Math.max(0, glyphs.length - 1)
  );
}

/** Cuts a string to fit the width it has been given. Same rule as the PDF. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) {
    cut = cut.slice(0, -1).trimEnd();
  }
  return `${cut}...`;
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  facts: CardDownloadFacts,
  mark: HTMLImageElement | null,
) {
  const pt = (value: number) => value * SCALE;
  ctx.textBaseline = "alphabetic";

  // ---- The field ----------------------------------------------------------
  const field = ctx.createLinearGradient(0, 0, 0, pt(CARD.fieldHeight));
  field.addColorStop(0, CARD_INK.fieldTop);
  field.addColorStop(1, CARD_INK.fieldBase);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, W, pt(CARD.fieldHeight));

  // The engraving, swept from two points outside the card. The plinth is
  // painted over the bottom of it in a moment, which is the cheapest clip there
  // is — and the same one the PDF uses.
  ctx.strokeStyle = `rgba(255,255,255,${CARD_ALPHA.guilloche})`;
  ctx.lineWidth = pt(0.7);
  for (const family of GUILLOCHE) {
    for (const radius of family.radii) {
      ctx.beginPath();
      ctx.arc(pt(family.cx), pt(family.cy), pt(radius), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---- The plinth, and the rule between ------------------------------------
  ctx.fillStyle = CARD_INK.plinth;
  ctx.fillRect(0, pt(PLINTH_TOP), W, H - pt(PLINTH_TOP));

  for (const strip of foilRamp(96)) {
    ctx.fillStyle = strip.colour;
    ctx.fillRect(pt(strip.x), pt(CARD.fieldHeight), pt(strip.width), pt(CARD.foilHeight));
  }

  // ---- The mark ------------------------------------------------------------
  const tile = CARD_LAYOUT.tile;
  ctx.fillStyle = CARD_INK.white;
  roundedRect(ctx, pt(tile.x), pt(tile.y), pt(tile.size), pt(tile.size), pt(tile.radius));
  ctx.fill();

  if (mark) {
    const box = pt(tile.size - tile.inset * 2);
    // Contain, never stretch: an uploaded logo is any shape at all.
    const scale = Math.min(box / mark.naturalWidth, box / mark.naturalHeight);
    const width = mark.naturalWidth * scale;
    const height = mark.naturalHeight * scale;
    ctx.drawImage(
      mark,
      pt(tile.x) + (pt(tile.size) - width) / 2,
      pt(tile.y) + (pt(tile.size) - height) / 2,
      width,
      height,
    );
  }

  // ---- The header ----------------------------------------------------------
  const label = CARD_LAYOUT.cardLabel;
  ctx.font = bodyFont(700, label.size);
  const labelWidth = trackedWidth(ctx, label.text, label.tracking);
  const nameRoom = pt(CONTENT_RIGHT - CARD_LAYOUT.libraryName.x) - labelWidth - pt(16);

  ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.cardLabel})`;
  tracked(ctx, label.text, W - pt(CARD.pad) - labelWidth, pt(label.baseline), label.tracking);

  ctx.fillStyle = CARD_INK.white;
  ctx.font = bodyFont(700, CARD_LAYOUT.libraryName.size);
  ctx.fillText(
    fit(ctx, facts.libraryName, nameRoom),
    pt(CARD_LAYOUT.libraryName.x),
    pt(CARD_LAYOUT.libraryName.baseline),
  );

  ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.community})`;
  ctx.font = bodyFont(400, CARD_LAYOUT.communityName.size);
  ctx.fillText(
    fit(ctx, facts.communityName, nameRoom),
    pt(CARD_LAYOUT.communityName.x),
    pt(CARD_LAYOUT.communityName.baseline),
  );

  ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.divider})`;
  ctx.fillRect(pt(CARD.pad), pt(CARD_LAYOUT.headRule.y), pt(CONTENT_WIDTH), pt(0.6));

  // ---- The person ----------------------------------------------------------
  const avatar = CARD_LAYOUT.avatar;
  ctx.fillStyle = getAvatar(facts.avatarKey).color;
  ctx.beginPath();
  ctx.arc(pt(avatar.cx), pt(avatar.cy), pt(avatar.r), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = pt(1);
  ctx.stroke();

  const initial = monogram(facts.readerName || "?");
  ctx.fillStyle = CARD_INK.white;
  ctx.font = bodyFont(700, avatar.initialSize);
  ctx.fillText(
    initial,
    pt(avatar.cx) - ctx.measureText(initial).width / 2,
    pt(avatar.cy + avatar.initialSize * 0.35),
  );

  const readerLabel = CARD_LAYOUT.readerLabel;
  ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.readerLabel})`;
  ctx.font = bodyFont(700, readerLabel.size);
  tracked(ctx, readerLabel.text, pt(readerLabel.x), pt(readerLabel.baseline), readerLabel.tracking);

  const readerName = CARD_LAYOUT.readerName;
  ctx.fillStyle = CARD_INK.white;
  ctx.font = bodyFont(700, readerName.size);
  ctx.fillText(
    fit(ctx, facts.readerName, pt(CONTENT_RIGHT - readerName.x)),
    pt(readerName.x),
    pt(readerName.baseline),
  );

  const code = CARD_LAYOUT.memberCode;
  ctx.fillStyle = CARD_INK.sun;
  ctx.font = serialFont(code.size);
  tracked(ctx, facts.memberCode, pt(code.x), pt(code.baseline), code.tracking);

  // ---- Home, joined, and the one benefit line ------------------------------
  const meta = CARD_LAYOUT.meta;
  const details: string[] = [];
  if (facts.apartment) details.push(`Home ${facts.apartment}`);
  if (facts.joinedLabel) details.push(`Reader since ${facts.joinedLabel}`);
  if (details.length > 0) {
    ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.meta})`;
    ctx.font = bodyFont(400, meta.size);
    ctx.fillText(
      fit(ctx, details.join("   ·   "), pt(CONTENT_WIDTH * 0.55)),
      pt(meta.x),
      pt(meta.baseline),
    );
  }

  const pill = CARD_LAYOUT.pill;
  ctx.font = bodyFont(700, pill.size);
  const pillTextWidth = trackedWidth(ctx, CARD_MESSAGES.free, pill.tracking);
  const pillWidth = pillTextWidth + pt(pill.padX) * 2;
  const pillLeft = W - pt(CARD.pad) - pillWidth;

  ctx.strokeStyle = `rgba(255,255,255,${CARD_ALPHA.pillBorder})`;
  ctx.lineWidth = pt(0.7);
  roundedRect(
    ctx,
    pillLeft,
    pt(pill.baseline - pill.height + 4.5),
    pillWidth,
    pt(pill.height),
    pt(pill.height / 2),
  );
  ctx.stroke();

  ctx.fillStyle = CARD_INK.sun;
  tracked(ctx, CARD_MESSAGES.free, pillLeft + pt(pill.padX), pt(pill.baseline), pill.tracking);

  // ---- What the card allows ------------------------------------------------
  if (facts.rules) {
    const stats = CARD_LAYOUT.stats;
    const columns = cardAllowances(facts.rules);
    const columnWidth = pt(CONTENT_WIDTH) / columns.length;

    columns.forEach((item, index) => {
      const x = pt(CARD.pad) + columnWidth * index;

      if (index > 0) {
        ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.statDivider})`;
        ctx.fillRect(
          x - pt(10),
          pt(stats.dividerTop),
          pt(0.6),
          pt(stats.dividerBottom - stats.dividerTop),
        );
      }

      ctx.fillStyle = `rgba(255,255,255,${CARD_ALPHA.statLabel})`;
      ctx.font = bodyFont(700, stats.labelSize);
      tracked(ctx, item.label.toUpperCase(), x, pt(stats.labelBaseline), stats.labelTracking);

      ctx.fillStyle = CARD_INK.white;
      ctx.font = bodyFont(700, stats.valueSize);
      ctx.fillText(fit(ctx, item.value, columnWidth - pt(12)), x, pt(stats.valueBaseline));
    });
  }

  // ---- House rules along the bottom ----------------------------------------
  const plinthLabel = CARD_LAYOUT.plinthLabel;
  ctx.fillStyle = CARD_INK.inkSoft;
  ctx.font = bodyFont(700, plinthLabel.size);
  tracked(ctx, plinthLabel.text, pt(plinthLabel.x), pt(plinthLabel.baseline), plinthLabel.tracking);

  const rules = CARD_LAYOUT.rules;
  shortRules(facts.rules).forEach((rule, index) => {
    const baseline = rules.firstBaseline + rules.step * index;

    ctx.fillStyle = CARD_INK.leaf;
    ctx.beginPath();
    ctx.arc(pt(rules.bulletX), pt(baseline - 2.2), pt(rules.bulletR), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = CARD_INK.ink;
    ctx.font = bodyFont(400, rules.size);
    ctx.fillText(
      fit(ctx, rule, pt(CONTENT_RIGHT - rules.textX)),
      pt(rules.textX),
      pt(baseline),
    );
  });
}
