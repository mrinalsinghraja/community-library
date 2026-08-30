import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHILD_PHOTO_MAX_BYTES } from "@/lib/child-photo";
import { COVER_MAX_BYTES } from "@/lib/cover-image";
import { UPLOAD_PURPOSES, UPLOAD_RULES } from "@/server/lib/uploads";

/**
 * Every upload rule has to fit through the pipe in front of it.
 *
 * There are three ceilings between a phone's camera roll and this library's
 * storage, and only the smallest applies: Vercel refuses a request body over
 * 4.5 MB, Next.js refuses a Server Action body over `bodySizeLimit`, and then
 * the rule in `UPLOAD_RULES` runs on the bytes that arrive.
 *
 * A rule set above the body limit is not a limit — it is a promise the
 * transport cannot keep, and it fails in the one way no message can improve:
 * the framework rejects the body before the action runs, so the family sees the
 * whole-page "something went wrong" instead of a sentence. That is exactly what
 * a 5 MB child-photo rule under a 1 MB default did to a parent registering
 * their child from a phone.
 *
 * These read the number out of `next.config.ts` rather than restating it, so
 * raising a rule past the pipe fails here rather than in production.
 */

const CONFIG = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

/** Vercel rejects a serverless request body larger than this, before our code. */
const PLATFORM_LIMIT = 4.5 * 1024 * 1024;

function configuredBodyLimit(): number {
  const match = CONFIG.match(/bodySizeLimit:\s*"(\d+(?:\.\d+)?)(mb|kb)"/i);
  if (!match) throw new Error("next.config.ts does not set serverActions.bodySizeLimit");
  const size = Number(match[1]);
  return match[2].toLowerCase() === "mb" ? size * 1024 * 1024 : size * 1024;
}

describe("the Server Action body limit", () => {
  it("is set at all, rather than left on the 1 MB default", () => {
    // The default is smaller than any photograph a phone has taken this decade.
    expect(configuredBodyLimit()).toBeGreaterThan(1024 * 1024);
  });

  it("stays under what the platform will carry", () => {
    // Above this the request never reaches the function, so raising the limit
    // would move the failure rather than fix it.
    expect(configuredBodyLimit()).toBeLessThanOrEqual(PLATFORM_LIMIT);
  });
});

describe("every upload rule", () => {
  it.each(Object.entries(UPLOAD_RULES))("%s fits inside the body limit", (_purpose, rules) => {
    // Strictly less than, with room: the picture is not the whole submission --
    // the rest of the form travels in the same body.
    expect(rules.maxBytes).toBeLessThan(configuredBodyLimit());
  });
});

describe("the child photograph rule", () => {
  it("leaves at least a megabyte for the rest of the registration", () => {
    expect(configuredBodyLimit() - CHILD_PHOTO_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
  });

  it("is the number the picker shows a parent", () => {
    const picker = readFileSync(
      join(process.cwd(), "src", "components", "library", "photo-picker.tsx"),
      "utf8",
    );
    // Read from the rule, never typed. A hard-coded "5 MB" next to a 3 MB rule
    // is how a family is invited to send something we then refuse.
    expect(picker).toContain("describeSize(CHILD_PHOTO_MAX_BYTES)");
    expect(picker).not.toMatch(/up to \d/);
  });
});

describe("the book cover rule", () => {
  it("is unchanged by any of this", () => {
    expect(UPLOAD_RULES[UPLOAD_PURPOSES.BOOK_COVER].maxBytes).toBe(COVER_MAX_BYTES);
  });
});

describe("what the picker tells a parent about the size", () => {
  const PICKER = readFileSync(
    join(process.cwd(), "src", "components", "library", "photo-picker.tsx"),
    "utf8",
  );

  it("says the size as soon as a picture is chosen", () => {
    // Both ends of the answer: while the shrinking runs, and once it is done.
    expect(PICKER).toContain('text: "Checking the picture…"');
    expect(PICKER).toContain("`Ready — ${describeSize(prepared.size)}.`");
  });

  it("refuses both ends of the band, not only the big one", () => {
    expect(PICKER).toContain(
      "prepared.size > CHILD_PHOTO_MAX_BYTES || prepared.size < CHILD_PHOTO_MIN_BYTES",
    );
  });

  it("says a size outside the band in red, and announces it", () => {
    // Colour is not a message on its own -- the sentence names the size and
    // both ends of the rule, and role="alert" reads it to anybody who cannot
    // see the colour at all.
    expect(PICKER).toContain('note.problem ? "font-bold text-danger" : "text-ink-soft"');
    expect(PICKER).toContain('role={note.problem ? "alert" : undefined}');
  });

  it("offers the shrinking tool only when shrinking would help", () => {
    // A way to make a picture smaller helps nobody whose picture is too small.
    expect(PICKER).toContain("offerTool: tooBig");
    expect(PICKER).toContain("href={COMPRESS_TOOL_URL}");
    expect(PICKER).toContain('rel="noopener noreferrer"');
  });

  it("tells a parent the tool keeps the picture on their own device", () => {
    /*
     * The one claim here that must not be wrong. This is a page asking a parent
     * to hand over a photograph of their child, and it is now pointing them at
     * another site to prepare it — so the sentence has to be true of that site.
     * It is: the tool has no upload path at all.
     */
    expect(PICKER).toContain("never uploaded anywhere");
  });

  it("shrinks without a floor, so a big photo is never kept at full size", () => {
    /*
     * Handing the shrinker the 100 KB floor would make it return the ORIGINAL
     * whenever its own result came out under -- so a 4 MB photograph of a plain
     * wall would stay 4 MB and then be refused for being too big, which is the
     * opposite of helping.
     */
    const steps = PICKER.match(/minBytes: 0/g) ?? [];
    expect(steps.length).toBe(3);
  });

  it("tries more than once before sending a parent away", () => {
    /*
     * A dense photograph does not fit at the first size tried, and telling that
     * parent to go and use another website for a picture this code could have
     * fitted itself would be a poor way to treat them. The ladder steps down
     * and tries again; the tool is what is left when none of it worked.
     */
    expect(PICKER).toContain("SHRINK_LADDER");
    expect(PICKER).toMatch(/for \(const step of SHRINK_LADDER\)/);
  });

  it("re-encodes the original at each step, never the previous result", () => {
    // Compressing an already-compressed JPEG adds its own damage on top, and
    // the child in the picture is the one who pays for it.
    expect(PICKER).toContain("await downscaleImage(file, step)");
  });

  it("stops as soon as one fits, so an ordinary photo costs one re-encode", () => {
    expect(PICKER).toContain("if (attempt.file.size <= CHILD_PHOTO_MAX_BYTES)");
  });
});
