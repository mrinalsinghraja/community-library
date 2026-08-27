import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fillConfirm, summariseBulk, type BulkResult } from "@/lib/bulk";

/**
 * Bulk actions.
 *
 * The property that matters is architectural rather than visual: a bulk button
 * must be the row's own action run once per row. These tests read the source to
 * prove it, because the failure mode is not a wrong pixel — it is somebody
 * reaching for `updateMany` one day and quietly bypassing every rule, lock and
 * audit row the single-row path enforces.
 */

const BULK_ACTION_FILES = [
  "src/server/actions/circulation-actions.ts",
  "src/server/actions/registration-actions.ts",
  "src/server/actions/review-actions.ts",
  "src/server/actions/profile-actions.ts",
];

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * The source with its comments taken out.
 *
 * These files explain themselves at length, and several of the explanations
 * mention the very things the assertions forbid — "permission checks are NOT
 * done here" contains the word it is promising not to use. Matching against
 * prose would make the comments unwritable.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("what a librarian is told afterwards", () => {
  const of = (done: number, failures: string[]): BulkResult => ({
    done,
    failures: failures.map((reason) => ({ label: "A book", reason })),
  });

  it("reports a clean run plainly", () => {
    expect(summariseBulk(of(4, []), "book", "books")).toBe("Done — 4 books.");
  });

  it("uses the singular when one row was done", () => {
    expect(summariseBulk(of(1, []), "book", "books")).toBe("Done — 1 book.");
  });

  it("never hides a partial failure behind a success message", () => {
    const text = summariseBulk(of(5, ["gone"]), "book", "books");
    expect(text).toContain("5 books done");
    expect(text).toContain("1 could not");
  });

  it("says plainly when nothing worked", () => {
    expect(summariseBulk(of(0, ["gone", "gone"]), "book", "books")).toMatch(/Nothing was done/);
  });

  it("says so when nothing was selected at all", () => {
    expect(summariseBulk({ done: 0, failures: [] }, "book", "books")).toBe("Nothing was selected.");
  });
});

