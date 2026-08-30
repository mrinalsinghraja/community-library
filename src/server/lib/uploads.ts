import "server-only";

import { CHILD_PHOTO_MAX_BYTES } from "@/lib/child-photo";
import { COVER_MAX_BYTES, COVER_MIN_BYTES } from "@/lib/cover-image";
import { describeSize } from "@/lib/file-size";

import { generateToken, sha256Bytes } from "@/server/lib/crypto";
import { ValidationError } from "@/server/lib/errors";

/**
 * Upload validation.
 *
 * The threat here is not sophisticated: it is a well-meaning parent uploading a
 * 40 MB HEIC from a phone, and — far more rarely — someone renaming an
 * executable to .jpg. Both are handled the same way: never trust the filename,
 * never trust the declared MIME type, read the actual bytes.
 *
 * Storage of the validated bytes is Phase 2 work (Vercel Blob). This module is
 * the gate everything must pass through first.
 */

export const UPLOAD_PURPOSES = {
  /** A child's photograph. Always private, always behind an authorization check. */
  CHILD_PHOTO: "child_photo",
  /** A book jacket. Not personal data — but see the note on visibility below. */
  BOOK_COVER: "book_cover",
  /** Library or community logo. Public by definition. */
  BRANDING: "branding",
} as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[keyof typeof UPLOAD_PURPOSES];

export interface UploadRules {
  maxBytes: number;
  /**
   * A floor, where one is wanted. Optional, and set for exactly one purpose.
   *
   * It is a proxy for "this picture is big enough to look like something", not
   * a measure of quality — a well-compressed image can be small and sharp, and
   * this will refuse it. That trade was made deliberately for book covers,
   * where the failure it prevents is a thumbnail dragged off a search result
   * becoming the picture on the shelf for years.
   */
  minBytes?: number;
  /** Private objects are never given a public URL. */
  visibility: "PUBLIC" | "PRIVATE";
  allowedMimeTypes: readonly string[];
}

