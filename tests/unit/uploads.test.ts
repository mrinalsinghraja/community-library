import { describe, expect, it } from "vitest";

import { ValidationError } from "@/server/lib/errors";
import { UPLOAD_PURPOSES, UPLOAD_RULES, validateUpload } from "@/server/lib/uploads";

/**
 * Errors carry two messages: a technical one for the log and a friendly one for
 * the person. These helpers assert on the right one, which is itself a check
 * that the separation exists.
 */
function friendlyFileError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fieldErrors.file ?? "";
    throw error;
  }
  throw new Error("Expected the upload to be rejected, but it was accepted");
}

function technicalError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the upload to be rejected, but it was accepted");
}

/** Minimal byte sequences with the right magic numbers. */
function jpeg(sizeBytes = 64): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function png(sizeBytes = 64): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

describe("upload validation", () => {
  it("accepts a real JPEG for a child photo", () => {
    const result = validateUpload({ bytes: jpeg(), purpose: UPLOAD_PURPOSES.CHILD_PHOTO });

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.visibility).toBe("PRIVATE");
  });

  it("keeps every child photo private", () => {
    // The single most important line in this file.
    expect(UPLOAD_RULES[UPLOAD_PURPOSES.CHILD_PHOTO].visibility).toBe("PRIVATE");
  });

  it("rejects an executable renamed to .jpg", () => {
    // The classic attack: trust the extension, serve the file, get a shell.
    const elf = new Uint8Array(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46], 0);

    const run = () =>
      validateUpload({
        bytes: elf,
        purpose: UPLOAD_PURPOSES.CHILD_PHOTO,
        declaredMimeType: "image/jpeg",
        originalFilename: "innocent.jpg",
      });

    expect(friendlyFileError(run)).toMatch(/cannot be uploaded/i);
    // The log gets the detail; the uploader does not.
    expect(technicalError(run)).toMatch(/ELF binary/);
  });

  it("rejects a shell script and a zip archive", () => {
    const script = new Uint8Array([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e]);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

    expect(() => validateUpload({ bytes: script, purpose: UPLOAD_PURPOSES.BOOK_COVER })).toThrow();
    expect(() => validateUpload({ bytes: zip, purpose: UPLOAD_PURPOSES.BOOK_COVER })).toThrow();
  });

  it("ignores a lying Content-Type header", () => {
    // Declared image/png, actually a JPEG: we believe the bytes.
    const result = validateUpload({
      bytes: jpeg(),
      purpose: UPLOAD_PURPOSES.BOOK_COVER,
      declaredMimeType: "image/png",
    });

    expect(result.mimeType).toBe("image/jpeg");
  });

  it("rejects a file with no recognisable image signature", () => {
    const text = new TextEncoder().encode("this is just some text, honestly");

    expect(
      friendlyFileError(() => validateUpload({ bytes: text, purpose: UPLOAD_PURPOSES.BOOK_COVER })),
    ).toMatch(/does not look like a picture/i);
  });

  it("rejects an empty file", () => {
    expect(
      friendlyFileError(() =>
        validateUpload({ bytes: new Uint8Array(0), purpose: UPLOAD_PURPOSES.BOOK_COVER }),
      ),
    ).toMatch(/empty/i);
  });

  it("enforces the size limit with a friendly message", () => {
    const oversized = png(UPLOAD_RULES[UPLOAD_PURPOSES.CHILD_PHOTO].maxBytes + 1);

    expect(
      friendlyFileError(() =>
        validateUpload({ bytes: oversized, purpose: UPLOAD_PURPOSES.CHILD_PHOTO }),
      ),
    ).toMatch(/under 5 MB/i);
  });

  it("refuses SVG for anything a parent can upload", () => {
    // SVG can carry script. It is permitted only for branding, which is a
    // Super Admin action.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    expect(() => validateUpload({ bytes: svg, purpose: UPLOAD_PURPOSES.CHILD_PHOTO })).toThrow();
    expect(() => validateUpload({ bytes: svg, purpose: UPLOAD_PURPOSES.BOOK_COVER })).toThrow();
    expect(validateUpload({ bytes: svg, purpose: UPLOAD_PURPOSES.BRANDING }).mimeType).toBe(
      "image/svg+xml",
    );
  });

  it("never puts the user's filename in the storage key", () => {
    const result = validateUpload({
      bytes: png(),
      purpose: UPLOAD_PURPOSES.CHILD_PHOTO,
      originalFilename: "../../../etc/passwd.png",
    });

    expect(result.storageKey).not.toContain("passwd");
    expect(result.storageKey).not.toContain("..");
    expect(result.storageKey).toMatch(/^child_photo\/\d{4}\/\d{1,2}\/[A-Za-z0-9_-]+\.png$/);
  });

  it("gives two identical uploads different storage keys", () => {
    const a = validateUpload({ bytes: png(), purpose: UPLOAD_PURPOSES.BOOK_COVER });
    const b = validateUpload({ bytes: png(), purpose: UPLOAD_PURPOSES.BOOK_COVER });

    expect(a.storageKey).not.toBe(b.storageKey);
    // ...but the same content still hashes the same, for de-duplication.
    expect(a.checksumSha256).toBe(b.checksumSha256);
  });
});
