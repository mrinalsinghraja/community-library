import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLOSED_STATUSES,
  CLOSURE_KINDS,
  LIFECYCLE_MESSAGES,
  LOGIN_ALLOWED_STATUSES,
  TOKEN_ALLOWED_STATUSES,
  ageStage,
  grownUpBirthYearCutoff,
  isClosed,
  isClosureStatus,
  maySignIn,
  mayUseAuthToken,
  statusDefinition,
} from "@/lib/account-lifecycle";
import { BORROWING_ALLOWED_STATUSES, memberMayBorrow } from "@/lib/circulation";
import { ROLE_DEFINITIONS } from "@/lib/permissions";

/**
 * Growing up, and leaving.
 *
 * Two properties carry this feature, and both fail silently in production:
 *
 *   1. A closed account can do nothing — and gets there by every gate being an
 *      allowlist, not by anybody remembering to add two statuses in five files.
 *   2. Nobody is restricted early. The library holds a birth year and not a
 *      birthday, so the restriction has to wait out the whole ambiguity.
 */

const CLOSED = ["GROWN_UP", "LEFT", "DEACTIVATED", "ARCHIVED"] as const;

describe("a closed account can do nothing", () => {
  it("cannot sign in", () => {
    for (const status of CLOSED) expect(maySignIn(status)).toBe(false);
    expect(maySignIn("ACTIVE")).toBe(true);
    expect(maySignIn("INVITED")).toBe(false);
  });

  it("cannot borrow", () => {
    for (const status of CLOSED) expect(memberMayBorrow(status)).toBe(false);
    expect(memberMayBorrow("ACTIVE")).toBe(true);
  });

  /**
   * The bug this replaced.
   *
   * The token gate used to name three statuses to REFUSE and admit everything
   * else, so GROWN_UP and LEFT — added afterwards — would have been let
   * through by default, and a closed account could have reset its way back in.
   * Nothing on the screen would have looked wrong.
   */
  it("cannot be reached through an activation or reset link", () => {
    for (const status of CLOSED) expect(mayUseAuthToken(status)).toBe(false);
    // INVITED is allowed here and nowhere else: activation is how an invited
    // account becomes a real one.
    expect(mayUseAuthToken("INVITED")).toBe(true);
    expect(mayUseAuthToken("ACTIVE")).toBe(true);
    expect(mayUseAuthToken("SUSPENDED")).toBe(false);
  });

  it("is recognised as closed", () => {
    for (const status of CLOSED) expect(isClosed(status)).toBe(true);
    expect(isClosed("ACTIVE")).toBe(false);
    expect(isClosed("SUSPENDED")).toBe(false);
    expect(CLOSED_STATUSES).toHaveLength(CLOSED.length);
  });

  /**
   * Every gate is written by what it PERMITS.
   *
   * Asserted directly, because this is the property that makes a status added
   * next year safe by default — it can do nothing at all until somebody puts it
   * on a list on purpose.
   */
  it("keeps every gate an allowlist of the smallest useful size", () => {
    expect(LOGIN_ALLOWED_STATUSES).toEqual(["ACTIVE"]);
    expect(BORROWING_ALLOWED_STATUSES).toEqual(["ACTIVE"]);
    expect(TOKEN_ALLOWED_STATUSES).toEqual(["INVITED", "ACTIVE"]);
  });
});

describe("nobody is restricted early", () => {
  const ageMax = 14;

  /**
   * A birth year is two ages, and the library chose not to know which.
   *
   * Born 2011, during 2026: 14 until their birthday and 15 after it. Restricting
   * in January over a birthday in November would lock a fourteen-year-old out
   * of a library they are still the right age for.
   */
  it("keeps a reader who might still be inside the range", () => {
    expect(ageStage(2011, ageMax, 2026)).toBe("lastYear");
  });

  it("restricts only once every reading of the year is past the range", () => {
    // Born 2010: 15 until their birthday, 16 after. Past 14 either way.
    expect(ageStage(2010, ageMax, 2026)).toBe("grownUp");
  });

  it("leaves younger readers alone", () => {
    expect(ageStage(2016, ageMax, 2026)).toBe("child");
    expect(ageStage(2012, ageMax, 2026)).toBe("child");
  });

  it("gives exactly one year of notice before anything closes", () => {
    // The nudge year and the restriction year are adjacent and do not overlap:
    // a reader is warned for a full year and then retired, never both at once
    // and never neither.
    const stages = [2013, 2012, 2011, 2010, 2009].map((year) => ageStage(year, ageMax, 2026));
    expect(stages).toEqual(["child", "child", "lastYear", "grownUp", "grownUp"]);
  });

  /**
   * The query the nightly pass runs has to select exactly the years `ageStage`
   * calls grown up — no more, and no fewer. A cutoff one year out would retire
   * a whole cohort early, silently, overnight.
   */
  it("uses a cutoff that agrees with the stage function exactly", () => {
    for (const year of [2025, 2026, 2030]) {
      const cutoff = grownUpBirthYearCutoff(ageMax, year);

      for (let birthYear = cutoff - 3; birthYear <= cutoff + 3; birthYear += 1) {
        expect(birthYear <= cutoff).toBe(ageStage(birthYear, ageMax, year) === "grownUp");
      }
    }
  });

  it("follows the library's own age range rather than a literal", () => {
    // A library that runs to 11 retires sooner; one that runs to 18 later.
    expect(ageStage(2011, 11, 2026)).toBe("grownUp");
    expect(ageStage(2011, 18, 2026)).toBe("child");
  });
});

