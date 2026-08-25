import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The library publishes no policy about what happens when a book goes wrong.
 *
 * There are two ways to get this wrong and the application has now made both.
 *
 * **Threatening** — "YOUR BOOK IS OVERDUE", fines, penalties. Guarded already,
 * in the loan wording, the due countdown and the reminder emails.
 *
 * **Promising** — "there are no fines here, ever", "late? nothing happens".
 * Kindly meant, and the harder mistake to see: it is the library writing itself
 * a rule nobody agreed on, published on the page families are pointed at and
 * printed on a card they keep, covering a book that was lost or wrecked exactly
 * as much as a book that came back a day late.
 *
 * The line the library actually wants is neither. Ask for the book back, ask to
 * be told early, and leave what happens next to a librarian and a family having
 * a conversation.
 *
 * This test reads the reader-facing source and fails on the promise. Comment
 * lines are skipped on purpose — the files above explain the rule, and quoting
 * the wording that was removed is how the next person understands why.
 */

const ROOTS = ["src/app", "src/components", "src/lib"];

/** Phrases that publish a promise rather than ask for something. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /no fines?\b/i, why: "promises the library will never charge one" },
  { pattern: /never a fine/i, why: "promises the library will never charge one" },
  { pattern: /nothing happens/i, why: "promises there is no consequence at all" },
  { pattern: /you (?:will )?(?:won'?t|will not) be charged/i, why: "a promise about charges" },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Prose the reader sees. Comments are the place the rule gets explained, so
 * they are skipped — including `{/* … *\/}` blocks in JSX, whose middle lines
 * are plain prose with no leading marker. Tracking the block is the only way to
 * tell those from the strings beside them.
 */
function readerFacingLines(path: string): { line: string; number: number }[] {
  const kept: { line: string; number: number }[] = [];
  let inBlock = false;

  readFileSync(join(process.cwd(), path), "utf8")
    .split("\n")
    .forEach((line, index) => {
      const trimmed = line.trim();

      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
        return;
      }
      if (trimmed.startsWith("//")) return;
      if (trimmed.startsWith("/*") || trimmed.startsWith("{/*")) {
        // A one-line comment opens and closes on the same line.
        if (!trimmed.includes("*/")) inBlock = true;
        return;
      }

      kept.push({ line, number: index + 1 });
    });

  return kept;
}

describe("no policy about consequences reaches a reader", () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root))).map((path) =>
    path.replace(`${process.cwd()}/`, ""),
  );

  it("scans a plausible number of files", () => {
    // A guard that silently stops finding anything guards nothing.
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(FORBIDDEN)("never promises: $why", ({ pattern }) => {
    const offenders: string[] = [];

    for (const path of files) {
      for (const { line, number } of readerFacingLines(path)) {
        if (pattern.test(line)) offenders.push(`${path}:${number} — ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
