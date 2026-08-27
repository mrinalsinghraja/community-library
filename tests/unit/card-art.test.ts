import { describe, expect, it } from "vitest";

import {
  CARD,
  CARD_INK,
  CARD_LAYOUT,
  CONTENT_RIGHT,
  GUILLOCHE,
  PLINTH_TOP,
  fieldRamp,
  flip,
  foilRamp,
  hexToRgb,
  mixHex,
} from "@/lib/card-art";
import { packagedMarkPng } from "@/server/reports/packaged-mark";

/**
 * The card's geometry.
 *
 * Two renderers draw from these numbers and neither can be looked at in a test,
 * so what is checked here is the class of mistake that produces a card with a
 * word missing off the edge of it: something laid out past the trim, or a line
 * of the plinth drawn up on the dark field.
 */

const FIELD_TEXT = [
  CARD_LAYOUT.libraryName.baseline,
  CARD_LAYOUT.communityName.baseline,
  CARD_LAYOUT.cardLabel.baseline,
  CARD_LAYOUT.readerLabel.baseline,
  CARD_LAYOUT.readerName.baseline,
  CARD_LAYOUT.memberCode.baseline,
  CARD_LAYOUT.meta.baseline,
  CARD_LAYOUT.stats.labelBaseline,
  CARD_LAYOUT.stats.valueBaseline,
];

describe("the card's grid", () => {
  it("keeps every line of the field on the field", () => {
    for (const baseline of FIELD_TEXT) {
      expect(baseline).toBeGreaterThan(0);
      // Room for a descender before the foil rule: "14 days" has a y in it.
      expect(baseline).toBeLessThanOrEqual(CARD.fieldHeight - 4);
    }
  });

  it("keeps every line of the plinth on the plinth", () => {
    const last = CARD_LAYOUT.rules.firstBaseline + CARD_LAYOUT.rules.step * 3;

    expect(CARD_LAYOUT.plinthLabel.baseline).toBeGreaterThan(PLINTH_TOP);
    expect(last).toBeLessThanOrEqual(CARD.height - 4);
  });

  it("starts every column inside the margins", () => {
    const lefts = [
      CARD_LAYOUT.tile.x,
      CARD_LAYOUT.libraryName.x,
      CARD_LAYOUT.readerName.x,
      CARD_LAYOUT.meta.x,
      CARD_LAYOUT.rules.textX,
      CARD_LAYOUT.plinthLabel.x,
    ];
    for (const x of lefts) {
      expect(x).toBeGreaterThanOrEqual(CARD.pad);
      expect(x).toBeLessThan(CONTENT_RIGHT);
    }
  });

  it("leaves the avatar clear of the text beside it", () => {
    const avatar = CARD_LAYOUT.avatar;
    expect(avatar.cx + avatar.r).toBeLessThan(CARD_LAYOUT.readerName.x);
    expect(avatar.cy - avatar.r).toBeGreaterThan(CARD_LAYOUT.headRule.y);
  });

  it("is a card-shaped rectangle rather than a page", () => {
    // 1.586 is the proportion of the thing in everybody's wallet.
    expect(CARD.width / CARD.height).toBeCloseTo(1.58, 1);
  });

  it("flips into PDF space and back", () => {
    expect(flip(0)).toBe(CARD.height);
    expect(flip(flip(42))).toBe(42);
  });
});

describe("the field's colour", () => {
  it("ramps from the top colour to the base one", () => {
    const ramp = fieldRamp(64);
    expect(ramp).toHaveLength(64);
    expect(ramp[0].colour.toUpperCase()).toBe(CARD_INK.fieldTop);
    expect(ramp.at(-1)?.colour.toUpperCase()).toBe(CARD_INK.fieldBase);
    // Overlapping strips, or a reader zooming in sees hairlines between them.
    expect(ramp[0].y + ramp[0].height).toBeGreaterThan(ramp[1].y);
  });

  it("runs the foil rule through all three house colours", () => {
    const ramp = foilRamp(96);
    expect(ramp[0].colour.toUpperCase()).toBe(CARD_INK.leaf);
    // The midpoint lands between two strips, so it is the house green to
    // within a shade rather than exactly it.
    const middle = hexToRgb(ramp[Math.floor(ramp.length / 2)].colour);
    const primary = hexToRgb(CARD_INK.primary);
    expect(Math.abs(middle.r - primary.r)).toBeLessThan(4);
    expect(Math.abs(middle.g - primary.g)).toBeLessThan(4);
    expect(Math.abs(middle.b - primary.b)).toBeLessThan(4);
    expect(ramp.at(-1)?.colour.toUpperCase()).toBe(CARD_INK.accent);
  });

  it("blends without drifting past either end", () => {
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#FFFFFF", 5)).toBe("#ffffff");
  });

  it("sweeps the engraving off the card, so no ring closes into a target", () => {
    // Every family's smallest ring already leaves the trim on some side. A ring
    // that closed inside the field would read as a bullseye rather than as the
    // engraving on a certificate.
    for (const family of GUILLOCHE) {
      const smallest = Math.min(...family.radii);
      const leaves =
        family.cx - smallest < 0 ||
        family.cx + smallest > CARD.width ||
        family.cy - smallest < 0 ||
        family.cy + smallest > CARD.fieldHeight;
      expect(leaves).toBe(true);
    }
  });
});

describe("the packaged mark", () => {
  it("travels with the code as a real PNG", () => {
    // A server cannot reach for a file the static handler serves, so these
    // bytes are the fallback every PDF is drawn with.
    expect([...packagedMarkPng.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(packagedMarkPng.byteLength).toBeGreaterThan(1000);
  });
});
