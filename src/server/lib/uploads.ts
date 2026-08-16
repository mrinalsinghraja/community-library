import "server-only";

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
  /** A book jacket. Public — it is a picture of a book, not of a child. */
  BOOK_COVER: "book_cover",
  /** Library or community logo. Public by definition. */
  BRANDING: "branding",
} as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[keyof typeof UPLOAD_PURPOSES];

export interface UploadRules {
  maxBytes: number;
  /** Private objects are never given a public URL. */
  visibility: "PUBLIC" | "PRIVATE";
  allowedMimeTypes: readonly string[];
}

export const UPLOAD_RULES: Record<UploadPurpose, UploadRules> = {
  [UPLOAD_PURPOSES.CHILD_PHOTO]: {
    maxBytes: 5 * 1024 * 1024,
    visibility: "PRIVATE",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  [UPLOAD_PURPOSES.BOOK_COVER]: {
    maxBytes: 5 * 1024 * 1024,
    visibility: "PUBLIC",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  [UPLOAD_PURPOSES.BRANDING]: {
    maxBytes: 2 * 1024 * 1024,
    visibility: "PUBLIC",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
  },
};

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
    const limitMb = Math.round(rules.maxBytes / (1024 * 1024));
    throw new ValidationError({
      file: `That picture is a bit big. Please choose one under ${limitMb} MB.`,
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

  if (!rules.allowedMimeTypes.includes(detectedMime)) {
    throw new ValidationError(
      { file: "Please choose a JPG, PNG or WebP picture." },
      `Upload rejected: ${detectedMime} not allowed for purpose ${purpose}`,
    );
  }

  return {
    purpose,
    mimeType: detectedMime,
    byteSize: bytes.byteLength,
    checksumSha256: sha256Bytes(bytes),
    visibility: rules.visibility,
    storageKey: buildStorageKey(purpose, detectedMime),
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
