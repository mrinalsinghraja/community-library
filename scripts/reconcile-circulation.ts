import { PrismaClient } from "@prisma/client";

import {
  findStrandedCopies,
  markMissing,
  markOnShelf,
  recordLoan,
  ReconciliationError,
  type StrandedCopy,
} from "./lib/circulation-reconciliation";

/**
 * Resolves books that read BORROWED with no loan behind them.
 *
 *   npm run reconcile:circulation
 *
 * Run with no arguments it changes nothing and prints the list. Phase 3's
 * migration refuses to run while that list is non-empty, and this is the tool
 * for emptying it — one book at a time, each with a person's name and a reason
 * attached.
 *
 * There is no bulk mode. Each of these books is somewhere specific, and the
 * whole point of this script is that a human found out where.
 */

const USAGE = `
Books that read BORROWED with no borrower.

  npm run reconcile:circulation
      List them. Changes nothing.

  npm run reconcile:circulation -- --copy MJCL-B0010 --on-shelf \\
      --operator "Priya" --reason "Found on the returns trolley"
      The book is on the shelf. Marks it AVAILABLE.

  npm run reconcile:circulation -- --copy MJCL-B0010 --with MJCL-R0007 \\
      --issued 2026-08-01 --due 2026-08-15 \\
      --operator "Priya" --reason "Aarav's mother confirmed they have it"
      A named child has it. Records the real loan; the book stays BORROWED.

  npm run reconcile:circulation -- --copy MJCL-B0010 --missing \\
      --operator "Priya" --reason "Not on the shelf, nobody recalls lending it"
      Nobody knows where it is. Marks it LOST — which is the truth, and
      promises the book to no one.

Every change is written to the audit log under the operator's name and can
be read back there. None of them is reversible from this script.
`.trim();

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  // `--reason --operator x` would otherwise swallow the next flag as a value.
  if (value === undefined || value.startsWith("--")) return "";
  return value;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseDate(value: string | undefined, label: string): Date {
  if (!value) throw new ReconciliationError(`--${label} is required (YYYY-MM-DD).`);
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReconciliationError(`--${label} is not a date I can read: ${value}`);
  }
  return parsed;
}

function report(list: StrandedCopy[]): void {
  if (list.length === 0) {
    console.log("\n✓ Nothing to reconcile. Every borrowed book has a borrower.\n");
    return;
  }

  console.log(`\n${list.length} book(s) read BORROWED with no loan and so no borrower:\n`);
  for (const copy of list) {
    console.log(`  ${copy.copyCode}  ${copy.title}`);
    console.log(`    ${copy.libraryName} · last changed ${copy.updatedAt.toISOString()}`);
  }
  console.log("\nFind out where each one is, then resolve it explicitly:\n");
  console.log(USAGE.split("\n").slice(2).join("\n"));
  console.log();
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    if (has("help")) {
      console.log(`\n${USAGE}\n`);
      return;
    }

    const copyCode = flag("copy");
    if (!copyCode) {
      report(await findStrandedCopies(prisma));
      return;
    }

    const decision = {
      copyCode,
      operator: flag("operator") ?? "",
      reason: flag("reason") ?? "",
    };

    if (has("on-shelf")) {
      const copy = await markOnShelf(prisma, decision);
      console.log(`\n✓ ${copy.copyCode} is on the shelf again and can be lent out.\n`);
      return;
    }

    if (has("missing")) {
      const copy = await markMissing(prisma, decision);
      console.log(
        `\n✓ ${copy.copyCode} is recorded as missing. It will not be offered to anyone until it turns up.\n`,
      );
      return;
    }

    const memberCode = flag("with");
    if (memberCode) {
      const copy = await recordLoan(prisma, {
        ...decision,
        memberCode,
        issuedAt: parseDate(flag("issued"), "issued"),
        dueAt: parseDate(flag("due"), "due"),
      });
      console.log(
        `\n✓ ${copy.copyCode} is recorded as out with ${memberCode}. It stays borrowed, and now the record says who has it.\n`,
      );
      return;
    }

    throw new ReconciliationError(
      "Say what you found: --on-shelf, --with <card>, or --missing. Run --help for the full form.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ReconciliationError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  console.error("\nReconciliation failed:\n", error);
  process.exit(1);
});
