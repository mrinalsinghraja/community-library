import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DORMANT_CIRCULATION_SETTINGS } from "@/lib/circulation";
import { DORMANT_PERMISSIONS, PERMISSIONS, type PermissionKey } from "@/lib/permissions";

/**
 * Settings and permissions that exist and do nothing.
 *
 * They were laid down in Phase 0 from a blueprint describing a complete library
 * system, and no phase since has given them meaning. That is a defensible state
 * to be in — inventing behaviour for `block_on_overdue_days` would mean
 * inventing a policy about locking a child out over a late book, which is the
 * owner's decision and not the code's.
 *
 * What is not defensible is a knob that looks live. This file holds the line in
 * two directions:
 *
 *   1. Nothing in `src/` reads them, so the "not implemented" label stays true.
 *   2. They are declared as dormant, so any future settings or role screen has
 *      a list to check rather than a surprise to discover.
 *
 * When one of these is implemented, both halves change in the same commit: the
 * code starts reading it, and its name comes off the dormant list. A failure
 * here means exactly one of those two happened.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Every line of application source, minus the file that declares the lists. */
const APPLICATION_SOURCE = sourceFiles(SRC)
  .filter((path) => !path.endsWith(join("lib", "circulation.ts")))
  .filter((path) => !path.endsWith(join("lib", "permissions.ts")))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("dormant settings", () => {
  it.each(DORMANT_CIRCULATION_SETTINGS)("nothing in src/ reads %s", (setting) => {
    const readers = APPLICATION_SOURCE.filter((file) => file.text.includes(setting)).map(
      (file) => file.path,
    );

    expect(readers).toEqual([]);
  });

  it("has no configuration screen that could render one", () => {
    // There is no settings UI in Version 1 at all, which is the simplest
    // possible way of not showing a librarian an inert control. If one is ever
    // built, this test fails and the builder has to decide what to do about the
    // dormant fields — which is the whole point.
    const settingsScreens = sourceFiles(join(SRC, "app")).filter((path) =>
      /\/settings\//.test(path),
    );

    expect(settingsScreens).toEqual([]);
  });
});

describe("dormant permissions", () => {
  it("still exist in the model", () => {
    // Removing them would be a schema change and a seed change for no gain;
    // they are honest placeholders as long as they are labelled.
    for (const key of DORMANT_PERMISSIONS) {
      expect(PERMISSIONS[key]).toBeDefined();
    }
  });

  it("say plainly that they do nothing", () => {
    for (const key of DORMANT_PERMISSIONS) {
      expect(PERMISSIONS[key].description).toMatch(/not yet implemented/i);
    }
  });

  it("guard nothing", () => {
    for (const key of DORMANT_PERMISSIONS) {
      const guards = APPLICATION_SOURCE.filter((file) => file.text.includes(key)).map(
        (file) => file.path,
      );

      expect(guards).toEqual([]);
    }
  });

  it("does not label a working permission as dormant", () => {
    // The reverse mistake: calling something inert when it is enforcing a rule
    // would be just as misleading, in the other direction.
    const live: PermissionKey[] = ["loan.issue", "loan.return", "loan.renew", "loan.correct"];

    for (const key of live) {
      expect(DORMANT_PERMISSIONS).not.toContain(key);
      expect(PERMISSIONS[key].description).not.toMatch(/not yet implemented/i);
    }
  });
});
