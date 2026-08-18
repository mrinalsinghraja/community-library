import { describe, expect, it } from "vitest";

import { DORMANT_CIRCULATION_SETTINGS } from "@/lib/circulation";
import {
  brandingSchema,
  contrastRatio,
  DATE_FORMAT_OPTIONS,
  EDITABLE_BRANDING_FIELDS,
  EDITABLE_SETTING_FIELDS,
  isValidTimezone,
  librarySettingsSchema,
  MIN_BRAND_CONTRAST,
  SETTING_BOUNDS,
} from "@/lib/settings-schema";

/**
 * The bounds a Super Admin is held to.
 *
 * These are the numbers a community library runs on, and the reason they are
 * bounded at all is that the form is the only place they can now be changed:
 * a typo of `140` in the loan-period box would hand out books for five months.
 * The screen renders `min`/`max` from these same constants, so what the browser
 * suggests and what the server enforces cannot drift apart.
 */

/** A complete, valid submission. Each test below breaks exactly one thing. */
const VALID = {
  libraryName: "Test Children's Library",
  timezone: "Asia/Kolkata",
  dateFormat: "d MMM yyyy",
  borrowingPeriodDays: "14",
  maxActiveLoans: "2",
  maxRenewals: "1",
  renewalPeriodDays: "14",
  ageMin: "5",
  ageMax: "14",
  memberCodePrefix: "TST-R",
  copyCodePrefix: "TST-B",
  catalogueVisibility: "MEMBER_ONLY",
};

describe("library settings validation", () => {
  it("accepts the owner's approved rules", () => {
    const parsed = librarySettingsSchema.parse(VALID);

    expect(parsed.borrowingPeriodDays).toBe(14);
    expect(parsed.maxActiveLoans).toBe(2);
    expect(parsed.maxRenewals).toBe(1);
    expect(parsed.renewalPeriodDays).toBe(14);
  });

  it.each([
    ["borrowingPeriodDays", "0"],
    ["borrowingPeriodDays", "31"],
    ["maxActiveLoans", "0"],
    ["maxActiveLoans", "6"],
    ["maxRenewals", "-1"],
    ["maxRenewals", "4"],
    ["renewalPeriodDays", "0"],
    ["renewalPeriodDays", "31"],
  ])("refuses %s = %s", (field, value) => {
    const result = librarySettingsSchema.safeParse({ ...VALID, [field]: value });
    expect(result.success).toBe(false);
  });

  it("refuses a fraction of a day", () => {
    expect(librarySettingsSchema.safeParse({ ...VALID, borrowingPeriodDays: "7.5" }).success).toBe(
      false,
    );
  });

  it("refuses an oldest age younger than the youngest", () => {
    const result = librarySettingsSchema.safeParse({ ...VALID, ageMin: "12", ageMax: "8" });

    expect(result.success).toBe(false);
    // Reported against a field, so the screen has somewhere to show it.
    expect(result.success === false && result.error.issues[0]?.path).toEqual(["ageMax"]);
  });

  it("refuses a timezone the server does not know", () => {
    expect(librarySettingsSchema.safeParse({ ...VALID, timezone: "Mars/Olympus" }).success).toBe(
      false,
    );
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Nowhere/Nothing")).toBe(false);
  });

  it("refuses a date format nobody offered", () => {
    expect(
      librarySettingsSchema.safeParse({ ...VALID, dateFormat: "yyyy'T'HH:mm:ss" }).success,
    ).toBe(false);
    for (const option of DATE_FORMAT_OPTIONS) {
      expect(librarySettingsSchema.safeParse({ ...VALID, dateFormat: option.value }).success).toBe(
        true,
      );
    }
  });

  it("shouts a code prefix, because it is printed on a label", () => {
    const parsed = librarySettingsSchema.parse({ ...VALID, memberCodePrefix: "mjcl-r" });
    expect(parsed.memberCodePrefix).toBe("MJCL-R");
  });

  it.each(["", "X", "WAY-TOO-LONG-PREFIX", "MJ CL", "MJ_CL"])(
    "refuses the prefix %s",
    (value) => {
      expect(librarySettingsSchema.safeParse({ ...VALID, memberCodePrefix: value }).success).toBe(
        false,
      );
    },
  );
});

