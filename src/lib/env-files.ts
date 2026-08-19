/**
 * Which `.env` files a Next.js command will read — and which of them a local
 * command must never read.
 *
 * This exists because of a real incident. A production build was run on a
 * laptop that still had a `vercel env pull` file lying about, and Next.js did
 * exactly what it documents: `next build` sets NODE_ENV=production, so it
 * loaded `.env.production.local` and the local command spoke to the production
 * database. Nothing was corrupted, but nothing stopped it either.
 *
 * The rule this file encodes is one sentence: **a file whose name is only ever
 * loaded in production mode has no business sitting in a working copy.** A
 * pulled production environment belongs under a name Next.js never looks for
 * (see `SAFE_PULL_FILENAME`), so that forgetting to delete it is harmless
 * rather than dangerous.
 *
 * Kept free of imports and side effects so the build guard and the tests can
 * both use it.
 */

/** Where `vercel env pull` output should be written instead. Next never reads it. */
export const SAFE_PULL_FILENAME = ".env.vercel-production";

/**
 * The files Next.js loads for a mode, most specific first — mirroring
 * `@next/env`. Test mode deliberately skips the `.local` files so that a
 * developer's own overrides cannot change what the test suite sees.
 */
export function envFilesFor(nodeEnv: string): string[] {
  const mode = nodeEnv === "production" || nodeEnv === "test" ? nodeEnv : "development";

  return mode === "test"
    ? [".env.test", ".env"]
    : [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"];
}

/** Files that carry production configuration by name alone. */
export const PRODUCTION_ONLY_ENV_FILES = [".env.production.local", ".env.production"] as const;

export interface LocalEnvCheck {
  /** `process.env.NODE_ENV` as the command about to run will see it. */
  nodeEnv: string;
  /** True when running on Vercel, where these files are the platform's job. */
  onVercel: boolean;
  /** Which of `PRODUCTION_ONLY_ENV_FILES` exist in the working copy. */
  present: readonly string[];
}

/**
 * The production-only files this command would silently consume.
 *
 * Empty means the command is safe to run. Non-empty means a local build or
 * start would pick up production configuration, and the caller should refuse.
 */
export function productionEnvFilesInPlay({ nodeEnv, onVercel, present }: LocalEnvCheck): string[] {
  if (onVercel) return [];
  if (nodeEnv !== "production") return [];

  const willLoad = new Set(envFilesFor(nodeEnv));
  return present.filter((file) => willLoad.has(file));
}