describe("the words", () => {
  it("never tells a child they did something wrong", () => {
    const copy = [
      LIFECYCLE_MESSAGES.growingUp(5, 14),
      LIFECYCLE_MESSAGES.grownUp,
      LIFECYCLE_MESSAGES.left,
      ...CLOSURE_KINDS.map((kind) => kind.description),
    ];

    for (const line of copy) {
      expect(line).not.toMatch(/\b(expired|banned|blocked|removed|violation|forbidden)\b/i);
    }
  });

  it("says out loud that the record is kept", () => {
    for (const kind of CLOSURE_KINDS) {
      expect(kind.description).toMatch(/history stays/i);
    }
  });

  it("names both closures and refuses anything else", () => {
    expect(CLOSURE_KINDS.map((kind) => kind.status)).toEqual(["GROWN_UP", "LEFT"]);
    expect(isClosureStatus("GROWN_UP")).toBe(true);
    expect(isClosureStatus("LEFT")).toBe(true);
    // The action casts a form field to this type; anything else must not pass.
    expect(isClosureStatus("ARCHIVED")).toBe(false);
    expect(isClosureStatus("ACTIVE")).toBe(false);
  });

  it("has a label for every status the desk can render", () => {
    for (const status of [...CLOSED, "ACTIVE", "INVITED", "SUSPENDED"] as const) {
      expect(statusDefinition(status).staffLabel).not.toBe(status);
    }
  });
});

describe("closing is not deleting", () => {
  const service = readFileSync("src/server/services/account-service.ts", "utf8");

  /**
   * The contract of the whole feature. A family moving to another city is not a
   * reason to lose the library's record of the forty books it lent them.
   */
  it("never deletes a row when closing an account", () => {
    const closing = service.slice(service.indexOf("export async function applyClosure"));

    expect(closing).not.toMatch(/\.delete\(/);
    expect(closing).not.toMatch(/deleteMany\(\s*\{\s*where:\s*\{\s*id/);
    expect(closing).toContain('status: params.status');
  });

  it("is the Super Admin's key, checked in the service", () => {
    expect(service).toContain('requirePermission("member.deactivate")');
  });

  it("keeps closure off every role but the Super Admin", () => {
    for (const role of ROLE_DEFINITIONS) {
      if (role.key === "SUPER_ADMIN") continue;
      expect(role.permissions).not.toContain("member.deactivate");
    }
  });

  it("ends live sessions and kills live links in the same breath", () => {
    const closing = service.slice(service.indexOf("export async function applyClosure"));

    // "Closed but still browsing" is not a state that may exist.
    expect(closing).toContain("revokeAllSessionsForUser");
    expect(closing).toContain('revokeTokens(tx, params.memberUserId, "ACTIVATION")');
    expect(closing).toContain('revokeTokens(tx, params.memberUserId, "PASSWORD_RESET")');
  });
});

describe("the nightly pass", () => {
  const sweep = readFileSync("src/server/lib/growing-up.ts", "utf8");

  it("only ever touches accounts that are working", () => {
    // A suspended or already-closed account is somebody's decision, and this
    // pass must not overwrite it with a different one.
    expect(sweep).toContain('status: { in: ["ACTIVE", "INVITED"] }');
    expect(sweep).toContain('kind: "MEMBER"');
  });

  it("closes through the same path a person does", () => {
    expect(sweep).toContain("applyClosure");
    expect(sweep).toContain("automatic: true");
  });

  it("reads the year in the library's calendar, not the server's", () => {
    // A pass at 03:00 UTC on 31 December is already next year in Asia/Kolkata,
    // and the year is the entire input to this decision.
    expect(sweep).toContain("timeZone: library.settings.timezone");
  });

  it("sends nobody an email", () => {
    // The first a family hears about a closed card should be a person.
    expect(sweep).not.toMatch(/EmailService|sendAccount/);
  });
});
