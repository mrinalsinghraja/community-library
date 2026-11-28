import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

async function load(password: string | undefined) {
  vi.resetModules();
  if (password === undefined) delete process.env.REPORT_PASSWORD;
  else process.env.REPORT_PASSWORD = password;
  return import("@/server/lib/report-auth");
}

afterEach(() => {
  delete process.env.REPORT_PASSWORD;
});

describe("the report password gate", () => {
  it("is closed to everybody when no password is set", async () => {
    const auth = await load(undefined);
    expect(auth.reportIsConfigured()).toBe(false);
    expect(auth.passwordMatches("")).toBe(false);
    expect(auth.issueReportToken()).toBeNull();
  });

  it("refuses a password that is too short to be one", async () => {
    const auth = await load("short");
    expect(auth.reportIsConfigured()).toBe(false);
  });

  it("accepts only the right password", async () => {
    const auth = await load("correct-horse-9");
    expect(auth.passwordMatches("correct-horse-9")).toBe(true);
    expect(auth.passwordMatches("correct-horse-8")).toBe(false);
    expect(auth.passwordMatches("")).toBe(false);
  });

  it("issues a token that works, expires, and cannot be forged", async () => {
    const auth = await load("correct-horse-9");
    const now = Date.now();
    const token = auth.issueReportToken(now)!;
    expect(auth.reportTokenIsValid(token, now + 1000)).toBe(true);
    expect(auth.reportTokenIsValid(token, now + 9 * 3_600_000)).toBe(false);
    expect(auth.reportTokenIsValid(undefined)).toBe(false);
    expect(auth.reportTokenIsValid("9999999999999.deadbeef")).toBe(false);
    const [, sig] = token.split(".");
    expect(auth.reportTokenIsValid(`9999999999999.${sig}`, now)).toBe(false);
  });

  it("ends every session when the password changes", async () => {
    const first = await load("correct-horse-9");
    const token = first.issueReportToken()!;
    const second = await load("another-pass-77");
    expect(second.reportTokenIsValid(token)).toBe(false);
  });
});