export const UPLOAD_RULES: Record<UploadPurpose, UploadRules> = {
  [UPLOAD_PURPOSES.CHILD_PHOTO]: {
    // Set in @/lib/child-photo, which explains why it has to stay below the
    // Server Action body limit rather than above it.
    maxBytes: CHILD_PHOTO_MAX_BYTES,
    visibility: "PRIVATE",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  /*
   * A book cover is PRIVATE at the storage layer, and that needs explaining,
   * because a book jacket is obviously not sensitive.
   *
   * PRIVATE here means exactly one thing: **no public URL is ever minted**. The
   * catalogue defaults to MEMBER_ONLY (`library_settings.catalogue_visibility`),
   * and a CDN URL is a way around the front door that no permission check can
   * close afterwards. Serving covers through /api/media/[id] keeps the answer
   * to "who may see the shelf?" in one place, where the setting can change it.
   *
   * The *authorization rule* for a cover is still completely different from a
   * child's photograph, and deliberately so — see getAuthorizedMedia(). Any
   * signed-in member may see any cover; a child's photograph is visible to that
   * child and to specific staff, and to nobody else. Same storage posture,
   * different question being asked.
   */
  [UPLOAD_PURPOSES.BOOK_COVER]: {
    // Both ends, and the reasoning for them, live in @/lib/cover-image — the
    // browser's downscaler reads the same numbers so it can never produce a
    // file this would refuse.
    minBytes: COVER_MIN_BYTES,
    maxBytes: COVER_MAX_BYTES,
    visibility: "PRIVATE",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  /*
   * The logo is the one image a signed-out visitor sees, and it used to be
   * stored PUBLIC so it could carry a CDN URL. Nothing ever rendered that URL —
   * every image in the application is fetched through `/api/media/[id]`, which
   * already answers a signed-out request for a logo and refuses everything
   * else — and a public object needs a *public* Blob store, whose access mode
   * is fixed at creation and would then apply to the whole store. One private
   * store holding a logo costs a function call; one public store holding a
   * child's photograph costs rather more (ADR-036).
   */
  [UPLOAD_PURPOSES.BRANDING]: {
    maxBytes: 2 * 1024 * 1024,
    visibility: "PRIVATE",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
  },
};

/**
 * Purposes whose bytes a browser may keep, subject to revalidating every time.
 *
 * `/api/media/[id]` reads this to decide whether to offer an ETag. It is a
 * caching decision, not an authorization one — the route runs the full
 * authorization check on every request either way, and `no-cache` means the
 * browser must ask before reusing anything it holds. All that changes for a
 * purpose on this list is that an unchanged answer costs an empty 304 instead
 * of the whole picture again.
 *
 * **A child's photograph is not on this list and must never be added to it.**
 * It keeps `no-store`, so it is not written to a shared family device's disk at
 * all. A book jacket and a library's logo are not personal data; a picture of a
 * child is the most sensitive thing this system holds.
 */
export const MEDIA_MAY_REVALIDATE: ReadonlySet<string> = new Set<UploadPurpose>([
  UPLOAD_PURPOSES.BOOK_COVER,
  UPLOAD_PURPOSES.BRANDING,
]);

/**
 * Magic-byte signatures. A file is what its bytes say it is, not what its
 * extension or its Content-Type header claims.
 */
const MAGIC_SIGNATURES: ReadonlyArray<{
  mimeType: string;
  test: (bytes: Uint8Array) => boolean;
}> = [
  {
    mimeType: "image/jpeg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mimeType: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mimeType: "image/gif",
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
];

/** Byte patterns that must never be accepted, whatever the extension says. */
const EXECUTABLE_SIGNATURES: ReadonlyArray<{ label: string; test: (b: Uint8Array) => boolean }> = [
  { label: "ELF binary", test: (b) => b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 },
  { label: "Windows executable", test: (b) => b[0] === 0x4d && b[1] === 0x5a },
  { label: "Mach-O binary", test: (b) => b[0] === 0xcf && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe },
  { label: "Java class", test: (b) => b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe },
  { label: "Shell script", test: (b) => b[0] === 0x23 && b[1] === 0x21 },
  { label: "Archive", test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
];

export function detectMimeFromBytes(bytes: Uint8Array): string | null {
  return MAGIC_SIGNATURES.find((sig) => sig.test(bytes))?.mimeType ?? null;
}

// ---------------------------------------------------------------------------
// Metadata stripping
// ---------------------------------------------------------------------------

/**
 * Removes embedded metadata from an image.
 *
 * A photograph taken on a phone routinely carries EXIF: the camera, the exact
 * timestamp, and very often **GPS coordinates**. For a picture of a child that
 * usually means the coordinates of their home. None of it is needed to run a
 * library, and the cheapest way to protect it is not to store it.
 *
 * This is byte surgery on the container, not re-encoding. That is deliberate:
 * re-encoding needs a native image library, degrades the picture, and turns a
 * malicious file into a decoder attack surface. Walking the container and
 * dropping metadata segments is dependency-free, lossless for the actual pixels,
 * and cannot fail open — anything it does not understand is refused by
 * `validateUpload` before it ever reaches here.
 *
 * Returns the original bytes when the format carries no metadata to remove.
 */
export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  switch (mimeType) {
    case "image/jpeg":
      return stripJpegMetadata(bytes);
    case "image/png":
      return stripPngMetadata(bytes);
    case "image/webp":
      return stripWebpMetadata(bytes);
    default:
      return bytes;
  }
}

/**
 * JPEG: keep the structural segments, drop every APPn and comment.
 *
 * EXIF lives in APP1 (`0xFFE1`), XMP also in APP1, ICC in APP2, and assorted
 * camera-maker data across the rest. Dropping APP0 too costs only the JFIF
 * density hint, which nothing here reads.
 *
 * Scanning stops at Start of Scan (`0xFFDA`): everything after it is entropy-
 * coded pixel data and must be copied through untouched.
 */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const kept: Array<[number, number]> = [];
  let offset = 2; // Past SOI.

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break; // Not a marker — refuse to guess.

    const marker = bytes[offset + 1];

    if (marker === 0xda) {
      // Start of Scan: copy the rest verbatim.
      kept.push([offset, bytes.length]);
      break;
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) break; // Malformed; bail out rather than misparse.

    const end = offset + 2 + segmentLength;
    if (end > bytes.length) break;

    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (!isAppSegment && !isComment) kept.push([offset, end]);

    offset = end;
  }

  if (kept.length === 0) return bytes;
  return concat([bytes.subarray(0, 2), ...kept.map(([from, to]) => bytes.subarray(from, to))]);
}

/**
 * PNG: keep the chunks needed to render, drop the rest.
 *
 * Text chunks (`tEXt`, `iTXt`, `zTXt`) and `eXIf` are where metadata lives.
 * Everything retained below is either critical or affects how the pixels look.
 */
const PNG_CHUNKS_TO_KEEP = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", // Critical.
  "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs", // Rendering.
]);

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]; // Signature.
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const dataLength =
      (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (dataLength < 0) break;

    const end = offset + 12 + dataLength; // length + type + data + CRC
    if (end > bytes.length) break;

    const type = String.fromCharCode(
      bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
    );

    if (PNG_CHUNKS_TO_KEEP.has(type)) parts.push(bytes.subarray(offset, end));

    offset = end;
    if (type === "IEND") break;
  }

  // If parsing found nothing but the signature, the file is not shaped as
  // expected — return it untouched rather than emit a broken image.
  return parts.length > 1 ? concat(parts) : bytes;
}

