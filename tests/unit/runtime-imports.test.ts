import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Nothing that deploys may reach `sharp` (ADR-072).
 *
 * Importing it from a route, page, server action or anything they import puts a
 * native image library in every function bundle -- measured at +16.5 MB per
 * deployment, on a Hobby team whose Functions Storage is capped at 10 GB -- and
 * has the server decode uploaded pixels, which this application does not do.
 * Thumbnails are made in the librarian's browser instead.
 *
 * The backfill script is the one exception, and it is reached only from
 * `scripts/`, never from `src/app`.
 */

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

const ALLOWED_TO_IMPORT_SHARP = new Set(["src/server/lib/cover-thumbnail-sharp.ts"]);
const ALLOWED_TO_IMPORT_SHARP_MODULE = new Set(["src/server/services/cover-thumbnail-backfill.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * Whether a file imports a module whose path ends in `name` -- an actual
 * `import ... from`, `export ... from` or dynamic `import()`, not a comment that
 * happens to mention the file.
 */
function importsModule(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specifier = `["'][^"']*${escaped}(?:\\.ts)?["']`;
  return new RegExp(`(?:from\\s+${specifier}|import\\(\\s*${specifier}\\s*\\))`).test(text);
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(ROOT, path).split("\\").join("/"),
  text: readFileSync(path, "utf8"),
}));

describe("what the deployed functions may import", () => {
  it("imports sharp nowhere but the backfill's own helper", () => {
    const offenders = files
      .filter((file) => /from\s+["']sharp["']|require\(\s*["']sharp["']\s*\)|import\(\s*["']sharp["']\s*\)/.test(file.text))
      .map((file) => file.path)
      .filter((path) => !ALLOWED_TO_IMPORT_SHARP.has(path));

    expect(offenders).toEqual([]);
  });

  it("reaches that helper only from the backfill", () => {
    const offenders = files
      .filter((file) => importsModule(file.text, "cover-thumbnail-sharp"))
      .map((file) => file.path)
      .filter((path) => !ALLOWED_TO_IMPORT_SHARP.has(path) && !ALLOWED_TO_IMPORT_SHARP_MODULE.has(path));

    expect(offenders).toEqual([]);
  });

  it("reaches the backfill from nothing under src/", () => {
    const offenders = files
      .filter((file) => importsModule(file.text, "cover-thumbnail-backfill"))
      .map((file) => file.path)
      .filter((path) => !ALLOWED_TO_IMPORT_SHARP_MODULE.has(path));

    expect(offenders).toEqual([]);
  });

  it("keeps sharp out of the runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

    expect(manifest.dependencies?.sharp).toBeUndefined();
    expect(manifest.devDependencies?.sharp).toBeDefined();
  });
});
