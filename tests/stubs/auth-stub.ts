import { vi } from "vitest";

/**
 * Test stand-in for `@/server/auth`.
 *
 * The real module imports next-auth, which pulls in `next/server` — a module
 * that only resolves inside a Next.js build. Aliasing it here (see
 * vitest.config.mts) lets the service layer be tested for real.
 *
 * What is replaced is deliberately tiny: only the boundary that reads the
 * cookie. Everything that matters — resolving the handle against the session
 * table, checking account status, computing permissions from the database — is
 * the real code under test.
 */

let currentSessionHandle: string | null = null;

/** Signs the next service call in as the holder of this session handle. */
export function __setSessionHandle(handle: string | null): void {
  currentSessionHandle = handle;
}

export async function auth(): Promise<{ sessionHandle: string } | null> {
  return currentSessionHandle ? { sessionHandle: currentSessionHandle } : null;
}

export const signIn = vi.fn();
export const signOut = vi.fn();
export const handlers = {};
export const GENERIC_LOGIN_FAILURE = "That didn't work. Check the spelling and try again.";
