import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Links do not prefetch unless they ask to (ADR-073).
 *
 * Every page here is dynamic, so a prefetch is a server render the visitor did
 * not ask for. Measured on production: one page view fired 15 of them. The
 * application's own `Link` turns it off by default; importing `next/link`
 * directly would quietly turn it back on for that file.
 */

const ROOT = join(__dirname, "..", "..");
const WRAPPER = "src/components/ui/app-link.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("links", () => {
  it("are imported from the application's own Link, never from next/link", () => {
    const offenders = sourceFiles(join(ROOT, "src"))
      .map((path) => ({ path: relative(ROOT, path).split("\\").join("/"), text: readFileSync(path, "utf8") }))
      .filter(({ path, text }) => path !== WRAPPER && /from\s+["']next\/link["']/.test(text))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("do not prefetch unless a link passes prefetch itself", () => {
    const wrapper = readFileSync(join(ROOT, WRAPPER), "utf8");

    expect(wrapper).toMatch(/prefetch\s*=\s*false/);
    expect(wrapper).toMatch(/<NextLink prefetch=\{prefetch\}/);
  });
});
