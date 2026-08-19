import { describe, expect, it } from "vitest";

import { ValidationError } from "@/server/lib/errors";
import {
  MEDIA_MAY_REVALIDATE,
  UPLOAD_PURPOSES,
  UPLOAD_RULES,
  validateUpload,
} from "@/server/lib/uploads";

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

// ---------------------------------------------------------------------------
// Metadata stripping
// ---------------------------------------------------------------------------

/**
 * A JPEG carrying an APP1 EXIF segment with a GPS-looking payload.
 *
 * SOI · APP1(EXIF…) · APP0(JFIF) · COM · SOF0 · SOS · pixel data · EOI
 */
function jpegWithExif(): Uint8Array {
  const exifPayload = Buffer.from("Exif\0\0GPSLatitude 12.9716 GPSLongitude 77.5946", "latin1");
  const app1Length = exifPayload.length + 2;
  const comment = Buffer.from("shot on a phone at home", "latin1");

  return new Uint8Array([
    0xff, 0xd8,                                            // SOI
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff, ...exifPayload,
    0xff, 0xe0, 0x00, 0x08, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x00, // APP0 (JFIF)
    0xff, 0xfe, 0x00, comment.length + 2, ...comment,      // COM
    0xff, 0xc0, 0x00, 0x05, 0x08, 0x00, 0x01,              // SOF0 (structural)
    0xff, 0xda, 0x00, 0x04, 0x01, 0x00,                    // SOS
    0x11, 0x22, 0x33, 0x44,                                // "pixels"
    0xff, 0xd9,                                            // EOI
  ]);
}

/** A PNG with a tEXt chunk and an eXIf chunk between IHDR and IDAT. */
function pngWithMetadata(): Uint8Array {
  const chunk = (type: string, data: number[]) => [
    (data.length >> 24) & 0xff, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0, 0, 0, 0, // CRC placeholder — nothing under test verifies it.
  ];

  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk("tEXt", [...Buffer.from("Comment\0taken at home", "latin1")]),
    ...chunk("eXIf", [...Buffer.from("GPSLatitude 12.9716", "latin1")]),
    ...chunk("IDAT", [0x78, 0x9c, 0x01, 0x02]),
    ...chunk("IEND", []),
  ]);
}

function asLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

describe("stripping embedded metadata", () => {
  it("removes EXIF and GPS coordinates from a JPEG", () => {
    const original = jpegWithExif();
    expect(asLatin1(original)).toContain("GPSLatitude");

    const result = validateUpload({ bytes: original, purpose: UPLOAD_PURPOSES.CHILD_PHOTO });

    // A phone photograph of a child usually carries the coordinates of their
    // home. None of it is needed to run a library.
    const stored = asLatin1(result.bytes);
    expect(stored).not.toContain("GPSLatitude");
    expect(stored).not.toContain("GPSLongitude");
    expect(stored).not.toContain("Exif");
    expect(stored).not.toContain("shot on a phone at home");
  });

  it("keeps the JPEG renderable: structure and pixel data survive", () => {
    const result = validateUpload({ bytes: jpegWithExif(), purpose: UPLOAD_PURPOSES.CHILD_PHOTO });
    const bytes = result.bytes;

    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);                       // SOI
    expect([bytes.at(-2), bytes.at(-1)]).toEqual([0xff, 0xd9]);               // EOI
    // The frame header is structural and must not be dropped with the metadata.
    expect(asLatin1(bytes)).toContain("\xff\xc0");
    // Everything from Start of Scan onwards is copied through untouched.
    expect(asLatin1(bytes)).toContain("\x11\x22\x33\x44");
  });

  it("removes text and eXIf chunks from a PNG but keeps the image chunks", () => {
    const original = pngWithMetadata();
    expect(asLatin1(original)).toContain("taken at home");

    const result = validateUpload({ bytes: original, purpose: UPLOAD_PURPOSES.CHILD_PHOTO });
    const stored = asLatin1(result.bytes);

    expect(stored).not.toContain("taken at home");
    expect(stored).not.toContain("GPSLatitude");
    expect(stored).not.toContain("eXIf");
    expect(stored).toContain("IHDR");
    expect(stored).toContain("IDAT");
    expect(stored).toContain("IEND");
  });

  it("reports the size and checksum of what is stored, not what was uploaded", () => {
    const original = jpegWithExif();
    const result = validateUpload({ bytes: original, purpose: UPLOAD_PURPOSES.CHILD_PHOTO });

    // Recording the original's size would misdescribe the object in storage.
    expect(result.byteSize).toBe(result.bytes.byteLength);
    expect(result.byteSize).toBeLessThan(original.byteLength);
  });

  it("leaves a file with nothing to strip byte-identical", () => {
    const clean = png();
    const result = validateUpload({ bytes: clean, purpose: UPLOAD_PURPOSES.BOOK_COVER });

    expect(Buffer.from(result.bytes).equals(Buffer.from(clean))).toBe(true);
  });
});

describe("what a browser may keep", () => {
  /*
   * This is a caching list, and the only thing that makes it safe is what is
   * NOT on it. `/api/media/[id]` runs its full authorization check on every
   * request either way — `no-cache` forces the browser to ask before reusing
   * anything it holds — so a purpose on this list only ever saves re-sending
   * bytes whose answer has not changed.
   *
   * A child's photograph must never appear here. It keeps `no-store`, which is
   * what stops it being written to a shared family device's disk at all.
   */
  it("never lets a child's photograph be kept by a browser", () => {
    expect(MEDIA_MAY_REVALIDATE.has(UPLOAD_PURPOSES.CHILD_PHOTO)).toBe(false);
  });

  it("lets a book jacket and a library logo be revalidated", () => {
    expect(MEDIA_MAY_REVALIDATE.has(UPLOAD_PURPOSES.BOOK_COVER)).toBe(true);
    expect(MEDIA_MAY_REVALIDATE.has(UPLOAD_PURPOSES.BRANDING)).toBe(true);
  });

  it("holds nothing but purposes this application defines", () => {
    const known = new Set<string>(Object.values(UPLOAD_PURPOSES));
    for (const purpose of MEDIA_MAY_REVALIDATE) {
      expect(known.has(purpose)).toBe(true);
    }
  });
});
