import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";

/**
 * Allocation of human-facing codes: MJCL-0001 for a book copy, MJCL-R0042 for a
 * reader's library card.
 *
 * Correctness under concurrency matters here: two librarians cataloguing books
 * at the same desk must never be handed the same number. A read-then-write
 * (`SELECT max(...)` followed by an insert) has a race window between the two
 * statements. Instead this uses a single atomic statement:
 *
 *     UPDATE code_sequence SET next_value = next_value + 1 ... RETURNING
 *
 * Postgres takes a row lock for the duration of that statement, so concurrent
 * callers serialise on it and each receives a distinct value. The unique index
 * on (library_id, copy_code) is the second line of defence behind it.
 *
 * Codes are never reused, even after a copy is archived — a code is a permanent
 * physical label stuck to a real book.
 */

export const CODE_SEQUENCE_KINDS = {
  BOOK_COPY: "BOOK_COPY",
  MEMBER: "MEMBER",
} as const;

export type CodeSequenceKind = (typeof CODE_SEQUENCE_KINDS)[keyof typeof CODE_SEQUENCE_KINDS];

/**
 * Formats a prefix and a number into a code.
 *
 *   formatCode("LIB",   51, 4)  →  "LIB-0051"
 *   formatCode("LIB-R", 42, 4)  →  "LIB-R0042"
 *
 * The rule: a prefix made only of letters and digits gets a "-" inserted before
 * the number; a prefix that already contains punctuation is treated as complete
 * and the number is appended directly. Without this, a member prefix of "LIB-R"
 * would produce "LIB-R-0042" — not what the card printed for that child says.
 */
export function formatCode(prefix: string, value: number, padding: number): string {
  const trimmed = prefix.trim();
  if (!trimmed) throw new Error("Code prefix must not be empty");
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Code value must be a positive integer, got ${value}`);
  }
  if (!Number.isInteger(padding) || padding < 1 || padding > 10) {
    throw new RangeError(`Code padding must be between 1 and 10, got ${padding}`);
  }

  const prefixIsComplete = /[^A-Za-z0-9]/.test(trimmed);
  const separator = prefixIsComplete ? "" : "-";

  return `${trimmed}${separator}${String(value).padStart(padding, "0")}`;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Reserves the next number for a kind of code. Must be called inside the same
 * transaction as the insert that uses it, so that a failed insert rolls the
 * reservation back rather than burning a code.
 */
export async function allocateSequenceValue(
  db: Db,
  libraryId: string,
  kind: CodeSequenceKind,
): Promise<number> {
  const rows = await db.$queryRaw<{ next_value: number }[]>`
    UPDATE code_sequence
       SET next_value = next_value + 1,
           updated_at = now()
     WHERE library_id = ${libraryId}
       AND kind = ${kind}
    RETURNING next_value - 1 AS next_value
  `;

  const allocated = rows[0]?.next_value;
  if (allocated === undefined) {
    throw new Error(
      `No code_sequence row for library ${libraryId} kind ${kind}. The library seed creates one per kind.`,
    );
  }
  return allocated;
}

/** Allocates and formats the next book copy code, e.g. `MJCL-0051`. */
export async function allocateCopyCode(
  db: Db,
  libraryId: string,
  prefix: string,
  padding: number,
): Promise<string> {
  const value = await allocateSequenceValue(db, libraryId, CODE_SEQUENCE_KINDS.BOOK_COPY);
  return formatCode(prefix, value, padding);
}

/** Allocates and formats the next member card code, e.g. `MJCL-R0042`. */
export async function allocateMemberCode(
  db: Db,
  libraryId: string,
  prefix: string,
  padding: number,
): Promise<string> {
  const value = await allocateSequenceValue(db, libraryId, CODE_SEQUENCE_KINDS.MEMBER);
  return formatCode(prefix, value, padding);
}
