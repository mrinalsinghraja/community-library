import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Two projects, deliberately separated:
 *
 *   unit      — pure logic. No database, no network. Runs everywhere, fast, and
 *               is what `npm test` and the default CI job execute.
 *   database  — real PostgreSQL. These are the tests that prove the *database*
 *               enforces what we claim: the double-issue guard, unique codes,
 *               check constraints, session revocation. Mocking those would test
 *               nothing at all, so they need TEST_DATABASE_URL and are skipped
 *               with a clear message when it is absent.
 */
export default defineConfig({
  resolve: {
    /*
     * ORDER MATTERS. Vite turns this object into an ordered list and takes the
     * first prefix that matches, so the specific "@/server/auth" entry has to
     * come before the general "@" entry — otherwise "@" wins and the stub is
     * never used.
     */
    alias: [
      /*
       * Anchored regex, not a string prefix: a string "@/server/auth" would
       * also swallow "@/server/auth/session-store", which is real code we very
       * much want to test.
       *
       * next-auth imports `next/server`, which only resolves inside a Next.js
       * build. Replacing just the cookie-reading boundary lets the real
       * services, authorization checks and session store run for real.
       */
      {
        find: /^@\/server\/auth$/,
        replacement: fileURLToPath(new URL("./tests/stubs/auth-stub.ts", import.meta.url)),
      },
      {
        // The real `server-only` package throws unless resolved with the
        // "react-server" condition, which Vitest does not set.
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/setup-env.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "database",
          environment: "node",
          include: ["tests/database/**/*.test.ts"],
          setupFiles: ["tests/database/setup.ts"],
          // Schema-level tests share one database; running files in parallel
          // would let one test's cleanup delete another's fixtures.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/server/env.ts", "src/server/db.ts"],
    },
  },
});
