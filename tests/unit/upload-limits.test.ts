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

describe("shrinking a picture into the band", () => {
  const SHRINK = readFileSync(join(process.cwd(), "src", "lib", "shrink-to-band.ts"), "utf8");
  const DOWNSCALE = readFileSync(join(process.cwd(), "src", "lib", "image-downscale.ts"), "utf8");

  it("is one piece of code, used by both forms", () => {
    // A parent's card picture and a librarian's book jacket met the same traps.
    // It would be a waste for only one of them to remember the lessons.
    for (const file of [
      ["src", "components", "library", "photo-picker.tsx"],
      ["src", "app", "admin", "books", "book-form.tsx"],
    ]) {
      expect(readFileSync(join(process.cwd(), ...file), "utf8")).toContain(
        'from "@/lib/shrink-to-band"',
      );
    }
  });

  it("shrinks from the top down, so it can never undershoot", () => {
    /*
     * The bug this closes. A ladder that started at its smallest size turned a
     * 6.6 MB photograph of a plain subject into 90 KB -- under the floor -- and
     * had no way back up, so somebody was told their picture was too small
     * about a file this code had just made from a perfectly good one.
     *
     * Ordered biggest result first, the first rung that fits under the ceiling
     * is by construction the largest that fits, which is also the one with the
     * least quality removed.
     */
    const qualities = [...SHRINK.matchAll(/quality: ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(qualities.length).toBeGreaterThanOrEqual(4);
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a));

    const factors = [...SHRINK.matchAll(/topEdge \* ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(factors).toEqual([...factors].sort((a, b) => b - a));
    expect(Math.max(...factors)).toBeLessThan(1);
  });

  it("leaves a picture already under the ceiling completely alone", () => {
    // Re-encoding it could only make it smaller, and smaller is the direction
    // the floor lives in: nothing to gain, a needlessly softened picture to
    // lose.
    expect(SHRINK).toContain("if (file.size <= maxBytes) return { file, changed: false };");
  });

  it("re-encodes the original at each step, never the previous result", () => {
    // Compressing an already-compressed JPEG stacks its damage.
    expect(SHRINK).toContain("await downscaleImage(file, step)");
  });

  it("stops as soon as one fits, so an ordinary picture costs one re-encode", () => {
    expect(SHRINK).toContain("if (attempt.file.size <= maxBytes) return attempt;");
  });

  it("shows both sizes when the picture was shrunk", () => {
    /*
     * The failure this closes: somebody chose a 6.6 MB photograph and was told
     * "only 90 KB -- too small". Both numbers were true and the sentence read
     * as plainly wrong, with no way to tell whether the page had looked at the
     * file they meant.
     */
    expect(SHRINK).toContain("export function sizeStory(original: File, prepared: File)");
    expect(SHRINK).toContain("made smaller on your device from ${describeSize(original.size)}");
  });

  it("has no floor of its own left in the shrinker", () => {
    /*
     * `downscaleImage` used to hand back the ORIGINAL whenever its result came
     * out under a floor, so it never produced a file the server would refuse as
     * too small. That turned a picture that was too small into one that was too
     * big. A floor asked of a file this code re-encoded cannot be answered
     * honestly, so there is none here at all.
     */
    expect(DOWNSCALE).not.toContain("minBytes");
  });
});

describe("what each form tells the person choosing", () => {
  const FORMS = {
    photo: {
      source: readFileSync(
        join(process.cwd(), "src", "components", "library", "photo-picker.tsx"),
        "utf8",
      ),
      floor: "CHILD_PHOTO_MIN_BYTES",
      ceiling: "CHILD_PHOTO_MAX_BYTES",
    },
    cover: {
      source: readFileSync(
        join(process.cwd(), "src", "app", "admin", "books", "book-form.tsx"),
        "utf8",
      ),
      floor: "COVER_MIN_BYTES",
      ceiling: "COVER_MAX_BYTES",
    },
  };

  it.each(Object.entries(FORMS))(
    "%s: names the file and says its size before anything is done to it",
    (_which, form) => {
      expect(form.source).toContain("${file.name} — ${describeSize(file.size)}");
    },
  );

  it.each(Object.entries(FORMS))("%s: judges the floor on the file as chosen", (_which, form) => {
    /*
     * A byte count stops being a proxy for detail the moment this application
     * picks the encoding. A 2.9 MB photograph of a plain subject re-encodes to
     * 74 KB and is a fine picture; clearing a 100 KB floor would take quality
     * 0.98 and 219 KB for no visible difference. So the floor asks about the
     * picture that was chosen, and asks before a single re-encode.
     */
    expect(form.source).toContain(`if (file.size < ${form.floor})`);
    expect(form.source.indexOf(`if (file.size < ${form.floor})`)).toBeLessThan(
      form.source.indexOf("await shrinkToBand(file"),
    );
  });

  it.each(Object.entries(FORMS))(
    "%s: judges the ceiling on the file that would be sent",
    (_which, form) => {
      expect(form.source).toContain(`if (prepared.size > ${form.ceiling})`);
    },
  );

  it.each(Object.entries(FORMS))(
    "%s: never refuses a picture for being small after shrinking it",
    (_which, form) => {
      expect(form.source).not.toContain(`prepared.size < ${form.floor}`);
    },
  );

  it.each(Object.entries(FORMS))("%s: says a refusal in red, and announces it", (_which, form) => {
    // Colour is not a message on its own -- the sentence names the size and the
    // rule, and role="alert" reads it to anybody who cannot see the colour.
    expect(form.source).toMatch(/note\??\.problem \? "alert"/);
    expect(form.source).toMatch(/note\??\.problem\s*\?\s*"(text-base )?font-bold text-danger"/);
  });

  it.each(Object.entries(FORMS))(
    "%s: offers the shrinking tool only when shrinking would help",
    (_which, form) => {
      // A way to make a picture smaller helps nobody whose picture is too small.
      expect(form.source).toContain("href={COMPRESS_TOOL_URL}");
      expect(form.source).toContain('rel="noopener noreferrer"');

      const tooSmall = form.source.slice(form.source.indexOf(`if (file.size < ${form.floor})`));
      expect(tooSmall.slice(0, tooSmall.indexOf("return;"))).not.toContain("offerTool");

      const tooBig = form.source.slice(form.source.indexOf(`if (prepared.size > ${form.ceiling})`));
      expect(tooBig.slice(0, tooBig.indexOf("return;"))).toContain("offerTool: true");
    },
  );

  it("tells a parent the tool keeps the picture on their own device", () => {
    /*
     * The one claim here that must not be wrong. This is a page asking a parent
     * to hand over a photograph of their child, and it is pointing them at
     * another site to prepare it -- so the sentence has to be true of that
     * site. It is: the tool has no upload path at all.
     */
    expect(FORMS.photo.source).toContain("never uploaded anywhere");
  });
});