/**
 * WebP (RIFF): drop the EXIF and XMP chunks, then fix the container length.
 */
function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 12; // Past "RIFF" + size + "WEBP".

  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(
      bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
    );
    const dataLength =
      bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    if (dataLength < 0) break;

    // Chunks are padded to an even length.
    const end = offset + 8 + dataLength + (dataLength % 2);
    if (end > bytes.length) break;

    if (type !== "EXIF" && type !== "XMP ") parts.push(bytes.subarray(offset, end));

    offset = end;
  }

  if (parts.length === 0) return bytes;

  const body = concat(parts);
  const out = new Uint8Array(12 + body.byteLength);
  out.set(bytes.subarray(0, 12), 0);
  out.set(body, 12);

  // RIFF size counts everything after the size field itself.
  const riffSize = out.byteLength - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >> 24) & 0xff;

  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export interface ValidatedUpload {
  purpose: UploadPurpose;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  visibility: "PUBLIC" | "PRIVATE";
  /**
   * Opaque storage key, generated here. The user's filename is never used in a
   * path — that is how directory traversal and double-extension tricks get in.
   */
  storageKey: string;
  /**
   * The bytes to actually store: the caller's, with embedded metadata removed.
   *
   * ALWAYS store these, never the originals. `byteSize` and `checksumSha256`
   * describe this array, not the upload.
   */
  bytes: Uint8Array;
}

/**
 * Validates an upload's bytes against the rules for its purpose.
 *
 * Note on SVG: it is accepted only for branding, which is a Super Admin action.
 * SVG is an executable-ish format (it can carry script), so it must always be
 * served from a path with a restrictive Content-Security-Policy, never inlined
 * into a page. It is not accepted for anything a parent can upload.
 */
export function validateUpload(params: {
  bytes: Uint8Array;
  purpose: UploadPurpose;
  declaredMimeType?: string;
  originalFilename?: string;
}): ValidatedUpload {
  const { bytes, purpose } = params;
  const rules = UPLOAD_RULES[purpose];

  if (bytes.byteLength === 0) {
    throw new ValidationError({ file: "That file looks empty." });
  }

  if (bytes.byteLength > rules.maxBytes) {
    throw new ValidationError({
      file: `That picture is a bit big. Please choose one under ${describeSize(rules.maxBytes)}.`,
    });
  }

  const header = bytes.subarray(0, 16);

  for (const signature of EXECUTABLE_SIGNATURES) {
    if (signature.test(header)) {
      throw new ValidationError(
        { file: "That file type cannot be uploaded." },
        `Rejected upload: bytes match ${signature.label}`,
      );
    }
  }

  const isSvg = rules.allowedMimeTypes.includes("image/svg+xml") && looksLikeSvg(bytes);
  const detectedMime = isSvg ? "image/svg+xml" : detectMimeFromBytes(header);

  if (!detectedMime) {
    throw new ValidationError(
      { file: "That does not look like a picture. Please choose a JPG or PNG." },
      "Upload rejected: no recognised image signature",
    );
  }

  /*
   * The floor comes after the type checks, not before them.
   *
   * A 200-byte text file is not a small picture, it is not a picture — and
   * telling somebody their picture is "too small" about a file that was never
   * an image sends them looking for a bigger version of the wrong thing.
   *
   * Said with the actual size, because "too small" without a number leaves a
   * person guessing at a rule they cannot see.
   */
  if (rules.minBytes && bytes.byteLength < rules.minBytes) {
    throw new ValidationError({
      file:
        `That picture is only ${describeSize(bytes.byteLength)}, which is usually too small to ` +
        `print or read on a phone. Please choose one over ${describeSize(rules.minBytes)}.`,
    });
  }

  if (!rules.allowedMimeTypes.includes(detectedMime)) {
    throw new ValidationError(
      { file: "Please choose a JPG, PNG or WebP picture." },
      `Upload rejected: ${detectedMime} not allowed for purpose ${purpose}`,
    );
  }

  // Everything below describes what will be STORED, which is not what was
  // uploaded: a phone photograph arrives carrying EXIF, and very often the GPS
  // coordinates of the child's home. Size and checksum are computed after.
  const cleaned = stripImageMetadata(bytes, detectedMime);

  return {
    purpose,
    mimeType: detectedMime,
    byteSize: cleaned.byteLength,
    checksumSha256: sha256Bytes(cleaned),
    visibility: rules.visibility,
    storageKey: buildStorageKey(purpose, detectedMime),
    bytes: cleaned,
  };
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

/** `child_photo/2026/8/<random>.jpg` — no user-supplied component anywhere. */
function buildStorageKey(purpose: UploadPurpose, mimeType: string): string {
  const now = new Date();
  const extension = EXTENSION_BY_MIME[mimeType] ?? "bin";
  return `${purpose}/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${generateToken(16)}.${extension}`;
}
