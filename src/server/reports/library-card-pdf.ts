import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import { getAvatar } from "@/lib/avatars";
import { formatInTimezone } from "@/lib/dates";
import { cardAllowances, shortRules, type LibraryCardFacts } from "@/lib/library-card";
import { monogram } from "@/lib/readers-board";
import { winAnsi } from "@/server/reports/winansi";

/**
 * The card, as a file a family can keep.
 *
 * One page, card-shaped rather than A4: this is meant to be looked at on a
 * phone or printed and cut out, and a credit-card rectangle centred on a sheet
 * of A4 is neither. 320×200 points is close to the 1.6 ratio of a real card,
 * with enough height added for the house rules along the bottom.
 *
 * Helvetica, for the same reason the reports use it — one of the fourteen faces
 * every reader already has, and embedding Fraunces to make one card match the
 * website would put most of a megabyte into every download. The colours are the
 * design system's, sampled from the same tokens the page uses.
 *
 * **No photograph.** The avatar disc is drawn, the child's own picture is not.
 * A PDF is a thing that gets forwarded, and a file carrying a child's face plus
 * their name plus their flat number is a different object from a card in a
 * pocket. The disc and the monogram carry the same recognition at none of the
 * risk — and it is the same drawing the readers' board already uses for a child
 * who has sent no picture.
 */

const WIDTH = 340;
const HEIGHT = 250;
const PAD = 20;

const INK = rgb(0.169, 0.129, 0.094); // --color-ink #2B2118
const INK_SOFT = rgb(0.361, 0.31, 0.259); // --color-ink-soft #5C4F42
const PRIMARY_DEEP = rgb(0.078, 0.341, 0.29); // --color-primary-deep #14574A
const PRIMARY = rgb(0.122, 0.435, 0.361); // --color-primary #1F6F5C
const ACCENT_WASH = rgb(0.984, 0.918, 0.953); // --color-accent-wash #FBEAF3
const SUNK = rgb(0.965, 0.937, 0.89); // --color-surface-sunk #F6EFE3
const HAIRLINE = rgb(0.89, 0.851, 0.788); // --color-hairline #E3D9C9
const LEAF = rgb(0.471, 0.69, 0.188); // --color-leaf #78B030
const ACCENT = rgb(0.659, 0.157, 0.471); // --color-accent #A82878
const WHITE = rgb(1, 1, 1);

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

