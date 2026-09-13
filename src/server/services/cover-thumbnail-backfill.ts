import "server-only";

import { prisma } from "@/server/db";
import {
  COVER_THUMB_ESTIMATED_BYTES,
  buildCoverThumbnailStorageKey,
  makeCoverThumbnail,
} from "@/server/lib/cover-thumbnail";
import { storage } from "@/server/lib/storage";
import { UPLOAD_PURPOSES } from "@/server/lib/uploads";

/**
 * Makes thumbnails for covers uploaded before thumbnails existed (ADR-072).
 *
 * Additive and nothing else:
 *
 * - it reads each original and never writes, moves or deletes one;
 * - it writes one new object per cover under a new key, and fills in the four
 *   `thumb_*` columns of that cover's row;
 * - the row update is conditional on those columns still being null, so a
 *   second run -- or a run racing an upload -- changes nothing that is already
 *   done. A second run finds no candidates at all;
 * - `dryRun` reads the database only: no storage read, no storage write, no row
 *   update. It reports how many covers and roughly how many bytes a real run
 *   would write.
 *
 * Book covers only, claimed covers only (`pendingDeletionAt` null). Nothing here
 * can reach a child's photograph, and the database would refuse the update if
 * anything tried.
 */

export interface CoverThumbnailBackfillResult {
  dryRun: boolean;
  /** Covers with no thumbnail yet. */
  candidates: number;
  /** Total size of those covers' originals, as recorded at upload. */
  sourceBytes: number;
  /** A dry run's guess at what a real run writes. */
  estimatedThumbnailBytes: number;
  created: number;
  bytesWritten: number;
  /** Media ids whose original sharp could not decode. Left without a thumbnail. */
  undecodable: string[];
  /** Media ids whose original bytes were not in storage. Left alone. */
  missingOriginal: string[];
  /**
   * Media ids that gained a thumbnail from somewhere else between this run
   * reading them and updating them. Their row was not changed. The object this
   * run wrote for them is listed by key, so a person can decide about it -- this
   * code never deletes anything.
   */
  lostRace: Array<{ mediaId: string; unusedStorageKey: string }>;
}

const CANDIDATE_WHERE = {
  purpose: UPLOAD_PURPOSES.BOOK_COVER,
  thumbStorageKey: null,
  pendingDeletionAt: null,
} as const;

export async function backfillCoverThumbnails(options: {
  dryRun: boolean;
  log?: (line: string) => void;
}): Promise<CoverThumbnailBackfillResult> {
  const log = options.log ?? (() => undefined);

  const summary = await prisma.mediaObject.aggregate({
    where: CANDIDATE_WHERE,
    _count: { _all: true },
    _sum: { byteSize: true },
  });

  const result: CoverThumbnailBackfillResult = {
    dryRun: options.dryRun,
    candidates: summary._count._all,
    sourceBytes: summary._sum.byteSize ?? 0,
    estimatedThumbnailBytes: summary._count._all * COVER_THUMB_ESTIMATED_BYTES,
    created: 0,
    bytesWritten: 0,
    undecodable: [],
    missingOriginal: [],
    lostRace: [],
  };

  if (options.dryRun || result.candidates === 0) return result;

  const covers = await prisma.mediaObject.findMany({
    where: CANDIDATE_WHERE,
    orderBy: { createdAt: "asc" },
    select: { id: true, storageKey: true, visibility: true },
  });

  for (const cover of covers) {
    const original = await storage().get(cover.storageKey);
    if (!original) {
      result.missingOriginal.push(cover.id);
      log(`missing original  ${cover.id}`);
      continue;
    }

    let thumbnail;
    try {
      thumbnail = await makeCoverThumbnail(original);
    } catch {
      result.undecodable.push(cover.id);
      log(`cannot decode     ${cover.id}`);
      continue;
    }

    const key = buildCoverThumbnailStorageKey();
    await storage().put(key, thumbnail.bytes, thumbnail.mimeType, cover.visibility);

    const { count } = await prisma.mediaObject.updateMany({
      where: { id: cover.id, ...CANDIDATE_WHERE },
      data: {
        thumbStorageKey: key,
        thumbMimeType: thumbnail.mimeType,
        thumbByteSize: thumbnail.byteSize,
        thumbChecksumSha256: thumbnail.checksumSha256,
      },
    });

    if (count === 1) {
      result.created += 1;
      result.bytesWritten += thumbnail.byteSize;
      log(`thumbnail         ${cover.id}  ${original.byteLength} B -> ${thumbnail.byteSize} B`);
    } else {
      result.lostRace.push({ mediaId: cover.id, unusedStorageKey: key });
      log(`already done      ${cover.id}  (unused object left at ${key})`);
    }
  }

  return result;
}
