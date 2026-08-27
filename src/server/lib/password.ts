import "server-only";

import { createHash } from "node:crypto";

import { hash as argon2Hash, verify as argon2Verify, type Algorithm } from "@node-rs/argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";

import { COMMON_PASSWORDS } from "@/lib/common-passwords";
import { env } from "@/server/env";

/**
 * Password hashing and policy.
 *
 * Two different policies, deliberately:
 *
 *   Staff  — adults with real administrative power over children's data.
 *            12 characters minimum, strength-checked.
 *   Member — children aged 5 to 16. 8 characters, no character-class rules.
 *
 * The member policy is weaker than an adult standard on purpose. Complexity
 * rules do not make a child's password stronger; they make it written on a
 * sticky note on the shelf. What we ask for instead is length, which children
 * manage well. The compensating controls are strict lockout, short sessions on
 * shared devices, argon2id, and the fact that the data behind a member account
 * is a picture-book borrowing history.
 *
 * See ADR-006 (the original decision) and ADR-013 (the Phase 1 revision from
 * 6 characters to 8) in docs/ARCHITECTURE_DECISIONS.md.
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

/**
 * PHASE 1 REVISION — member minimum raised from 6 to 8 characters.
 *
 * Phase 0 chose 6. Reviewing it properly (Phase 1 brief §16), 6 is too few:
 * lowercase-only at 6 characters is about 3×10⁸ candidates. Argon2id at 19 MiB
 * makes that expensive rather than trivial, but it is within reach if the
 * database is ever taken, and a child's password is often reused elsewhere.
 *
 * 8 characters raises that to roughly 2×10¹¹ — a thousandfold — while staying
 * completely typable for a five-year-old, because we still impose NO complexity
 * rules. "bluecat7", "dragonfly", "my dog rex" all pass. What we ask for is
 * *length*, which children manage well, rather than symbols and mixed case,
 * which they do not.
 *
 * The compensating controls are unchanged and still carry most of the weight:
 * lockout after 5 attempts, a per-IP cap, argon2id, and the fact that the data
 * behind a member account is a picture-book borrowing history.
 */
/*
 * No `label` any more. This carried one per audience — "secret word" for a
 * member, "password" for staff — so the same field had two names depending on
 * who was reading it. One word now, and the word is the one every browser,
 * keyboard and reset email already uses. See ADR-064.
 */
export const PASSWORD_POLICY = {
  member: { minLength: 8, maxLength: 128 },
  staff: { minLength: 12, maxLength: 128 },
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

  /**
   * The person's own details — display name, username, member code. A child
   * whose password is their own name has not really chosen a password, and this
   * is the single most common thing they try.
   */
  personalDetails?: readonly (string | null | undefined)[];
}

function normaliseForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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
          ? `Make your password a bit longer — at least ${policy.minLength} letters.`
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

  const normalised = normaliseForComparison(password);

  /*
   * Your own name is not a password.
   *
   * Each detail is split into words and each word checked separately: a child
   * given "Rosalind Chen" will use "rosalind", not "rosalindchen", so matching
   * only the whole string would catch nobody.
   */
  const personalWords = (options.personalDetails ?? [])
    .filter((detail): detail is string => Boolean(detail))
    .flatMap((detail) => [detail, ...detail.split(/[\s\-_]+/)])
    .map(normaliseForComparison)
    .filter((word) => word.length >= 4);

  for (const word of personalWords) {
    if (normalised.includes(word)) {
      return {
        ok: false,
        message:
          audience === "member"
            ? "That has your own name in it — someone could guess it. Try something else!"
            : "Do not use your name or email address in your password.",
      };
    }
  }

  // The library's own name is the first thing anyone tries.
  for (const word of options.forbiddenWords ?? []) {
    const normalisedWord = normaliseForComparison(word);
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

/**
 * Optional check against Have I Been Pwned's breached-password corpus.
 *
 * Uses k-anonymity: only the first five characters of the SHA-1 hash leave this
 * server, and the response is a list of suffixes we match locally. The password
 * itself never goes anywhere. That property is why this is acceptable to use on
 * a flow that involves children at all.
 *
 * Two deliberate choices:
 *   • Off unless PASSWORD_BREACH_CHECK=true. It makes an outbound request from a
 *     child-facing form, and a community library should get to decide whether it
 *     wants that.
 *   • Fails OPEN, with a short timeout. If the service is slow or down, a family
 *     must still be able to finish setting up an account. A breach check is a
 *     nice-to-have; being able to join the library is not.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  if (!env.PASSWORD_BREACH_CHECK) return false;

  try {
    const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;

    const body = await response.text();
    return body
      .split("\n")
      .some((line) => {
        const [candidate, count] = line.trim().split(":");
        return candidate === suffix && Number(count) > 0;
      });
  } catch {
    // Fail open, deliberately. See above.
    return false;
  }
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
