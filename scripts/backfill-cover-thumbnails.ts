import { backfillCoverThumbnails } from "../src/server/services/cover-thumbnail-backfill";

/**
 * Thumbnails for covers uploaded before thumbnails existed (ADR-072).
 *
 *   npm run thumbnails:backfill
 *       Dry run. Reads the database only and prints how many covers need a
 *       thumbnail and roughly how many bytes that would write. Changes nothing.
 *
 *   npm run thumbnails:backfill -- --write
 *       Makes them. Reads each original, writes one new WebP object per cover,
 *       and fills in that row's thumb_* columns. Never touches an original.
 *       Safe to run twice: the second run finds nothing to do.
 *
 * A dry run is the default on purpose, so the command you type by accident is
 * the harmless one. `--dry-run` is accepted too, for anyone who writes it out.
 *
 * It uses whatever DATABASE_URL and storage settings the environment has, and
 * prints the database host before doing anything so there is no doubt which
 * library it is about to touch.
 */

const write = process.argv.includes("--write");
const dryRun = !write || process.argv.includes("--dry-run");

function databaseHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unset)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  console.log(`Database: ${databaseHost()}`);
  console.log(dryRun ? "Mode: DRY RUN — nothing will be written\n" : "Mode: WRITE\n");

  const result = await backfillCoverThumbnails({ dryRun, log: (line) => console.log(line) });

  console.log("");
  console.log(`Covers without a thumbnail: ${result.candidates} (originals total ${kb(result.sourceBytes)})`);

  if (result.dryRun) {
    console.log(`A real run would write about ${kb(result.estimatedThumbnailBytes)} of thumbnails.`);
    console.log("Run again with --write to make them.");
    return;
  }

  console.log(`Thumbnails created: ${result.created}, ${kb(result.bytesWritten)} written`);
  if (result.undecodable.length) console.log(`Could not decode: ${result.undecodable.join(", ")}`);
  if (result.missingOriginal.length) console.log(`Original missing: ${result.missingOriginal.join(", ")}`);
  for (const race of result.lostRace) {
    console.log(`Already had a thumbnail: ${race.mediaId} — unused object at ${race.unusedStorageKey}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
