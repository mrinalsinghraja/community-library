import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  archivedDisplayName,
  daysBefore,
  describeRetention,
  monthsBefore,
  redactedEmail,
  RETENTION_BOUNDS,
  retentionIsSet,
  UNSET_RETENTION,
  type RetentionPolicy,
} from "@/lib/retention";
import { retentionPolicySchema } from "@/lib/settings-schema";

/**
 * Retention is the only destructive scheduled job in the application, so these
 * tests are weighted towards the ways it could erase something it should not:
 * an empty field read as zero, a period below the floor, an already-redacted
 * row redacted again, an audit row that keeps the name it was supposed to
 * remove.
 */

const DECIDED: RetentionPolicy = {
  archiveClosedAfterMonths: 24,
  removePhotoAfterClosedDays: 30,
  removeGuardianAfterMonths: 36,
};

describe("an undecided policy does nothing", () => {
  it("starts with every period unset", () => {
    expect(UNSET_RETENTION).toEqual({
      archiveClosedAfterMonths: null,
      removePhotoAfterClosedDays: null,
      removeGuardianAfterMonths: null,
    });
    expect(retentionIsSet(UNSET_RETENTION)).toBe(false);
  });

  it("counts as set the moment any one period is decided", () => {
    expect(retentionIsSet({ ...UNSET_RETENTION, removePhotoAfterClosedDays: 30 })).toBe(true);
    expect(retentionIsSet({ ...UNSET_RETENTION, archiveClosedAfterMonths: 24 })).toBe(true);
    expect(retentionIsSet({ ...UNSET_RETENTION, removeGuardianAfterMonths: 24 })).toBe(true);
  });

  it("says so on the privacy notice instead of inventing a schedule", () => {
    const text = describeRetention(UNSET_RETENTION).join(" ");
    expect(text).toMatch(/has not yet set/i);
    expect(text).toMatch(/nothing is removed automatically/i);
    // The one thing it must not do is name a period nobody chose.
    expect(text).not.toMatch(/\d/);
  });

  it("the nightly pass returns early rather than scanning", () => {
    const source = readFileSync(
      join(process.cwd(), "src/server/lib/retention.ts"),
      "utf8",
    );
    expect(source).toContain("if (!retentionIsSet(policy)) continue;");
  });
});

