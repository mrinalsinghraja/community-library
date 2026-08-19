import { describe, expect, it } from "vitest";

import {
  APARTMENT_ERROR,
  APARTMENT_MAX_LENGTH,
  isValidApartment,
  normaliseApartment,
} from "@/lib/apartment";

/**
 * The flat-number format.
 *
 * A door number is one of the few free-text values a stranger can put in front
 * of library staff, so the accepted shape is narrow and written down here as
 * examples rather than as a restatement of the regular expression.
 */

describe("flat numbers this building actually uses", () => {
  for (const value of ["P-15", "A-102", "B12", "Tower-A-15", "15", "a-1", "TOWER-B-9"]) {
    it(`accepts ${value}`, () => {
      expect(isValidApartment(value)).toBe(true);
    });
  }

  it("trims what somebody typed with a stray space", () => {
    expect(isValidApartment("  P-15  ")).toBe(true);
    expect(normaliseApartment("  P-15  ")).toBe("P-15");
  });
});

describe("values that are not flat numbers", () => {
  for (const value of [
    "",
    "   ",
    "P@15",
    "P/15",
    "<P-15>",
    "P 15",
    "P_15",
    "P.15",
    "P--15",
    "-15",
    "P-",
    "P-15; DROP TABLE",
    "<script>alert(1)</script>",
    "flat@example.com",
    "../../etc/passwd",
  ]) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      expect(isValidApartment(value)).toBe(false);
    });
  }

  it("refuses something longer than the field allows", () => {
    expect(isValidApartment("A".repeat(APARTMENT_MAX_LENGTH))).toBe(true);
    expect(isValidApartment("A".repeat(APARTMENT_MAX_LENGTH + 1))).toBe(false);
  });

  /**
   * The anchors matter. A pattern without them would accept a value whose
   * *second* line is anything at all, and `.` classes in JavaScript do not
   * match newlines — so the check has to refuse the whole string, not find a
   * good line inside it.
   */
  it("refuses a value with a second line hidden in it", () => {
    expect(isValidApartment("P-15\n<script>alert(1)</script>")).toBe(false);
    expect(isValidApartment("P-15\nA-102")).toBe(false);
  });
});

describe("the message a family sees", () => {
  it("is the one the brief specifies, and shows the format by example", () => {
    expect(APARTMENT_ERROR).toBe("Enter a valid flat number, for example P-15.");
  });
});
