import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatCode, looksLikeCode, squashCode } from "@/lib/codes";

/**
 * How a library card survives being typed by a human.
 *
 * The bug: a reset request matched the card only on an exact, punctuation-for-
 * punctuation, case-sensitive-prefix basis, and the reset form answers a miss
 * with "if we can recover that account, we have sent instructions". So a parent
 * who dropped the hyphen was told the mail was on its way and it never was.
 *
 * The second half of the same bug: both forms invited "the name you chose",
 * and nothing in the application has ever written a username.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

describe("a card is the card however it is typed", () => {
  const CARD = formatCode("MJCL-R", 1, 4); // MJCL-R0001

  it("ignores case, spacing and punctuation", () => {
    const squashedCard = squashCode(CARD);
    for (const written of [
      CARD.toLowerCase(),
      CARD.replace(/-/g, ""),
      CARD.replace(/-/g, " "),
      `  ${CARD}  `,
      CARD.replace("-", "_"),
    ]) {
      expect(squashCode(written), written).toBe(squashedCard);
    }
  });

  it("does not merge two different cards", () => {
    expect(squashCode(formatCode("MJCL-R", 1, 4))).not.toBe(
      squashCode(formatCode("MJCL-R", 2, 4)),
    );
    // A book's label and a reader's card must stay distinct after squashing.
    expect(squashCode(formatCode("MJCL-B", 1, 4))).not.toBe(squashCode(CARD));
  });
});

describe("whether a thing could be a card at all", () => {
  /*
   * This question is safe to answer out loud, which is the whole point of it
   * existing: it is about shape, never about existence. "Adi" is not a card
   * number whether or not Adi is a reader here.
   */
  it("accepts anything shaped like a card", () => {
    expect(looksLikeCode("MJCL-R0001")).toBe(true);
    expect(looksLikeCode("mjcl r0001")).toBe(true);
    expect(looksLikeCode("MJCLR0001")).toBe(true);
  });

  it("refuses a child's name, which is what a child types", () => {
    expect(looksLikeCode("Adi")).toBe(false);
    expect(looksLikeCode("Adi Sharma")).toBe(false);
    expect(looksLikeCode("")).toBe(false);
    // Digits alone are not it either — no prefix means no card.
    expect(looksLikeCode("0001")).toBe(false);
  });
});

describe("what the sign-in screens promise", () => {
  const LOGIN = read("app", "login", "login-form.tsx");
  const FORGOT = read("app", "forgot", "forgot-form.tsx");

  it("no longer offers a name nobody has", () => {
    for (const [name, source] of [
      ["login", LOGIN],
      ["forgot", FORGOT],
    ] as const) {
      // Comments may explain the removal; the rendered strings may not offer it.
      const rendered = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(rendered, name).not.toMatch(/name you chose/i);
    }
  });

  it("tells a librarian which identity is theirs", () => {
    expect(LOGIN).toMatch(/use your email address/i);
    expect(FORGOT).toMatch(/use your email address/i);
  });

  it("fills in the card for a reader who is already signed in", () => {
    // The route the failure came in by: pressing "Email me a reset link" on
    // your own account page, then being asked for a number you cannot see.
    const page = read("app", "forgot", "page.tsx");
    expect(page).toContain("getOwnMemberCard");
    expect(FORGOT).toContain("defaultValue={defaultIdentifier}");
  });

  it("shows the shape error rather than swallowing it", () => {
    // The reset form used to render only the success state, so a refusal from
    // the action had nowhere to appear.
    expect(FORGOT).toContain("state.fieldErrors?.identifier");
  });
});

describe("one lookup, not two", () => {
  /*
   * `auth/index.ts` and `password-service.ts` each kept a private copy of "find
   * the user this identifier means". Two copies is how signing in and asking
   * for a reset link come to disagree about who you are.
   */
  const AUTH = read("server", "auth", "index.ts");
  const PASSWORD = read("server", "services", "password-service.ts");

  it("is imported by both, and defined by neither", () => {
    for (const [name, source] of [
      ["auth", AUTH],
      ["password-service", PASSWORD],
    ] as const) {
      expect(source, name).toContain('from "@/server/lib/identity"');
      expect(source, name).not.toMatch(/async function findUserByIdentifier/);
    }
  });

  it("reads member_profile, and so cannot reach a book's label", () => {
    const identity = read("server", "lib", "identity.ts");
    expect(identity).toContain("FROM member_profile");
    expect(identity).not.toContain("book_copy");
  });
});
