import { config as loadDotenv } from "dotenv";

/**
 * Database test bootstrap.
 *
 * These tests run against a real PostgreSQL instance because what they assert —
 * partial unique indexes, CHECK constraints, transactional behaviour — exists
 * only in the database. A mock would assert that our mock works.
 *
 * TEST_DATABASE_URL must point at a database that is safe to write to. It is
 * kept separate from DATABASE_URL so that a stray `npm run test:db` cannot
 * touch development, let alone production, data.
 */
loadDotenv({ path: ".env", quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    [
      "",
      "TEST_DATABASE_URL is not set, so the database tests cannot run.",
      "",
      "  Local:  createdb library_test",
      "          TEST_DATABASE_URL=postgresql://localhost:5432/library_test npm run test:db",
      "",
      "  CI:     provided by the postgres service container (see .github/workflows/ci.yml)",
      "",
      "These tests are excluded from `npm test` for exactly this reason.",
      "",
    ].join("\n"),
  );
}

// Prisma reads DATABASE_URL; point it at the test database for this process only.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-only-secret-value-that-is-long-enough-32";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.EMAIL_PROVIDER ??= "console";
