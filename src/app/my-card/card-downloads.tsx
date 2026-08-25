"use client";

import { useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getAvatar } from "@/lib/avatars";
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
 * card, which is a real cost — so every word and number it draws comes from
 * `@/lib/library-card`, the same module the page and the PDF read. The layouts
 * differ; the content cannot.
 *
 * ## No photograph
 *
 * The card on screen shows the child's own picture. Neither download does, and
 * that is deliberate: a file is a thing that gets forwarded, and a picture
 * carrying a child's face, their name and their flat number together is a
 * different object from a card in a pocket. The avatar disc and monogram carry
 * the same recognition — the same drawing the readers' board uses — at none of
 * the risk.
 */

/** Drawn at three times the card's point size, so it is crisp on a phone. */
const SCALE = 3;
const W = 340 * SCALE;
const H = 250 * SCALE;
const PAD = 20 * SCALE;

const INK = "#2B2118";
const INK_SOFT = "#5C4F42";
const PRIMARY_DEEP = "#14574A";
const PRIMARY = "#1F6F5C";
const ACCENT_WASH = "#FBEAF3";
const SUNK = "#F6EFE3";
const HAIRLINE = "#E3D9C9";
const LEAF = "#78B030";
const ACCENT = "#A82878";

export interface CardDownloadFacts {
  readerName: string;
  memberCode: string;
  apartment: string | null;
  joinedLabel: string | null;
  avatarKey: string | null;
  libraryName: string;
  communityName: string;
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

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");

      drawCard(ctx, facts);

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

/** The body face, as the page is actually serving it. */
function bodyFont(weight: number, px: number): string {
  const family =
    typeof window === "undefined"
      ? "sans-serif"
      : getComputedStyle(document.body).fontFamily || "sans-serif";
  return `${weight} ${px}px ${family}`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCard(ctx: CanvasRenderingContext2D, facts: CardDownloadFacts) {
  const contentWidth = W - PAD * 2;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  // ---- Header band --------------------------------------------------------
  const band = 44 * SCALE;
  ctx.fillStyle = PRIMARY_DEEP;
  ctx.fillRect(0, 0, W, band);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = bodyFont(700, 11 * SCALE);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(facts.libraryName, PAD, 20 * SCALE, contentWidth - 70 * SCALE);

  ctx.globalAlpha = 0.85;
  ctx.font = bodyFont(400, 7.5 * SCALE);
  ctx.fillText(facts.communityName, PAD, 32 * SCALE);

  ctx.font = bodyFont(700, 7 * SCALE);
  const label = "READER CARD";
  ctx.fillText(label, W - PAD - ctx.measureText(label).width, 20 * SCALE);
  ctx.globalAlpha = 1;

  // The garden rule, closing the band.
  const third = W / 3;
  [LEAF, PRIMARY, ACCENT].forEach((colour, index) => {
    ctx.fillStyle = colour;
    ctx.fillRect(third * index, band, third, 3 * SCALE);
  });

  // ---- The person ---------------------------------------------------------
  let y = band + 3 * SCALE + 24 * SCALE;

  const avatar = getAvatar(facts.avatarKey);
  const radius = 17 * SCALE;
  const discX = PAD + radius;
  const discY = y + 2 * SCALE;

  ctx.fillStyle = avatar.color;
  ctx.beginPath();
  ctx.arc(discX, discY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = bodyFont(700, 17 * SCALE);
  const initial = monogram(facts.readerName);
  ctx.fillText(initial, discX - ctx.measureText(initial).width / 2, discY + 6 * SCALE);

  const textX = PAD + radius * 2 + 12 * SCALE;
  const textWidth = W - textX - PAD;

  ctx.fillStyle = INK_SOFT;
  ctx.font = bodyFont(700, 6.5 * SCALE);
  ctx.fillText("READER", textX, y - 8 * SCALE);

  ctx.fillStyle = INK;
  ctx.font = bodyFont(700, 15 * SCALE);
  ctx.fillText(facts.readerName, textX, y + 6 * SCALE, textWidth);

  ctx.fillStyle = PRIMARY_DEEP;
  ctx.font = bodyFont(400, 9 * SCALE);
  ctx.fillText(facts.memberCode, textX, y + 19 * SCALE, textWidth);

  y += 42 * SCALE;

  // ---- Home, joined -------------------------------------------------------
  const details: string[] = [];
  if (facts.apartment) details.push(`Home ${facts.apartment}`);
  if (facts.joinedLabel) details.push(`Reader since ${facts.joinedLabel}`);
  if (details.length > 0) {
    ctx.fillStyle = INK_SOFT;
    ctx.font = bodyFont(400, 8 * SCALE);
    ctx.fillText(details.join("   ·   "), PAD, y, contentWidth);
    y += 16 * SCALE;
  }

  // ---- What the card allows ----------------------------------------------
  if (facts.rules) {
    const columns = cardAllowances(facts.rules);
    const columnWidth = contentWidth / columns.length;
    columns.forEach((item, index) => {
      const x = PAD + columnWidth * index;
      ctx.fillStyle = INK_SOFT;
      ctx.font = bodyFont(400, 6.5 * SCALE);
      ctx.fillText(item.label, x, y);
      ctx.fillStyle = INK;
      ctx.font = bodyFont(700, 11 * SCALE);
      ctx.fillText(item.value, x, y + 12 * SCALE);
    });
    y += 26 * SCALE;
  }

  // ---- The line the library is about --------------------------------------
  ctx.fillStyle = ACCENT_WASH;
  roundedRect(ctx, PAD, y - 3 * SCALE, contentWidth, 18 * SCALE, 4 * SCALE);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = bodyFont(700, 8.5 * SCALE);
  ctx.fillText("Free. No fees, no catch.", PAD + 7 * SCALE, y + 9 * SCALE);

  // ---- House rules along the bottom ---------------------------------------
  const rules = shortRules(facts.rules);
  const footer = (10 + 8) * SCALE + rules.length * 9.5 * SCALE + 6 * SCALE;

  ctx.fillStyle = SUNK;
  ctx.fillRect(0, H - footer, W, footer);
  ctx.fillStyle = HAIRLINE;
  ctx.fillRect(0, H - footer, W, 0.5 * SCALE);

  let ruleY = H - footer + 12 * SCALE;
  ctx.fillStyle = INK_SOFT;
  ctx.font = bodyFont(700, 6 * SCALE);
  ctx.fillText("LOOKING AFTER A BOOK", PAD, ruleY);
  ruleY += 10 * SCALE;

  for (const rule of rules) {
    ctx.fillStyle = LEAF;
    ctx.beginPath();
    ctx.arc(PAD + 2 * SCALE, ruleY - 2.5 * SCALE, 1.4 * SCALE, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = INK;
    ctx.font = bodyFont(400, 7.5 * SCALE);
    ctx.fillText(rule, PAD + 8 * SCALE, ruleY, contentWidth - 10 * SCALE);
    ruleY += 9.5 * SCALE;
  }
}
