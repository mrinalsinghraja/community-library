import { describe, expect, it } from "vitest";

import { MAX_COVER_EDGE, downscaleImage, formatBytes } from "@/lib/image-downscale";

/**
 * Shrinking a cover before upload.
 *
 * The property that matters here is not the resizing arithmetic — a browser
 * does that, and there is no canvas in this environment to exercise it. It is
 * the guarantee wrapped around it: **this can never stop a book being
 * catalogued.** A librarian standing at a desk with a queue must get their
 * cover uploaded whatever the browser can or cannot do, and the server's
 * validation is what actually protects the library either way.
 *
 * So these tests run in exactly the situation the guard exists for: no
 * `createImageBitmap`, no `document`. Every path must hand back the original
 * file rather than throw.
 */

function fakeFile(name: string, type: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("downscaleImage", () => {
  it("returns the original file when the browser cannot decode images", async () => {
    // Node has no createImageBitmap and no document: the same shape as an old
    // browser, a locked-down webview, or anything unexpected.
    expect(typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap).not.toBe(
      "function",
    );

    const original = fakeFile("cover.jpg", "image/jpeg", 4 * 1024 * 1024);
    const result = await downscaleImage(original);

    expect(result.changed).toBe(false);
    expect(result.file).toBe(original);
  });

  it("never throws, whatever it is handed", async () => {
    for (const file of [
      fakeFile("cover.jpg", "image/jpeg"),
      fakeFile("notes.txt", "text/plain"),
      fakeFile("empty", "", 0),
    ]) {
      await expect(downscaleImage(file)).resolves.toMatchObject({ changed: false });
    }
  });

  it("leaves anything that is not an image alone", async () => {
    const original = fakeFile("notes.txt", "text/plain");
    const result = await downscaleImage(original);

    expect(result.file).toBe(original);
  });

  it("targets an edge that covers the largest size a cover is ever shown at", () => {
    // The full-cover viewer caps at 28rem — 448 CSS pixels, so 1344 device
    // pixels on a 3x screen. Anything smaller than that would be visibly soft
    // on the one screen where a child is looking closely.
    expect(MAX_COVER_EDGE).toBeGreaterThanOrEqual(1344);
  });
});

describe("formatBytes", () => {
  it("reads the way a person would say it", () => {
    expect(formatBytes(320 * 1024)).toBe("320 KB");
    expect(formatBytes(1.4 * 1024 * 1024)).toBe("1.4 MB");
    // Never "0 KB" for a file that exists.
    expect(formatBytes(12)).toBe("1 KB");
  });
});