describe("a bulk action is the single-row action, repeated", () => {
  it("never reaches for a bulk write", () => {
    for (const path of BULK_ACTION_FILES) {
      const source2 = code(path);
      const bulkSections = source2.slice(source2.indexOf("export async function bulk"));
      if (!bulkSections) continue;
      // The whole safety argument. A bulk button that ran its own query would
      // be a second copy of every rule, free to drift from the one beside it.
      expect(bulkSections, `${path} uses a bulk write`).not.toMatch(
        /updateMany|deleteMany|createMany|\$executeRaw/,
      );
    }
  });

  it("routes every bulk action through runBulk", () => {
    for (const path of BULK_ACTION_FILES) {
      const source = read(path);
      const names = source.match(/export async function (bulk\w+)/g) ?? [];
      if (names.length === 0) continue;
      const calls = source.match(/await runBulk\(/g) ?? [];
      expect(calls.length, `${path} has ${names.length} bulk actions`).toBe(names.length);
    }
  });

  it("caps how much one press can do", () => {
    for (const path of BULK_ACTION_FILES) {
      const source = read(path);
      const names = source.match(/export async function (bulk\w+)/g) ?? [];
      if (names.length === 0) continue;
      const capped = source.match(/limitBulkSelection\(/g) ?? [];
      expect(capped.length, `${path} does not cap every bulk action`).toBe(names.length);
    }
  });

  it("does not check permissions itself, so it cannot get one wrong", () => {
    // Each wrapped service function calls requirePermission. A bulk runner that
    // did its own check would be a second gate to keep in step with the first.
    expect(code("src/server/lib/bulk.ts")).not.toMatch(
      /requirePermission|requireAnyPermission/,
    );
  });

  it("keeps going after one row fails", () => {
    const runner = read("src/server/lib/bulk.ts");
    expect(runner).toContain("failures.push(");
    // A `throw` inside the loop would abandon the remaining rows.
    const loop = runner.slice(runner.indexOf("for (const id of ids)"));
    expect(loop.slice(0, loop.indexOf("return"))).not.toMatch(/\bthrow\b/);
  });

  it("names a failing row for a person, never by id", () => {
    const runner = read("src/server/lib/bulk.ts");
    expect(runner).toContain("label(id)");
  });
});

describe("a confirmation template", () => {
  it("fills in the number", () => {
    expect(fillConfirm("Give out {count} books?", 4)).toBe("Give out 4 books?");
  });

  it("picks the singular when there is one", () => {
    expect(fillConfirm("Give out {count} {book|books}?", 1)).toBe("Give out 1 book?");
    expect(fillConfirm("Give out {count} {book|books}?", 3)).toBe("Give out 3 books?");
  });

  it("handles several choices in one sentence", () => {
    expect(fillConfirm("{child|children} and {their guardian|each guardian}", 1)).toBe(
      "child and their guardian",
    );
    expect(fillConfirm("{child|children} and {their guardian|each guardian}", 2)).toBe(
      "children and each guardian",
    );
  });

  it("leaves an apostrophe inside a choice alone", () => {
    expect(fillConfirm("{a reader's record|readers' records}", 1)).toBe("a reader's record");
  });
});

describe("the toolbar", () => {
  const toolbar = read("src/components/desk/selection-toolbar.tsx");

  it("leaves bulk buttons off until rows are ticked", () => {
    // The export treats "nothing ticked" as everything. A bulk action must not,
    // and this is the line that keeps the dangerous one from inheriting the
    // convenient one's default.
    expect(toolbar).toContain("disabled={busy || chosen === 0}");
  });

  it("does not let the export permission decide who may act", () => {
    expect(toolbar).toContain("if ((!canExport || !report) && !bulk) return <>{children}</>;");
  });

  it("lists every failure by name rather than as a count", () => {
    expect(toolbar).toContain("outcome.failures.map(");
  });
});

describe("every queue keeps its per-row buttons", () => {
  const rowLevel: [string, string][] = [
    ["src/app/desk/requests/page.tsx", "DecisionActions"],
    ["src/app/desk/renewals/page.tsx", "DecisionActions"],
    ["src/app/desk/loans/page.tsx", "LoanActions"],
    ["src/app/desk/registrations/page.tsx", "ReviewActions"],
    ["src/app/desk/reviews/page.tsx", "ModerationActions"],
    ["src/app/desk/changes/page.tsx", "ChangeDecision"],
  ];

  it.each(rowLevel)("%s still renders %s", (path, component) => {
    // Bulk adds a choice. A screen that lost its per-row buttons would have
    // taken one away — and going one at a time, reading each, stays the way a
    // careful librarian works.
    expect(read(path)).toContain(`<${component}`);
  });

  it.each(rowLevel)("%s offers a bulk action too", (path) => {
    expect(read(path)).toContain("bulk={");
  });
});

describe("bulk actions are gated on the decision permission, not on export", () => {
  const gates: [string, string][] = [
    ["src/app/desk/requests/page.tsx", "loan.issue"],
    ["src/app/desk/renewals/page.tsx", "loan.renew"],
    ["src/app/desk/registrations/page.tsx", "registration.review"],
    ["src/app/desk/reviews/page.tsx", "review.moderate"],
    ["src/app/desk/changes/page.tsx", "profile_change.review"],
  ];

  it.each(gates)("%s guards its bulk block with %s", (path, permission) => {
    const source = read(path);
    const block = source.slice(source.indexOf("bulk={"), source.indexOf("bulk={") + 400);
    expect(block).toContain(permission);
  });
});

describe("every confirmation says the number and the consequence", () => {
  const pages = [
    "src/app/desk/requests/page.tsx",
    "src/app/desk/renewals/page.tsx",
    "src/app/desk/loans/page.tsx",
    "src/app/desk/registrations/page.tsx",
    "src/app/desk/reviews/page.tsx",
    "src/app/desk/changes/page.tsx",
  ];

  it.each(pages)("%s never asks a bare 'are you sure'", (path) => {
    const source = read(path);
    const confirms = source.match(/confirm:\s*\n?\s*"[\s\S]*?",/g) ?? [];
    expect(confirms.length).toBeGreaterThan(0);
    for (const confirm of confirms) {
      // The count has to appear, or the sentence is not about what is about to
      // happen. A confirmation nobody reads is worse than none.
      expect(confirm).toContain("{count}");
      expect(confirm).not.toMatch(/are you sure/i);
    }
  });
});
