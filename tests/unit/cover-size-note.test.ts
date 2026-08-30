import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The note under a chosen cover picture.
 *
 * How the shrinking works, and which of the two size questions is asked where,
 * is pinned in `tests/unit/upload-limits.test.ts` for both forms at once — the
 * cover field and the registration form's photo picker share that code. What is
 * left here is the cover's own: it is the one of the two that is also editing
 * an existing book, so its note has to survive a refused save.
 *
 * The form is a client component and this repository has no DOM test
 * environment, so these read the source the same way
 * `tests/unit/book-intake-consent.test.ts` does.
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

  it("does not call an ordinary ready message a problem", () => {
    expect(FORM).toMatch(/Ready\.`,\s*\n\s*problem:\s*false/);
  });

  it("names the file once, not twice", () => {
    // The note carries the filename now, so the "Chosen:" line above it would
    // be the same word twice in two lines.
    expect(FORM).not.toContain("Chosen: {chosen}");
    expect(FORM).toContain("{note?.text ?? chosen}");
  });

  it("keeps the chosen picture attached across a refused save", () => {
    /*
     * React empties every uncontrolled field once the form's action returns,
     * this component's own state included -- so without re-attaching, the
     * thumbnail would sit on screen over an empty input and the second save
     * would store no cover while looking exactly like the first.
     */
    expect(FORM).toContain("const chosenFile = useRef<File | null>(null)");
    expect(FORM).toContain("input.files = transfer.files");
  });
});
