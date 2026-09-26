import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { READER_DESTINATIONS } from "@/lib/desk-nav";
import { readerGuide, numberSteps, type GuideFacts } from "@/lib/reader-guide";

/**
 * The reader's guide (ADR-075).
 *
 * A guide with a broken picture, a picture that no longer matches its caption's
 * size, or a number typed in by hand is worse than no guide: a parent follows
 * it exactly. These hold the parts that can silently drift.
 */

const ROOT = join(__dirname, "..", "..");
const GUIDE_DIR = join(ROOT, "public", "guide");

const FACTS: GuideFacts = {
  venueName: "the Test Room",
  borrowingPeriodDays: 21,
  maxActiveLoans: 3,
  cardExample: "TST-R0042",
};

const sections = readerGuide(FACTS);
const steps = sections.flatMap((section) => section.steps);
const images = steps.flatMap((step) => (step.image ? [step.image] : []));

describe("the reader's guide", () => {
  it("gives every part a unique id, so the contents links land", () => {
    const ids = sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  it("numbers every step once, in order", () => {
    const numbers = [...numberSteps(sections).values()];
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    expect(numbers).toHaveLength(steps.length);
  });

  it("has a picture file for every picture, at the size the page draws", async () => {
    for (const image of images) {
      const meta = await sharp(join(GUIDE_DIR, `${image.file}.webp`)).metadata();
      expect({ file: image.file, width: meta.width, height: meta.height }).toEqual({
        file: image.file,
        width: image.width,
        height: image.height,
      });
      expect(image.alt.length).toBeGreaterThan(20);
    }
  });

  it("ships no picture the guide does not use", () => {
    const used = new Set(images.map((image) => `${image.file}.webp`));
    const shipped = readdirSync(GUIDE_DIR).filter((name) => !name.startsWith("."));
    expect(shipped.filter((name) => !used.has(name))).toEqual([]);
  });

  it("takes the loan period, the limit, the room and the card format from settings", () => {
    // The words, not the picture descriptions: an alt text describes the
    // practice library's screen, which really does say "14 days left".
    const text = JSON.stringify(
      sections.map(({ steps: sectionSteps, ...section }) => ({
        ...section,
        steps: sectionSteps.map(({ image: _image, ...step }) => step),
      })),
    );
    expect(text).toContain("21 days");
    expect(text).toContain("3 books at a time");
    expect(text).toContain("the Test Room");
    expect(text).toContain("TST-R0042");
    // The live defaults must not be hiding in the copy.
    expect(text).not.toMatch(/\b14 days\b/);
    expect(text).not.toMatch(/\b2 books\b/);
  });

  it("is a public page that asks nobody to sign in", () => {
    const page = readFileSync(join(ROOT, "src", "app", "guide", "page.tsx"), "utf8");
    expect(page).not.toMatch(/getActor|requireActor|requirePermission|redirect\(/);

    const proxy = readFileSync(join(ROOT, "src", "proxy.ts"), "utf8");
    expect(proxy).not.toMatch(/"\/guide"/);
  });

  it("is in the menu for everybody, signed in or not", () => {
    const entry = READER_DESTINATIONS.find((item) => item.href === "/guide");
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("membersOnly");
    expect(entry).not.toHaveProperty("cataloguePublicOnly");
  });
});
