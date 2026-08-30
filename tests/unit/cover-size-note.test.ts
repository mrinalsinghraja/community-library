import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The note under a chosen cover picture, and which of its wordings is a refusal.
 *
 * Three of the four things this note says are progress -- getting ready, ready,
 * resized. One is a dead end: the file cannot be used, and the librarian has to
 * go back to the picker. That one is said in red.
 *
 * The form is a client component and this repository has no DOM test
 * environment, so these read the source the same way
 * `tests/unit/book-intake-consent.test.ts` does. The failure they guard against
 * is quiet: a later edit that returns the note to a plain string would lose the
 * distinction without breaking anything visible in a build.
 */

const FORM = readFileSync(
  join(process.cwd(), "src", "app", "admin", "books", "book-form.tsx"),
  "utf8",
);

describe("the cover picture note", () => {
  it("carries whether it is a refusal, not only words", () => {
    expect(FORM).toContain("interface CoverNote");
    expect(FORM).toMatch(/problem:\s*boolean/);
  });

  it("marks both size refusals as problems", () => {
    // A picture under the floor and a picture over the ceiling are the same
    // kind of answer -- neither can be saved -- so neither may be styled as
    // progress.
    const refusals = FORM.match(/problem:\s*true/g) ?? [];
    expect(refusals).toHaveLength(2);

    expect(FORM).toMatch(/usually too small to[\s\S]*?problem:\s*true/);
    expect(FORM).toMatch(/Please choose one under[\s\S]*?problem:\s*true/);
  });

  it("does not call an ordinary ready message a problem", () => {
    expect(FORM).toMatch(/Ready\.",\s*\n\s*problem:\s*false/);
  });

  it("says a refusal in red", () => {
    expect(FORM).toContain('note.problem ? "font-bold text-danger" : undefined');
  });

  it("announces a refusal as well as colouring it", () => {
    /*
     * Colour alone is not a message. Somebody reading this page with a screen
     * reader, or with any of the several kinds of colour blindness, gets
     * nothing from `text-danger` -- so the same condition also sets
     * `role="alert"`, and the sentence names the size and the rule in words.
     */
    expect(FORM).toContain('role={note.problem ? "alert" : undefined}');
  });
});
