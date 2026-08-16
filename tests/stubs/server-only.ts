/**
 * Stub for the `server-only` package under Vitest.
 *
 * The real package throws unless it is resolved with the "react-server"
 * condition, which the test runner does not set. Aliasing it here lets us keep
 * the import in production code — where it does its actual job of preventing a
 * server module from being pulled into a client bundle — while still being able
 * to unit test those modules.
 */
export {};