export async function renderLibraryCardPdf(
  facts: LibraryCardFacts,
  timezone: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  pdf.setTitle(safe(`${facts.libraryName} — reader card`));
  pdf.setCreator(safe(facts.libraryName));
  // No author: the author would be a child.

  const page = pdf.addPage([WIDTH, HEIGHT]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);

  const contentWidth = WIDTH - PAD * 2;

  // ---- Header band --------------------------------------------------------
  const BAND = 44;
  page.drawRectangle({ x: 0, y: HEIGHT - BAND, width: WIDTH, height: BAND, color: PRIMARY_DEEP });

  page.drawText(fit(safe(facts.libraryName), bold, 11, contentWidth - 70), {
    x: PAD,
    y: HEIGHT - 27,
    size: 11,
    font: bold,
    color: WHITE,
  });
  page.drawText(safe(facts.communityName), {
    x: PAD,
    y: HEIGHT - 39,
    size: 7.5,
    font: body,
    color: rgb(1, 1, 1),
    opacity: 0.85,
  });

  const label = "READER CARD";
  page.drawText(label, {
    x: WIDTH - PAD - bold.widthOfTextAtSize(label, 7),
    y: HEIGHT - 27,
    size: 7,
    font: bold,
    color: WHITE,
    opacity: 0.9,
  });

  // The garden rule, in its three colours, closing the band.
  const third = WIDTH / 3;
  page.drawRectangle({ x: 0, y: HEIGHT - BAND - 3, width: third, height: 3, color: LEAF });
  page.drawRectangle({ x: third, y: HEIGHT - BAND - 3, width: third, height: 3, color: PRIMARY });
  page.drawRectangle({ x: third * 2, y: HEIGHT - BAND - 3, width: third, height: 3, color: ACCENT });

  // ---- The person ---------------------------------------------------------
  let y = HEIGHT - BAND - 3 - 22;

  const avatar = getAvatar(facts.avatarKey);
  const discRadius = 17;
  const discX = PAD + discRadius;
  const discY = y - discRadius + 6;

  // The avatar's own colour, parsed from the definition the app already holds.
  const hex = avatar.color.replace("#", "");
  page.drawCircle({
    x: discX,
    y: discY,
    size: discRadius,
    color: rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ),
  });

  // A letter, not the emoji: Helvetica has no emoji and `drawText` would throw.
  const initial = safe(monogram(facts.readerName ?? "?"));
  page.drawText(initial, {
    x: discX - bold.widthOfTextAtSize(initial, 17) / 2,
    y: discY - 6,
    size: 17,
    font: bold,
    color: WHITE,
  });

  const textX = PAD + discRadius * 2 + 12;
  const textWidth = WIDTH - textX - PAD;

  page.drawText("READER", { x: textX, y, size: 6.5, font: bold, color: INK_SOFT });
  page.drawText(fit(safe(facts.readerName ?? ""), bold, 15, textWidth), {
    x: textX,
    y: y - 17,
    size: 15,
    font: bold,
    color: INK,
  });
  page.drawText(fit(safe(facts.memberCode ?? ""), body, 9, textWidth), {
    x: textX,
    y: y - 29,
    size: 9,
    font: body,
    color: PRIMARY_DEEP,
  });

  y -= 46;

  // ---- Home, joined, and what the card allows -----------------------------
  const details: string[] = [];
  if (facts.apartment) details.push(`Home ${safe(facts.apartment)}`);
  if (facts.joinedAt) {
    details.push(`Reader since ${formatInTimezone(facts.joinedAt, timezone, "MMM yyyy")}`);
  }
  if (details.length > 0) {
    page.drawText(fit(details.join("   ·   "), body, 8, contentWidth), {
      x: PAD,
      y,
      size: 8,
      font: body,
      color: INK_SOFT,
    });
    y -= 16;
  }

  if (facts.rules) {
    const columns = cardAllowances(facts.rules);
    const columnWidth = contentWidth / columns.length;
    columns.forEach((item, index) => {
      const x = PAD + columnWidth * index;
      page.drawText(safe(item.label), { x, y, size: 6.5, font: body, color: INK_SOFT });
      page.drawText(safe(item.value), { x, y: y - 12, size: 11, font: bold, color: INK });
    });
    y -= 26;
  }

  // The one line the whole library is about.
  const freeText = "Free. No fees, no catch.";
  page.drawRectangle({ x: PAD, y: y - 15, width: contentWidth, height: 18, color: ACCENT_WASH });
  page.drawText(freeText, { x: PAD + 7, y: y - 9, size: 8.5, font: bold, color: INK });

  // ---- House rules along the bottom ---------------------------------------
  const rules = shortRules(facts.rules);
  // 10 top padding + the heading + the rules + a block for the contact line.
  // The previous budget left the contact line's descenders below the page.
  const footerHeight = 10 + 8 + rules.length * 9.5 + 6;

  page.drawRectangle({ x: 0, y: 0, width: WIDTH, height: footerHeight, color: SUNK });
  page.drawLine({
    start: { x: 0, y: footerHeight },
    end: { x: WIDTH, y: footerHeight },
    thickness: 0.5,
    color: HAIRLINE,
  });

  let ruleY = footerHeight - 12;
  page.drawText("LOOKING AFTER A BOOK", { x: PAD, y: ruleY, size: 6, font: bold, color: INK_SOFT });
  ruleY -= 10;

  for (const rule of rules) {
    page.drawCircle({ x: PAD + 2, y: ruleY + 2.5, size: 1.4, color: LEAF });
    page.drawText(fit(safe(rule), body, 7.5, contentWidth - 10), {
      x: PAD + 8,
      y: ruleY,
      size: 7.5,
      font: body,
      color: INK,
    });
    ruleY -= 9.5;
  }

  return pdf.save();
}
