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
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real `server-only` package throws unless resolved with the
      // "react-server" condition, which Vitest does not set.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
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
