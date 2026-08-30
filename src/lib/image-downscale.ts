/**
 * Shrinking a picture before it is uploaded.
 *
 * A librarian photographs a book jacket on a phone and gets a 4 MB, 4032 × 3024
 * image. Stored as-is, every child who opens the catalogue then downloads four
 * megabytes to render a thumbnail two centimetres wide, on whatever connection
 * the library room has.
 *
 * This runs in the browser, before the form is submitted, and that placement is
 * the whole design:
 *
 *   * the server keeps its no-native-dependency, no-re-encoding posture — see
 *     `stripImageMetadata` in `src/server/lib/uploads.ts` for why decoding
 *     attacker-controlled pixels server-side was deliberately avoided;
 *   * the bytes that arrive are already the size they will be served at, so
 *     there is no second stored representation to keep in step and no second
 *     storage system;
 *   * a phone photograph's EXIF — including, on a book photographed at home,
 *     the coordinates it was taken at — never leaves the device at all, because
 *     a canvas re-encode simply has nowhere to put it.
 *
 * **This is a convenience, never a control.** Anyone can post the form without
 * running this code. Every rule that matters — the size cap, the magic-byte
 * check, the executable refusal, the metadata strip, the generated storage key
 * — still runs on the server against the bytes that actually arrive, exactly as
 * it did before. Nothing here is trusted, so nothing here can be bypassed to
 * any effect.
 *
 * Every failure path returns the original file. A librarian with a book in
 * their hand and a queue behind them must never be stopped by an image codec.
 *
 * Two callers, with different needs, which is why the edge and the floor are
 * arguments: a book cover, where the floor exists so a thumbnail never becomes
 * the picture on the shelf; and a child's photograph on the registration form,
 * where there is no floor and the size that matters is the one the transport
 * will carry — see `src/lib/child-photo.ts`.
 */

/**
 * The longest edge a stored cover needs.
 *
 * The largest a cover is ever displayed is the full-cover viewer, capped at
 * 28rem — 448 CSS pixels, so 896 device pixels on a 2× screen and 1344 on the
 * rare 3×. 1400 covers all of them with nothing left over.
 */
export const MAX_COVER_EDGE = 1400;

/** JPEG quality. 0.82 is the point where jacket text is still crisp. */
export const COVER_QUALITY = 0.82;

/**
 * Below this, re-encoding would cost quality and save nothing worth having.
 * A 300 KB cover is already a smaller download than the page it sits on.
 */
const LEAVE_ALONE_BYTES = 300 * 1024;

export interface DownscaleResult {
  file: File;
  /** False when the original was returned untouched, for whatever reason. */
  changed: boolean;
}

export interface DownscaleOptions {
  /** Longest edge to keep. Defaults to what a book cover needs. */
  maxEdge?: number;
  /**
   * JPEG quality, 0 to 1. Defaults to what a book jacket needs.
   *
   * An argument because both callers walk a short ladder of edges and qualities
   * looking for one that lands under the size their form accepts — see
   * `shrinkToBand`.
   */
  quality?: number;
}

/**
 * Returns a smaller version of `file`, or `file` itself.
 *
 * Browser only: it uses `createImageBitmap` and a canvas. Calling it anywhere
 * without those returns the original, which is the correct answer rather than a
 * crash.
 */
export async function downscaleImage(
  file: File,
  { maxEdge = MAX_COVER_EDGE, quality = COVER_QUALITY }: DownscaleOptions = {},
): Promise<DownscaleResult> {
  const unchanged: DownscaleResult = { file, changed: false };

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return unchanged;
  }
  if (!file.type.startsWith("image/")) return unchanged;

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF orientation tag, so a cover photographed in
    // portrait is stored the way up it was taken rather than the way the sensor
    // happened to record it. The tag itself does not survive the re-encode,
    // which is the point.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return unchanged;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);

    // Already small in both senses: leave the librarian's own file alone.
    if (longest <= maxEdge && file.size <= LEAVE_ALONE_BYTES) return unchanged;

    const scale = Math.min(1, maxEdge / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return unchanged;

    // A cover re-encoded to JPEG has no alpha channel, so anything transparent
    // would come out black. White is what a book jacket sits on anyway.
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });

    // Bigger than what we started with happens with small, flat images. Keep
    // whichever is actually smaller.
    if (!blob || blob.size >= file.size) return unchanged;

    /*
     * There is deliberately no floor here any more.
     *
     * This used to hand back the ORIGINAL whenever its own result came out
     * under the cover floor, so it never produced a file the server would
     * refuse as too small. The cure was worse than the disease: a 4 MB
     * photograph of a plain jacket then stayed 4 MB and was refused for being
     * too big instead. A floor asked of a file this code re-encoded cannot be
     * answered honestly, so it is asked of the file that was chosen, before any
     * of this runs — see `shrinkToBand`.
     */

    const name = file.name.replace(/\.[^.]+$/, "") || "picture";
    return {
      file: new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() }),
      changed: true,
    };
  } catch {
    return unchanged;
  } finally {
    bitmap.close();
  }
}

/** `1.4 MB`, `320 KB`. For telling a librarian what just happened to their file. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
