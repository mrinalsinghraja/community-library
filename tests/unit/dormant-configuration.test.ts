import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTIVE_CIRCULATION_SETTINGS, DORMANT_CIRCULATION_SETTINGS } from "@/lib/circulation";
import { DORMANT_PERMISSIONS, PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { EDITABLE_SETTING_FIELDS, UNAVAILABLE_FEATURES } from "@/lib/settings-schema";

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
  // Phase 5's declaration file. Like the two above it, it names these things in
  // order to say they do nothing; the tests below prove that claim from the
  // other side, by requiring every dormant name to appear in its list.
  .filter((path) => !path.endsWith(join("lib", "settings-schema.ts")))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("dormant settings", () => {
  it.each(DORMANT_CIRCULATION_SETTINGS)("nothing in src/ reads %s", (setting) => {
    const readers = APPLICATION_SOURCE.filter((file) => file.text.includes(setting)).map(
      (file) => file.path,
    );

    expect(readers).toEqual([]);
  });

  it("is disjoint from the settings that are live", () => {
    // A name on both lists would mean the file contradicts itself, and one of
    // the two statements would be a lie to whoever reads it next.
    for (const setting of DORMANT_CIRCULATION_SETTINGS) {
      expect(ACTIVE_CIRCULATION_SETTINGS as readonly string[]).not.toContain(setting);
    }
  });

  it("does not leave an implemented setting on the dormant list", () => {
    /*
     * The reverse direction, and the one Phase 4 had to get right.
     * `overdueReminderOffsets` was dormant through Phase 3 and now decides when
     * reminders go out; leaving it labelled inert would have told a librarian
     * that editing it does nothing, which would be false the moment they tried.
     */
    for (const setting of ACTIVE_CIRCULATION_SETTINGS) {
      const readers = APPLICATION_SOURCE.filter((file) => file.text.includes(setting));
      expect(
        readers.length,
        `${setting} is declared active but nothing in src/ outside the domain modules reads it`,
      ).toBeGreaterThan(0);
    }
  });

  it("cannot be written by the settings screen", () => {
    /*
     * Phase 5 built the configuration screen this file used to assert did not
     * exist. The guarantee is now made by construction rather than by absence:
     * `updateLibrarySettings` assembles its update from EDITABLE_SETTING_FIELDS
     * one key at a time and never spreads the parsed form, so a column that is
     * not on that list has no path into the database through this screen.
     */
    for (const setting of DORMANT_CIRCULATION_SETTINGS) {
      expect(EDITABLE_SETTING_FIELDS as readonly string[]).not.toContain(setting);
    }
  });

  it("is named on the screen as something the library cannot do", () => {
    // The other half of the promise: a librarian who wonders whether the
    // library can do one of these reads a plain "not available yet" instead of
    // finding a column in the database later and assuming it works.
    const backing = UNAVAILABLE_FEATURES.map((feature) => feature.backedBy).join(" ");

    // The screen names columns in SQL, which is what an operator sees in a dump.
    const asColumn: Record<string, string> = {
      blockOnOverdueDays: "block_on_overdue_days",
      renewalBlockedWhenReserved: "renewal_blocked_when_reserved",
      emailEnabled: "email_enabled",
    };

    for (const setting of DORMANT_CIRCULATION_SETTINGS) {
      expect(backing).toContain(asColumn[setting] ?? setting);
    }
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

  it("is named on the settings screen as unavailable", () => {
    const backing = UNAVAILABLE_FEATURES.map((feature) => feature.backedBy).join(" ");

    for (const key of DORMANT_PERMISSIONS) {
      expect(backing).toContain(key);
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
