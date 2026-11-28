import { describe, expect, it } from "vitest";

import {
  addDays,
  cleanPlace,
  countryName,
  featureForPath,
  indiaStateName,
  localDateString,
  looksLikeRobot,
} from "@/lib/usage";

describe("which part of the site a path belongs to", () => {
  it("names the main parts", () => {
    expect(featureForPath("/")).toBe("home");
    expect(featureForPath("/books")).toBe("catalogue");
    expect(featureForPath("/books/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toBe("book");
    expect(featureForPath("/my-books")).toBe("my-books");
    expect(featureForPath("/login?next=/desk")).toBe("sign-in");
    expect(featureForPath("/desk/loans/123")).toBe("desk");
    expect(featureForPath("/privacy")).toBe("legal");
    expect(featureForPath("/something-new")).toBe("other");
  });

  it("never counts the report, the API or anything that is not a path", () => {
    expect(featureForPath("/report")).toBeNull();
    expect(featureForPath("/api/usage/hit")).toBeNull();
    expect(featureForPath("//evil.example")).toBeNull();
    expect(featureForPath("https://evil.example/")).toBeNull();
    expect(featureForPath("")).toBeNull();
    expect(featureForPath(42)).toBeNull();
    expect(featureForPath(`/${"a".repeat(400)}`)).toBeNull();
  });

  it("returns only a fixed label, so a later segment can never be stored", () => {
    expect(featureForPath("/activate/SECRET-TOKEN-VALUE")).toBe("sign-in");
    expect(featureForPath("/books/LIB-000042")).toBe("book");
  });
});

describe("robots", () => {
  it("drops crawlers, tools and empty agents; keeps phones", () => {
    expect(looksLikeRobot(null)).toBe(true);
    expect(looksLikeRobot("Googlebot/2.1")).toBe(true);
    expect(looksLikeRobot("curl/8.4")).toBe(true);
    expect(looksLikeRobot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605")).toBe(false);
  });
});

describe("places", () => {
  it("decodes a city and tidies the codes", () => {
    expect(cleanPlace({ country: "in", region: "ka", city: "Navi%20Mumbai" })).toEqual({
      country: "IN",
      region: "KA",
      city: "Navi Mumbai",
    });
  });

  it("falls back when the host said nothing, and strips odd characters", () => {
    expect(cleanPlace({})).toEqual({ country: "??", region: "", city: "" });
    expect(cleanPlace({ country: "India", city: "<script>x</script>" }).country).toBe("??");
    expect(cleanPlace({ country: "IN", city: "<b>Pune</b>" }).city).toBe("bPuneb");
  });

  it("names Indian states and countries", () => {
    expect(indiaStateName("KA")).toBe("Karnataka");
    expect(indiaStateName("")).toBe("Unknown state");
    expect(countryName("IN")).toBe("India");
    expect(countryName("??")).toBe("Unknown");
  });
});

describe("days", () => {
  it("uses the library's own timezone for the date", () => {
    // 20:00 UTC on the 27th is already the 28th in Kolkata.
    expect(localDateString(new Date("2026-11-27T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-28");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
