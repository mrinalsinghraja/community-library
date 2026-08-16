import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/server/env";

/**
 * Cryptographic helpers. Everything here delegates to Node's crypto module —
 * we never invent an algorithm, only compose established ones.
 */

/** Opaque, URL-safe random handle. 32 bytes = 256 bits of entropy. */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/**
 * Hash for token *lookup*. Tokens are already high-entropy random values, so a
 * fast hash is correct here: there is nothing to brute force. This is what makes
 * a database dump useless for session hijacking — only hashes are stored.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Keyed hash for low-entropy identifiers we must not store in the clear:
 * IP addresses, user agents, login identifiers.
 *
 * A plain SHA-256 of an IP is trivially reversible by enumerating the address
 * space, so this is an HMAC keyed with AUTH_SECRET. Rotating AUTH_SECRET
 * therefore breaks correlation with older rows — which is acceptable, since
 * these values exist only for throttling and abuse handling.
 */
export function hashIdentifier(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(value.trim().toLowerCase(), "utf8")
    .digest("hex");
}

/** Constant-time comparison for equal-length digests. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** SHA-256 of arbitrary bytes, used for upload de-duplication and integrity. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
