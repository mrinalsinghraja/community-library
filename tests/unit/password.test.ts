import { describe, expect, it } from "vitest";

import {
  PASSWORD_POLICY,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from "@/server/lib/password";

describe("member password policy", () => {
  it("accepts a short, memorable secret word", () => {
    // Six characters, no complexity rules. A five-year-old has to be able to
    // type this on a tablet. See ADR-006 for why this is a deliberate choice.
    expect(checkPasswordPolicy("dragon7", "member").ok).toBe(true);
    expect(checkPasswordPolicy("bluecat", "member").ok).toBe(true);
  });

  it("rejects something too short, kindly", () => {
    const result = checkPasswordPolicy("cat", "member");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/longer/i);
    // The message must read as encouragement, not as a rule violation.
    expect(result.message).not.toMatch(/invalid|error|must contain/i);
  });

  it("rejects the passwords everyone guesses first", () => {
    for (const guess of ["password", "123456", "qwerty", "letmein", "library"]) {
      expect(checkPasswordPolicy(guess, "member").ok, `${guess} should be blocked`).toBe(false);
    }
  });

  it("blocks common passwords regardless of case", () => {
    expect(checkPasswordPolicy("PassWord", "member").ok).toBe(false);
  });

  it("does not demand capitals, digits or symbols", () => {
    // Complexity rules do not make a child's password stronger; they make it
    // written on a note stuck to the shelf.
    expect(checkPasswordPolicy("elephants", "member").ok).toBe(true);
  });
});

describe("library-specific forbidden words", () => {
  const options = { forbiddenWords: ["Mana Jardin", "Mana Jardin Children's Library"] };

  it("refuses the library's own name, which is what everyone tries first", () => {
    expect(checkPasswordPolicy("manajardin", "member", options).ok).toBe(false);
    expect(checkPasswordPolicy("ManaJardin2026", "member", options).ok).toBe(false);
  });

  it("ignores punctuation and spacing when matching", () => {
    expect(checkPasswordPolicy("mana-jardin!", "member", options).ok).toBe(false);
  });

  it("accepts an unrelated word", () => {
    expect(checkPasswordPolicy("pineapple", "member", options).ok).toBe(true);
  });

  it("does not fire on very short configured words", () => {
    // A three-letter community name must not ban every password containing it.
    expect(checkPasswordPolicy("bluecat", "member", { forbiddenWords: ["cat"] }).ok).toBe(true);
  });

  it("needs no configuration to work at all", () => {
    // The static blocklist is community-agnostic; this is purely additive.
    expect(checkPasswordPolicy("manajardin", "member").ok).toBe(true);
  });
});

describe("staff password policy", () => {
  it("requires a genuinely long password", () => {
    expect(checkPasswordPolicy("short1!A", "staff").ok).toBe(false);
    expect(PASSWORD_POLICY.staff.minLength).toBeGreaterThanOrEqual(12);
  });

  it("rejects a long but predictable password", () => {
    const result = checkPasswordPolicy("Password1234", "staff");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/guess/i);
  });

  it("accepts a strong passphrase", () => {
    expect(checkPasswordPolicy("thimble-otter-cascade-97", "staff").ok).toBe(true);
  });

  it("holds staff to a higher bar than members", () => {
    // The same password: fine for a child, refused for someone with
    // administrative power over children's data.
    const childSafe = "dragon7";
    expect(checkPasswordPolicy(childSafe, "member").ok).toBe(true);
    expect(checkPasswordPolicy(childSafe, "staff").ok).toBe(false);
  });
});

describe("password hashing", () => {
  it("produces an argon2id hash, never the password itself", async () => {
    const hash = await hashPassword("thimble-otter-cascade-97");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("thimble");
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [first, second] = await Promise.all([
      hashPassword("thimble-otter-cascade-97"),
      hashPassword("thimble-otter-cascade-97"),
    ]);

    expect(first).not.toBe(second);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("thimble-otter-cascade-97");

    expect(await verifyPassword(hash, "thimble-otter-cascade-97")).toBe(true);
    expect(await verifyPassword(hash, "thimble-otter-cascade-98")).toBe(false);
  });

  it("treats a corrupted hash as a failed login rather than an exception", async () => {
    // A damaged row must read as "wrong password", not as a 500 that tells an
    // attacker something interesting about the account.
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });
});
