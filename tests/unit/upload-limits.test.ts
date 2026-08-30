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
