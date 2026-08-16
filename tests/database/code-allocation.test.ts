import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { allocateCopyCode, allocateSequenceValue } from "@/server/lib/codes";
import { createLibraryFixture, db, resetDatabase, type Fixture } from "./helpers";

/**
 * Code allocation under concurrency.
 *
 * Two librarians cataloguing books at the same desk must never be handed the
 * same number. A read-then-write allocator passes a single-threaded test and
 * fails in the room, so this test runs the allocations in parallel.
 */

let fixture: Fixture;

beforeAll(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sequence allocation", () => {
  it("hands out consecutive values", async () => {
    const values = [];
    for (let index = 0; index < 5; index += 1) {
      values.push(await allocateSequenceValue(db, fixture.libraryId, "BOOK_COPY"));
    }

    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it("never issues the same value twice under concurrent allocation", async () => {
    const CONCURRENCY = 40;

    const values = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        allocateSequenceValue(db, fixture.libraryId, "MEMBER"),
      ),
    );

    // The real assertion: no duplicates. A read-then-write allocator fails here.
    expect(new Set(values).size).toBe(CONCURRENCY);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(CONCURRENCY);
  });

  it("keeps the two kinds of code independent of each other", async () => {
    const before = await db.codeSequence.findUniqueOrThrow({
      where: { libraryId_kind: { libraryId: fixture.libraryId, kind: "MEMBER" } },
    });

    await allocateSequenceValue(db, fixture.libraryId, "BOOK_COPY");

    const after = await db.codeSequence.findUniqueOrThrow({
      where: { libraryId_kind: { libraryId: fixture.libraryId, kind: "MEMBER" } },
    });

    expect(after.nextValue).toBe(before.nextValue);
  });

  it("formats an allocated value using the configured prefix and padding", async () => {
    const settings = await db.librarySettings.findUniqueOrThrow({
      where: { libraryId: fixture.libraryId },
    });

    const code = await allocateCopyCode(
      db,
      fixture.libraryId,
      settings.copyCodePrefix,
      settings.copyCodePadding,
    );

    expect(code).toMatch(/^TST-\d{4,}$/);
  });

  it("rolls the reservation back when the surrounding transaction fails", async () => {
    // A failed insert must not burn a code — otherwise the shelf grows gaps.
    const before = await db.codeSequence.findUniqueOrThrow({
      where: { libraryId_kind: { libraryId: fixture.libraryId, kind: "BOOK_COPY" } },
    });

    await expect(
      db.$transaction(async (tx) => {
        await allocateSequenceValue(tx, fixture.libraryId, "BOOK_COPY");
        throw new Error("simulated failure after allocation");
      }),
    ).rejects.toThrow(/simulated failure/);

    const after = await db.codeSequence.findUniqueOrThrow({
      where: { libraryId_kind: { libraryId: fixture.libraryId, kind: "BOOK_COPY" } },
    });

    expect(after.nextValue).toBe(before.nextValue);
  });

  it("fails loudly when no sequence row exists rather than inventing a code", async () => {
    await expect(
      allocateSequenceValue(db, fixture.libraryId, "MEMBER" as never),
    ).resolves.toBeTypeOf("number");

    await expect(
      // @ts-expect-error — deliberately passing an unknown kind
      allocateSequenceValue(db, fixture.libraryId, "NOT_A_REAL_KIND"),
    ).rejects.toThrow(/No code_sequence row/);
  });
});
