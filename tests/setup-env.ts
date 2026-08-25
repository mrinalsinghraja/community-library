/**
 * Test environment bootstrap.
 *
 * src/server/env.ts validates configuration at import time and refuses to load
 * without it — which is the behaviour we want in production. Tests therefore
 * need values present before any module under test is imported.
 *
 * These are obviously fake. No test may rely on them meaning anything.
 */
// NODE_ENV is readonly in @types/node; assign through the record view.
(process.env as Record<string, string>).NODE_ENV ??= "test";
process.env.AUTH_SECRET ??= "test-only-secret-value-that-is-long-enough-32";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/library_test?schema=public";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.APP_TIMEZONE ??= "Asia/Kolkata";
process.env.EMAIL_PROVIDER ??= "console";
// The book helper. Obviously fake, and no test may make a real request.
process.env.GROQ_API_KEY ??= "gsk-test-only-not-a-real-key";
