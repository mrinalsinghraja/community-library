import "server-only";

import type { Prisma } from "@prisma/client";

import { formatCode } from "@/lib/codes";
import { prisma } from "@/server/db";

/**
 * Allocation of human-facing codes: one for a book copy, one for a reader's
 * library card. The *shape* of a code lives in `@/lib/codes`, which the seed and
 * the sign-in pages share; this file is only about handing out the next number.
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

/** Re-exported so callers of the allocator do not need a second import. */
export { formatCode };

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

/** Allocates and formats the next book copy code, e.g. `LIB-R0051`. */
export async function allocateCopyCode(
  db: Db,
  libraryId: string,
  prefix: string,
  padding: number,
): Promise<string> {
  const value = await allocateSequenceValue(db, libraryId, CODE_SEQUENCE_KINDS.BOOK_COPY);
  return formatCode(prefix, value, padding);
}

/** Allocates and formats the next member card code, e.g. `LIB-R0042`. */
export async function allocateMemberCode(
  db: Db,
  libraryId: string,
  prefix: string,
  padding: number,
): Promise<string> {
  const value = await allocateSequenceValue(db, libraryId, CODE_SEQUENCE_KINDS.MEMBER);
  return formatCode(prefix, value, padding);
}
