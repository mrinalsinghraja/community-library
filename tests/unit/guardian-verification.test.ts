import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_VERIFICATION_WARNING,
  STRENGTH_BY_METHOD,
  VERIFICATION_STRENGTH_ORDER,
  highestStrength,
  isDevelopmentVerificationMode,
  isSelfServiceMethod,
  meetsRequiredStrength,
  selfServiceMethodFor,
  strengthRank,
} from "@/lib/guardian-verification";

/**
 * The verification policy.
 *
 * These are the comparisons the production activation gate makes, so a mistake
 * here would let a ticked box open an account in a library that requires more.
 */

describe("strength ordering", () => {
  it("runs weakest to strongest", () => {
    expect(VERIFICATION_STRENGTH_ORDER).toEqual([
      "NONE",
      "SELF_DECLARED",
      "EMAIL_CONFIRMED",
      "STAFF_VERIFIED",
      "IDENTITY_PROVIDER",
    ]);
  });

  it("is strictly increasing", () => {
    for (let i = 1; i < VERIFICATION_STRENGTH_ORDER.length; i += 1) {
      expect(strengthRank(VERIFICATION_STRENGTH_ORDER[i])).toBeGreaterThan(
        strengthRank(VERIFICATION_STRENGTH_ORDER[i - 1]),
      );
    }
  });

  it("refuses an unknown strength rather than scoring it zero", () => {
    // Silently ranking an unknown value as weakest would be survivable; ranking
    // it as anything at all is how a typo becomes a security bug.
    expect(() => strengthRank("MADE_UP" as never)).toThrow(/Unknown verification strength/);
  });
});

describe("meetsRequiredStrength", () => {
  it("accepts equal and stronger", () => {
    expect(meetsRequiredStrength("SELF_DECLARED", "SELF_DECLARED")).toBe(true);
    expect(meetsRequiredStrength("STAFF_VERIFIED", "EMAIL_CONFIRMED")).toBe(true);
    expect(meetsRequiredStrength("IDENTITY_PROVIDER", "NONE")).toBe(true);
  });

  it("refuses weaker", () => {
    expect(meetsRequiredStrength("SELF_DECLARED", "EMAIL_CONFIRMED")).toBe(false);
    expect(meetsRequiredStrength("EMAIL_CONFIRMED", "STAFF_VERIFIED")).toBe(false);
    expect(meetsRequiredStrength("NONE", "SELF_DECLARED")).toBe(false);
  });

  it("treats a ticked box as insufficient for every real requirement", () => {
    for (const required of ["EMAIL_CONFIRMED", "STAFF_VERIFIED", "IDENTITY_PROVIDER"] as const) {
      expect(meetsRequiredStrength("SELF_DECLARED", required)).toBe(false);
    }
  });
});

describe("highestStrength", () => {
  it("returns NONE for no records at all", () => {
    expect(highestStrength([])).toBe("NONE");
  });

  it("picks the strongest, whatever the order", () => {
    expect(highestStrength(["SELF_DECLARED", "STAFF_VERIFIED", "EMAIL_CONFIRMED"])).toBe(
      "STAFF_VERIFIED",
    );
    expect(highestStrength(["STAFF_VERIFIED", "SELF_DECLARED"])).toBe("STAFF_VERIFIED");
  });
});

describe("method to strength", () => {
  it("never rates a self-declaration above what it is", () => {
    expect(STRENGTH_BY_METHOD.SELF_DECLARED).toBe("SELF_DECLARED");
  });

  it("maps each concrete method to its own level", () => {
    expect(STRENGTH_BY_METHOD.EMAIL_CONFIRMATION).toBe("EMAIL_CONFIRMED");
    expect(STRENGTH_BY_METHOD.STAFF_VERIFIED).toBe("STAFF_VERIFIED");
    expect(STRENGTH_BY_METHOD.VERIFIED_IDENTITY_PROVIDER).toBe("IDENTITY_PROVIDER");
  });

  it("gives OTHER no worth by default", () => {
    // A method a future legal review introduces is worth whatever that review
    // says — not whatever this file happened to guess.
    expect(STRENGTH_BY_METHOD.OTHER).toBe("NONE");
  });
});

describe("what the registration flow can start on its own", () => {
  it("uses the tickbox when nothing more is required", () => {
    expect(selfServiceMethodFor("NONE")).toBe("SELF_DECLARED");
    expect(selfServiceMethodFor("SELF_DECLARED")).toBe("SELF_DECLARED");
  });

  it("emails the guardian when confirmation is required", () => {
    expect(selfServiceMethodFor("EMAIL_CONFIRMED")).toBe("EMAIL_CONFIRMATION");
  });

  it("starts nothing when only a person can close the gap", () => {
    // Not an error: the request waits in the queue for a librarian.
    expect(selfServiceMethodFor("STAFF_VERIFIED")).toBeNull();
    expect(selfServiceMethodFor("IDENTITY_PROVIDER")).toBeNull();
  });

  it("knows which methods need nobody else present", () => {
    expect(isSelfServiceMethod("SELF_DECLARED")).toBe(true);
    expect(isSelfServiceMethod("EMAIL_CONFIRMATION")).toBe(true);
    expect(isSelfServiceMethod("STAFF_VERIFIED")).toBe(false);
    expect(isSelfServiceMethod("VERIFIED_IDENTITY_PROVIDER")).toBe(false);
  });
});

describe("the development-mode warning", () => {
  it("applies whenever a ticked box is enough", () => {
    expect(isDevelopmentVerificationMode("NONE")).toBe(true);
    expect(isDevelopmentVerificationMode("SELF_DECLARED")).toBe(true);
  });

  it("stops applying once real verification is required", () => {
    expect(isDevelopmentVerificationMode("EMAIL_CONFIRMED")).toBe(false);
    expect(isDevelopmentVerificationMode("STAFF_VERIFIED")).toBe(false);
  });

  it("says plainly that this is not verification", () => {
    // The single most likely way this system causes harm is somebody believing
    // a ticked box was a check on who that person is. The wording must not go
    // soft in a later edit.
    expect(DEVELOPMENT_VERIFICATION_WARNING).toContain("NOT PRODUCTION VERIFICATION");
    expect(DEVELOPMENT_VERIFICATION_WARNING).toMatch(/does not check who the person is/i);
  });
});