describe("an empty field means keep, never zero", () => {
  it("turns an emptied box into null", () => {
    const parsed = retentionPolicySchema.parse({
      archiveClosedAfterMonths: "",
      removePhotoAfterClosedDays: "",
      removeGuardianAfterMonths: "",
    });
    expect(parsed).toEqual(UNSET_RETENTION);
  });

  it("refuses zero outright", () => {
    for (const field of [
      "archiveClosedAfterMonths",
      "removePhotoAfterClosedDays",
      "removeGuardianAfterMonths",
    ] as const) {
      const result = retentionPolicySchema.safeParse({ ...UNSET_RETENTION, [field]: "0" });
      expect(result.success, `${field} accepted 0`).toBe(false);
    }
  });

  it("refuses anything below the floor, so a mistyped account cannot be erased before somebody notices", () => {
    const below = RETENTION_BOUNDS.archiveClosedAfterMonths.min - 1;
    const result = retentionPolicySchema.safeParse({
      ...UNSET_RETENTION,
      archiveClosedAfterMonths: String(below),
    });
    expect(result.success).toBe(false);
  });

  it("accepts the floor itself", () => {
    const result = retentionPolicySchema.safeParse({
      archiveClosedAfterMonths: String(RETENTION_BOUNDS.archiveClosedAfterMonths.min),
      removePhotoAfterClosedDays: String(RETENTION_BOUNDS.removePhotoAfterClosedDays.min),
      removeGuardianAfterMonths: String(RETENTION_BOUNDS.removeGuardianAfterMonths.min),
    });
    expect(result.success).toBe(true);
  });

  it("refuses a period above the ceiling", () => {
    const result = retentionPolicySchema.safeParse({
      ...UNSET_RETENTION,
      removePhotoAfterClosedDays: String(RETENTION_BOUNDS.removePhotoAfterClosedDays.max + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe("the clocks", () => {
  it("counts months backwards", () => {
    const cutoff = monthsBefore(new Date("2026-08-26T00:00:00Z"), 24);
    expect(cutoff.toISOString().slice(0, 10)).toBe("2024-08-26");
  });

  it("errs towards keeping the record when the month is short", () => {
    // 31 March minus one month has no 31 February to land on. Rolling forward
    // into March keeps the row a few days longer, which is the safe direction.
    const cutoff = monthsBefore(new Date("2026-03-31T00:00:00Z"), 1);
    expect(cutoff.getTime()).toBeGreaterThan(new Date("2026-02-28T00:00:00Z").getTime());
  });

  it("counts days backwards", () => {
    const cutoff = daysBefore(new Date("2026-08-26T00:00:00Z"), 30);
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-07-27");
  });
});

describe("what redaction leaves behind", () => {
  it("gives every row its own placeholder address, so a second redaction cannot collide", () => {
    expect(redactedEmail("a")).not.toBe(redactedEmail("b"));
  });

  it("uses the reserved TLD, so a redacted address can never be delivered to", () => {
    // RFC 2606 reserves .invalid precisely so that this cannot resolve.
    expect(redactedEmail("anything")).toMatch(/@removed\.invalid$/);
  });

  it("keeps the library card number as the name, so the lending history stays readable", () => {
    expect(archivedDisplayName("LIB-R0007")).toBe("LIB-R0007");
  });

  it("falls back to a label rather than an empty name", () => {
    expect(archivedDisplayName(null)).toBe("Former reader");
    expect(archivedDisplayName("   ")).toBe("Former reader");
  });
});

describe("the privacy notice says exactly what the pass does", () => {
  const text = describeRetention(DECIDED).join(" ");

  it("names every period that is in force", () => {
    expect(text).toMatch(/30 days/);
    expect(text).toMatch(/2 years/);
    expect(text).toMatch(/3 years/);
  });

  it("says the borrowing record survives and the name does not", () => {
    expect(text).toMatch(/borrowing record/i);
    expect(text).toMatch(/library card number/i);
  });

  it("says erasing is permanent", () => {
    expect(text).toMatch(/permanent|cannot be undone/i);
  });

  it("says the consent record survives, because it is the evidence anything was allowed", () => {
    expect(text).toMatch(/consent was given stays/i);
  });

  it("describes only the periods actually set", () => {
    const photoOnly = describeRetention({ ...UNSET_RETENTION, removePhotoAfterClosedDays: 30 });
    const joined = photoOnly.join(" ");
    expect(joined).toMatch(/photograph/i);
    expect(joined).not.toMatch(/guardian's name/i);
  });

  it("prints days as days, because a month is not a fixed number of them", () => {
    expect(describeRetention({ ...UNSET_RETENTION, removePhotoAfterClosedDays: 30 }).join(" ")).toMatch(
      /30 days/,
    );
    expect(describeRetention({ ...UNSET_RETENTION, removePhotoAfterClosedDays: 30 }).join(" ")).not.toMatch(
      /a month/,
    );
  });

  it("reads a round number of months as years", () => {
    expect(describeRetention({ ...UNSET_RETENTION, archiveClosedAfterMonths: 12 }).join(" ")).toMatch(
      /a year/,
    );
    expect(describeRetention({ ...UNSET_RETENTION, archiveClosedAfterMonths: 18 }).join(" ")).toMatch(
      /18 months/,
    );
  });
});

describe("the pass is written to be safe rather than thorough", () => {
  const source = readFileSync(join(process.cwd(), "src/server/lib/retention.ts"), "utf8");

  it("acts on an allowlist of statuses, never a denylist", () => {
    // Same rule as @/lib/account-lifecycle: a status added next year must do
    // nothing until somebody puts it on a list on purpose.
    expect(source).toContain("ERASABLE_STATUSES");
    expect(source).toContain('CLOSED_STATUSES.filter(');
  });

  it("never erases an already-archived reader again", () => {
    expect(source).toContain('status !== "ARCHIVED"');
  });

  it("never re-redacts a guardian whose details are already gone", () => {
    expect(source).toContain('endsWith: "@removed.invalid"');
  });

  it("skips a guardian whose children have no archival date rather than guessing one", () => {
    expect(source).toContain("if (archivedAt.length !== guardian.memberLinks.length) continue;");
  });

  it("deletes no rows at all — only fields", () => {
    // Sessions and tokens are the sole exception, and they are credentials
    // rather than records. Nothing else may be a deleteMany.
    const deletions = source.match(/tx\.(\w+)\.deleteMany/g) ?? [];
    expect(deletions.sort()).toEqual(["tx.authToken.deleteMany", "tx.session.deleteMany"]);
  });

  it("keeps the child's name out of the audit rows it writes", () => {
    // An audit trail about erasing personal data must not be where the personal
    // data survives.
    const metadataBlocks = source.match(/metadata: \{[\s\S]*?\},/g) ?? [];
    expect(metadataBlocks.length).toBeGreaterThan(0);
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/displayName|memberCode|fullName|email|apartment/);
    }
  });

  it("runs before the media sweep, so a photograph goes the same night", () => {
    const maintenance = readFileSync(
      join(process.cwd(), "src/server/lib/maintenance.ts"),
      "utf8",
    );
    expect(maintenance.indexOf("runRetentionPass")).toBeLessThan(
      maintenance.indexOf("await sweepPendingMedia()"),
    );
  });

  it("survives its own failure without stopping the rest of the nightly run", () => {
    const maintenance = readFileSync(
      join(process.cwd(), "src/server/lib/maintenance.ts"),
      "utf8",
    );
    expect(maintenance).toContain("[maintenance] retention pass failed:");
  });
});

describe("the schema keeps the periods nullable", () => {
  it("stores all three as optional columns", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    for (const column of [
      "archiveClosedAfterMonths   Int?",
      "removePhotoAfterClosedDays Int?",
      "removeGuardianAfterMonths  Int?",
    ]) {
      expect(schema).toContain(column);
    }
  });

  it("adds them without touching a single existing row", () => {
    const migration = readFileSync(
      join(process.cwd(), "prisma/migrations/20260826210000_retention_policy/migration.sql"),
      "utf8",
    );
    // The statements, not the comments — the comment above them says the word
    // "dropped" precisely to promise that nothing is.
    const statements = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).toMatch(/ADD COLUMN/);
    expect(statements).not.toMatch(/DROP|DELETE|UPDATE|NOT NULL/i);
  });
});