describe("the allowlist", () => {
  it("cannot write a dormant column", () => {
    for (const setting of DORMANT_CIRCULATION_SETTINGS) {
      expect(EDITABLE_SETTING_FIELDS as readonly string[]).not.toContain(setting);
    }
  });

  it("does not include the two settings that need their own confirmation", () => {
    // Guardian verification needs a tick box; the reminder switch needs a mail
    // provider. Neither can be one field among twelve saved by one button.
    expect(EDITABLE_SETTING_FIELDS as readonly string[]).not.toContain(
      "requiredGuardianVerification",
    );
    expect(EDITABLE_SETTING_FIELDS as readonly string[]).not.toContain("overdueRemindersEnabled");
  });

  it("does not include the consent version", () => {
    // The wording lives in the code. A version number that could be changed
    // without the words changing would make a consent record describe wording
    // nobody ever saw.
    expect(EDITABLE_SETTING_FIELDS as readonly string[]).not.toContain("consentVersion");
  });

  it("matches what the branding form actually submits", () => {
    const submitted = Object.keys(brandingSchema.shape).sort();
    expect(submitted).toEqual([...EDITABLE_BRANDING_FIELDS].sort());
  });
});

describe("branding validation", () => {
  const VALID_BRANDING = {
    primaryColor: "#1F6F5C",
    welcomeMessage: "Welcome to the library",
    rulesMarkdown: "",
    donationPolicyMarkdown: "",
    contactEmail: "",
    contactPhone: "",
  };

  it("accepts the library's own colour", () => {
    expect(brandingSchema.parse(VALID_BRANDING).primaryColor).toBe("#1F6F5C");
  });

  it.each(["1F6F5C", "#FFF", "rebeccapurple", "#12345G"])("refuses %s", (value) => {
    expect(brandingSchema.safeParse({ ...VALID_BRANDING, primaryColor: value }).success).toBe(
      false,
    );
  });

  it("refuses a colour too pale to see the library's mark on", () => {
    // The mark is drawn as white shapes on this colour. Measured, not judged by
    // eye — the same rule Phase 0 applied to every token in the design system.
    expect(contrastRatio("#F7E9A0")).toBeLessThan(MIN_BRAND_CONTRAST);
    expect(brandingSchema.safeParse({ ...VALID_BRANDING, primaryColor: "#F7E9A0" }).success).toBe(
      false,
    );

    expect(contrastRatio("#1F6F5C")).toBeGreaterThanOrEqual(MIN_BRAND_CONTRAST);
  });

  it("computes contrast the way WCAG does", () => {
    // Black on white is the definition: 21:1.
    expect(contrastRatio("#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("refuses an email address that is not one, and allows an empty box", () => {
    expect(brandingSchema.safeParse({ ...VALID_BRANDING, contactEmail: "nope" }).success).toBe(
      false,
    );
    expect(brandingSchema.safeParse({ ...VALID_BRANDING, contactEmail: "" }).success).toBe(true);
  });

  it("refuses a welcome message longer than a child will read", () => {
    expect(
      brandingSchema.safeParse({ ...VALID_BRANDING, welcomeMessage: "a".repeat(161) }).success,
    ).toBe(false);
  });
});

describe("the approved defaults", () => {
  it("still stand at fourteen days, two books, one renewal, fourteen more", () => {
    // ADR-032. A bound may widen; the standard the owner approved may not drift.
    expect(SETTING_BOUNDS.borrowingPeriodDays.standard).toBe(14);
    expect(SETTING_BOUNDS.maxActiveLoans.standard).toBe(2);
    expect(SETTING_BOUNDS.maxRenewals.standard).toBe(1);
    expect(SETTING_BOUNDS.renewalPeriodDays.standard).toBe(14);
  });

  it("keeps every standard inside its own bound", () => {
    for (const [name, bound] of Object.entries(SETTING_BOUNDS)) {
      expect(bound.standard, name).toBeGreaterThanOrEqual(bound.min);
      expect(bound.standard, name).toBeLessThanOrEqual(bound.max);
    }
  });
});
