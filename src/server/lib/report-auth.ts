import "server-only";

import { createHmac } from "node:crypto";

import { env } from "@/server/env";
import { safeEqual } from "@/server/lib/crypto";

/**
 * The password gate for /report (ADR-077).
 *
 * One shared password, set in the environment, so there is no account to create
 * and nothing in the database to leak. The password is never compared directly:
 * both sides are keyed hashes of fixed length, compared in constant time.
 *
 * The cookie is a signed expiry, bound to the current password — change the
 * password and every open session ends at once.
 */

export const REPORT_COOKIE = "library.report";
export const REPORT_PATH = "/report";
export const REPORT_SESSION_HOURS = 8;
const MIN_LENGTH = 8;

function mac(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`report|${value}`, "utf8").digest("hex");
}

function configuredPassword(): string | null {
  const password = env.REPORT_PASSWORD;
  return password && password.length >= MIN_LENGTH ? password : null;
}

/** False means the page is closed to everybody. */
export function reportIsConfigured(): boolean {
  return configuredPassword() !== null;
}

export function passwordMatches(candidate: string): boolean {
  const expected = configuredPassword();
  if (!expected) return false;
  return safeEqual(mac(`pw|${candidate}`), mac(`pw|${expected}`));
}

export function issueReportToken(now = Date.now()): string | null {
  const expected = configuredPassword();
  if (!expected) return null;
  const expires = String(now + REPORT_SESSION_HOURS * 3_600_000);
  return `${expires}.${mac(`tok|${expires}|${expected}`)}`;
}

export function reportTokenIsValid(token: string | undefined, now = Date.now()): boolean {
  const expected = configuredPassword();
  if (!expected || !token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < now) return false;
  return safeEqual(signature, mac(`tok|${expires}|${expected}`));
}
