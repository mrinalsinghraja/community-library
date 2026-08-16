import { describe, expect, it } from "vitest";

import { redactMetadata } from "@/server/lib/audit";
import { formatCode } from "@/server/lib/codes";

describe("audit metadata redaction", () => {
  it("strips anything that looks like a credential", () => {
    const result = redactMetadata({
      action: "approved",
      password: "hunter2",
      passwordHash: "$argon2id$abc",
      token: "raw-activation-token",
      tokenHash: "deadbeef",
      apiKey: "sk-live-123",
      smtpPassword: "mail-secret",
      databaseUrl: "postgresql://user:pw@host/db",
    }) as Record<string, unknown>;

    expect(result.action).toBe("approved");
    for (const key of [
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "apiKey",
      "smtpPassword",
      "databaseUrl",
    ]) {
      expect(result[key], `${key} leaked into the audit log`).toBe("[redacted]");
    }
  });

  it("redacts nested secrets too", () => {
    const result = redactMetadata({
      request: { body: { password: "hunter2", childName: "Aarav" } },
    }) as { request: { body: Record<string, unknown> } };

    expect(result.request.body.password).toBe("[redacted]");
    expect(result.request.body.childName).toBe("Aarav");
  });

  it("matches key names regardless of case or separators", () => {
    const result = redactMetadata({
      PASSWORD: "a",
      password_hash: "b",
      "session-token": "c",
      Authorization: "d",
    }) as Record<string, unknown>;

    expect(Object.values(result)).toEqual(["[redacted]", "[redacted]", "[redacted]", "[redacted]"]);
  });

  it("keeps ordinary values intact", () => {
    const result = redactMetadata({
      count: 3,
      approved: true,
      copyCode: "LIB-0007",
      authors: ["Julia Donaldson"],
    }) as Record<string, unknown>;

    expect(result).toEqual({
      count: 3,
      approved: true,
      copyCode: "LIB-0007",
      authors: ["Julia Donaldson"],
    });
  });

  it("does not recurse forever on a deeply nested object", () => {
    let nested: Record<string, unknown> = { value: "bottom" };
    for (let depth = 0; depth < 40; depth += 1) nested = { nested };

    expect(() => redactMetadata(nested)).not.toThrow();
  });
});

describe("code formatting", () => {
  it("pads to the configured width", () => {
    expect(formatCode("LIB", 1, 4)).toBe("LIB-0001");
    expect(formatCode("LIB", 51, 4)).toBe("LIB-0051");
    expect(formatCode("LIB", 7, 3)).toBe("LIB-007");
  });

  it("does not truncate a number that outgrows the padding", () => {
    // Better a long code than a duplicate one.
    expect(formatCode("LIB", 12345, 4)).toBe("LIB-12345");
  });

  it("supports a different prefix, because the prefix is configuration", () => {
    expect(formatCode("ABCD", 1, 4)).toBe("ABCD-0001");
  });

  it("does not double up the separator when the prefix already ends in one", () => {
    // A member prefix of "LIB-R" must give LIB-R0042, matching the card printed
    // for that child — not LIB-R-0042.
    expect(formatCode("LIB-R", 42, 4)).toBe("LIB-R0042");
    expect(formatCode("LIB_", 7, 3)).toBe("LIB_007");
    expect(formatCode("LIB-", 7, 3)).toBe("LIB-007");
  });

  it("rejects nonsense input rather than producing a broken code", () => {
    expect(() => formatCode("", 1, 4)).toThrow();
    expect(() => formatCode("LIB", 0, 4)).toThrow(RangeError);
    expect(() => formatCode("LIB", -1, 4)).toThrow(RangeError);
    expect(() => formatCode("LIB", 1, 0)).toThrow(RangeError);
    expect(() => formatCode("LIB", 1, 99)).toThrow(RangeError);
  });
});
