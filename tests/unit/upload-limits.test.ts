import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHILD_PHOTO_MAX_BYTES, MAX_PHOTO_EDGE } from "@/lib/child-photo";
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

  it("names the file and says its size as soon as it is chosen", () => {
    // Before anything is done to it: a parent who picked the wrong file from a
    // camera roll of near-identical thumbnails should find out from the name.
    expect(PICKER).toContain("`${file.name} — ${describeSize(file.size)}. Checking the picture…`");
    expect(PICKER).toContain("`${prepared.name} — ${sizeStory(file, prepared)}. Ready.`");
  });

  it("shows both sizes when the picture was shrunk", () => {
    /*
     * The failure this closes: a parent chose a 6.6 MB photograph and was told
     * "only 90 KB — too small". Both numbers were true and the sentence read as
     * plainly wrong, with no way to tell whether the page had looked at the
     * file they meant.
     */
    expect(PICKER).toContain("function sizeStory(original: File, prepared: File)");
    expect(PICKER).toContain("made smaller on your phone from ${describeSize(original.size)}");
    expect(PICKER).toMatch(/sizeStory\(file, prepared\)[\s\S]{0,120}Too big/);
  });

  it("judges the floor on the file as chosen, before any shrinking", () => {
    /*
     * A byte count stops being a proxy for detail the moment this application
     * picks the encoding. A 2.9 MB photograph of a plain subject re-encoded at
     * 2000px / q0.92 measures 74 KB and is an excellent card picture; clearing
     * a 100 KB floor would take q0.98 and 219 KB for no visible difference.
     *
     * So the floor asks about the picture the parent chose -- which is the
     * thing it was ever really about -- and it asks before a single re-encode,
     * which is also the fastest answer this picker can give.
     */
    expect(PICKER).toContain("if (file.size < CHILD_PHOTO_MIN_BYTES)");
    expect(PICKER.indexOf("if (file.size < CHILD_PHOTO_MIN_BYTES)")).toBeLessThan(
      PICKER.indexOf("await shrinkToBand(file)"),
    );
  });

  it("judges the ceiling on the file that would be sent", () => {
    // The ceiling is about what the library stores and every reader downloads,
    // so it is the one end that belongs on the prepared bytes.
    expect(PICKER).toContain("if (prepared.size > CHILD_PHOTO_MAX_BYTES)");
  });

  it("never refuses a picture for being small after shrinking it", () => {
    // The bug this closes: a 6.6 MB photograph shrunk to 90 KB and the parent
    // was told their picture was too small about a file we had just made.
    expect(PICKER).not.toContain("prepared.size < CHILD_PHOTO_MIN_BYTES");
  });

  it("says a size outside the band in red, and announces it", () => {
    // Colour is not a message on its own -- the sentence names the size and
    // both ends of the rule, and role="alert" reads it to anybody who cannot
    // see the colour at all.
    expect(PICKER).toContain('note.problem ? "font-bold text-danger" : "text-ink-soft"');
    expect(PICKER).toContain('role={note.problem ? "alert" : undefined}');
  });

  it("offers the shrinking tool only when shrinking would help", () => {
    /*
     * A way to make a picture smaller helps nobody whose picture is too small,
     * so the too-small refusal carries no link -- and the too-big one is
     * reached only after every rung of the ladder failed, which is the one
     * case where another tool is the genuine help rather than an excuse.
     */
    expect(PICKER).toContain("href={COMPRESS_TOOL_URL}");
    expect(PICKER).toContain('rel="noopener noreferrer"');

    const tooSmall = PICKER.slice(PICKER.indexOf("if (file.size < CHILD_PHOTO_MIN_BYTES)"));
    expect(tooSmall.slice(0, tooSmall.indexOf("return;"))).not.toContain("offerTool");

    const tooBig = PICKER.slice(PICKER.indexOf("if (prepared.size > CHILD_PHOTO_MAX_BYTES)"));
    expect(tooBig.slice(0, tooBig.indexOf("return;"))).toContain("offerTool: true");
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
    // Every rung, not most of them: one rung that forgot would be the bug back.
    const rungs = (PICKER.match(/maxEdge: /g) ?? []).length;
    expect(rungs).toBeGreaterThanOrEqual(4);
    expect((PICKER.match(/minBytes: 0/g) ?? []).length).toBe(rungs);
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

  it("shrinks from the top down, so it can never undershoot into the floor", () => {
    /*
     * The bug this closes. A ladder that started at 1200px turned a 6.6 MB
     * photograph of a plain subject into 90 KB -- under the floor -- and there
     * was no way back up, so the parent was told their picture was too small
     * about a file this code had just made from a perfectly good one.
     *
     * Ordered biggest result first, the first step that fits under the ceiling
     * is by construction the largest that fits, which is also the one most
     * likely to clear the floor and the one with the least quality removed.
     */
    const edges = [...PICKER.matchAll(/maxEdge: (MAX_PHOTO_EDGE|\d+)/g)].map((m) =>
      m[1] === "MAX_PHOTO_EDGE" ? MAX_PHOTO_EDGE : Number(m[1]),
    );
    expect(edges.length).toBeGreaterThanOrEqual(4);
    expect(edges).toEqual([...edges].sort((a, b) => b - a));
    expect(edges[0]).toBe(MAX_PHOTO_EDGE);
  });

  it("leaves a picture already under the ceiling completely alone", () => {
    // Re-encoding it could only make it smaller, and smaller is the direction
    // the floor lives in: nothing to gain, a rejection to lose.
    expect(PICKER).toContain("if (file.size <= CHILD_PHOTO_MAX_BYTES) return { file, changed: false }");
  });

  it("re-encodes the original at each step, never the previous result", () => {
    // Compressing an already-compressed JPEG adds its own damage on top, and
    // the child in the picture is the one who pays for it.
    expect(PICKER).toContain("await downscaleImage(file, step)");
  });

  it("stops as soon as one fits, so an ordinary photo costs one re-encode", () => {
    expect(PICKER).toContain("if (attempt.file.size <= CHILD_PHOTO_MAX_BYTES) return attempt;");
  });
});
