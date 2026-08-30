import { downscaleImage, type DownscaleOptions } from "@/lib/image-downscale";
import { describeSize } from "@/lib/file-size";

/**
 * Fitting a chosen picture into the size a form will accept.
 *
 * Shared by the two places somebody hands this library an image — a parent
 * choosing their child's card picture, and a librarian photographing a book
 * jacket — because both learned the same lesson the same painful way and it
 * would be a waste for only one of them to remember it.
 *
 * The lesson: a byte count is a proxy for detail, and it stops being a proxy
 * for anything the moment this application picks the encoding. So the two ends
 * of a size band are not the same kind of question and must not be asked in the
 * same place:
 *
 *   * the FLOOR is about the picture somebody chose — a thumbnail lifted from a
 *     search result or a chat app, soft at any size. Ask it of the original
 *     file, before any shrinking, where the answer is both meaningful and
 *     instant.
 *   * the CEILING is about what gets stored and what every reader then
 *     downloads. Ask it of the result.
 *
 * Asking the floor of the result is the bug this file exists to prevent: a
 * 2.9 MB photograph of a plain subject re-encodes to 74 KB, and telling
 * somebody that picture is "too small" — about a file this code just made from
 * their perfectly good one — is both wrong and impossible to act on.
 */

/**
 * Builds a ladder of encodings, biggest result first.
 *
 * Ordering matters more than the exact numbers. Because each rung produces a
 * smaller file than the one above it, the first rung that fits under the
 * ceiling is by construction the LARGEST that fits — so it is also the one with
 * the least quality taken out of it, and the search can stop there.
 *
 * Starting high and stepping down is the direction that cannot fail. A ladder
 * that started at its smallest size had no way back up when it undershot.
 */
export function shrinkLadder(topEdge: number): DownscaleOptions[] {
  return [
    { maxEdge: topEdge, quality: 0.92 },
    { maxEdge: Math.round(topEdge * 0.75), quality: 0.86 },
    { maxEdge: Math.round(topEdge * 0.55), quality: 0.8 },
    { maxEdge: Math.round(topEdge * 0.4), quality: 0.74 },
  ];
}

/**
 * Shrinks a picture until it fits under `maxBytes`, or gives back the closest
 * it managed so the caller can say so plainly.
 *
 * Every failure path returns something usable. Nobody with a book in their hand
 * and a queue behind them should be stopped by an image codec.
 */
export async function shrinkToBand(
  file: File,
  { topEdge, maxBytes }: { topEdge: number; maxBytes: number },
): Promise<{ file: File; changed: boolean }> {
  /*
   * A file already under the ceiling is left completely alone. Re-encoding it
   * could only make it smaller, and smaller is the direction the floor lives
   * in: nothing to gain, and a picture needlessly softened to lose.
   */
  if (file.size <= maxBytes) return { file, changed: false };

  let best: { file: File; changed: boolean } = { file, changed: false };

  for (const step of shrinkLadder(topEdge)) {
    // The ORIGINAL every time, never the previous result: re-compressing an
    // already-compressed JPEG stacks its damage.
    const attempt = await downscaleImage(file, step);
    if (attempt.file.size < best.file.size) best = attempt;
    if (attempt.file.size <= maxBytes) return attempt;
  }

  return best;
}

/**
 * The size of a picture, and what shrinking did to it.
 *
 * Both numbers whenever they differ. Somebody who chose a 6 MB picture and is
 * told "90 KB" has been told something that reads as plainly wrong, and has no
 * way to know whether the page looked at the file they meant.
 */
export function sizeStory(original: File, prepared: File): string {
  if (prepared.size === original.size) return describeSize(prepared.size);
  return `${describeSize(prepared.size)}, made smaller on your device from ${describeSize(original.size)}`;
}

/**
 * Where somebody with a picture too big for any of this can shrink it.
 *
 * Named once rather than typed into two forms' copy. It runs entirely in the
 * browser and has no upload path at all, which is the only reason it can be
 * suggested at all for a photograph of somebody's child — and the sentences
 * that link to it say so.
 */
export const COMPRESS_TOOL_URL = "https://tools.msrx.co.in/image/compress-image";
