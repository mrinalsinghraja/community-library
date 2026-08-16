import "server-only";

import { hash as argon2Hash, verify as argon2Verify, type Algorithm } from "@node-rs/argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";

import { COMMON_PASSWORDS } from "@/lib/common-passwords";

/**
 * Password hashing and policy.
 *
 * Two different policies, deliberately:
 *
 *   Staff  — adults with real administrative power over children's data.
 *            12 characters minimum, strength-checked.
 *   Member — children aged 5 to 14. 6 characters, no character-class rules.
 *
 * The member policy is weaker than an adult standard on purpose. Complexity
 * rules do not make a six-year-old's password stronger; they make it written on
 * a sticky note on the shelf. The compensating controls are strict lockout,
 * short sessions on shared devices, and the fact that the data behind a member
 * account is a picture-book borrowing history. This trade-off was approved by
 * the library owner and is recorded in docs/ARCHITECTURE_DECISIONS.md (ADR-006).
 */

/**
 * Argon2id. The enum from @node-rs/argon2 is an ambient `const enum`, which
 * cannot be referenced under isolatedModules, so the value is written directly
 * and pinned by the test that asserts hashes start with `$argon2id$`.
 */
const ARGON2ID: Algorithm = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // 19 MiB — OWASP minimum recommendation for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

/** zxcvbn scores 0-4. 3 means "safely unguessable without a slow hash". */
const STAFF_MIN_STRENGTH_SCORE = 3;

const strengthEstimator = new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });

function zxcvbnScore(password: string): number {
  // The estimator is superlinear on very long inputs; the policy caps length
  // anyway, so truncate before scoring rather than doing avoidable work.
  return strengthEstimator.check(password.slice(0, 128)).score;
}

export const PASSWORD_POLICY = {
  member: { minLength: 6, maxLength: 128, label: "secret word" },
  staff: { minLength: 12, maxLength: 128, label: "password" },
} as const;

export type PasswordAudience = keyof typeof PASSWORD_POLICY;

export interface PasswordCheckResult {
  ok: boolean;
  /** Child-safe, already-friendly message. Safe to render directly. */
  message?: string;
}

/**
 * Validates a proposed password. Returns a friendly message rather than a list
 * of rules, because a list of rules is unreadable to the youngest members.
 */
export interface PasswordPolicyOptions {
  /**
   * Extra words this particular library should refuse — typically its own name
   * and its community's name, read from settings. Kept out of the static
   * blocklist so that file stays community-agnostic.
   */
  forbiddenWords?: readonly string[];
}

export function checkPasswordPolicy(
  password: string,
  audience: PasswordAudience,
  options: PasswordPolicyOptions = {},
): PasswordCheckResult {
  const policy = PASSWORD_POLICY[audience];

  if (password.length < policy.minLength) {
    return {
      ok: false,
      message:
        audience === "member"
          ? `Make your secret word a bit longer — at least ${policy.minLength} letters.`
          : `Use at least ${policy.minLength} characters.`,
    };
  }

  if (password.length > policy.maxLength) {
    return { ok: false, message: `That is too long — keep it under ${policy.maxLength} characters.` };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      message:
        audience === "member"
          ? "Lots of people pick that one! Choose something only you would think of."
          : "That password is too common. Choose something less guessable.",
    };
  }

  // The library's own name is the first thing anyone tries.
  const normalised = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const word of options.forbiddenWords ?? []) {
    const normalisedWord = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalisedWord.length >= 4 && normalised.includes(normalisedWord)) {
      return {
        ok: false,
        message:
          audience === "member"
            ? "Everyone would guess that one! Pick something that is just yours."
            : "Avoid using the library or community name in your password.",
      };
    }
  }

  // Staff hold real power over children's data, so they get a real strength bar
  // rather than character-class theatre. zxcvbn scores 0-4; we require 3.
  if (audience === "staff" && zxcvbnScore(password) < STAFF_MIN_STRENGTH_SCORE) {
    return {
      ok: false,
      message:
        "That password is too easy to guess. A few unrelated words strung together works well.",
    };
  }

  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password. Never throws on a malformed hash — a corrupted record
 * must read as "wrong password", not as a 500 that reveals account internals.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification, for logins against an
 * account that does not exist. Without this, response timing tells an attacker
 * which member codes are real.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await argon2Hash("timing-equalisation-placeholder", ARGON2_OPTIONS);
}
