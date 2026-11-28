import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/usage/hit/route";
import { pruneOldUsage, getUsageReport, recordUsage } from "@/server/services/usage-service";
import { createLibraryFixture, db, resetDatabase, type Fixture } from "./helpers";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605";
const TZ = "Asia/Kolkata";
const NOW = new Date("2026-11-28T06:00:00Z");

let fixture: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createLibraryFixture();
});

afterAll(async () => {
  await db.$disconnect();
});

function hit(overrides: Partial<Parameters<typeof recordUsage>[0]> = {}) {
  return recordUsage({
    libraryId: fixture.libraryId,
    timezone: TZ,
    path: "/books",
    ip: "203.0.113.5",
    userAgent: PHONE,
    country: "IN",
    region: "KA",
    city: "Bengaluru",
    now: NOW,
    ...overrides,
  });
}

describe("usage counting", () => {
  it("counts hits, and one user per device per day", async () => {
    await hit();
    await hit();
    await hit({ path: "/faq" });
    await hit({ ip: "203.0.113.9" });

    const report = await getUsageReport(fixture.libraryId, TZ, NOW);
    const today = report.days.at(-1)!;
    expect(today).toEqual({ day: "2026-11-28", hits: 4, users: 2 });
    expect(report.features.find((f) => f.key === "catalogue")).toMatchObject({ hits: 3, users: 2 });
    expect(report.features.find((f) => f.key === "faq")).toMatchObject({ hits: 1, users: 1 });
    expect(report.totals).toEqual({ hits: 4, userDays: 2 });
  });

  it("splits by country, state and city", async () => {
    await hit();
    await hit({ ip: "198.51.100.1", region: "MH", city: "Mumbai" });
    await hit({ ip: "192.0.2.7", country: "US", region: "CA", city: "Fremont" });

    const report = await getUsageReport(fixture.libraryId, TZ, NOW);
    expect(report.countries.map((c) => [c.key, c.hits])).toEqual(
      expect.arrayContaining([["IN", 2], ["US", 1]]),
    );
    expect(report.states.map((s) => s.key).sort()).toEqual(["KA", "MH"]);
    expect(report.cities.find((c) => c.key === "Mumbai")).toMatchObject({ group: "MH", hits: 1 });
  });

  it("stores no address and no user agent, only the scrambled code", async () => {
    await hit();
    const visitor = await db.usageVisitor.findFirstOrThrow();
    expect(JSON.stringify(visitor)).not.toContain("203.0.113.5");
    expect(JSON.stringify(visitor)).not.toContain("iPhone");
    expect(visitor.visitorHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scrambles the same device differently on a different day", async () => {
    await hit();
    await hit({ now: new Date("2026-11-29T06:00:00Z") });
    const hashes = (await db.usageVisitor.findMany()).map((v) => v.visitorHash);
    expect(new Set(hashes).size).toBe(2);
  });

  it("skips robots, the report and bad paths", async () => {
    expect(await hit({ userAgent: "Googlebot/2.1" })).toBe(false);
    expect(await hit({ path: "/report" })).toBe(false);
    expect(await hit({ path: "//evil.example" })).toBe(false);
    expect(await db.usageDaily.count()).toBe(0);
  });

  it("fills quiet days with zero across the whole window", async () => {
    await hit();
    const report = await getUsageReport(fixture.libraryId, TZ, NOW);
    expect(report.days).toHaveLength(90);
    expect(report.days[0]!.day).toBe("2026-08-31");
    expect(report.days.filter((d) => d.hits === 0)).toHaveLength(89);
  });

  it("removes counts older than 90 days and keeps the rest", async () => {
    await hit({ now: new Date("2026-08-01T06:00:00Z") });
    await hit();
    const removed = await pruneOldUsage(NOW, TZ);
    expect(removed).toBe(2); // one daily row and one visitor row
    expect(await db.usageDaily.count()).toBe(1);
  });

  it("counts counts concurrently without losing one", async () => {
    await Promise.all(Array.from({ length: 8 }, () => hit()));
    const report = await getUsageReport(fixture.libraryId, TZ, NOW);
    expect(report.totals.hits).toBe(8);
  });
});

describe("the beacon route", () => {
  it("always answers 204, records a real hit, and shrugs off rubbish", async () => {
    const send = (body: string, headers: Record<string, string> = {}) =>
      POST(
        new NextRequest("http://localhost/api/usage/hit", {
          method: "POST",
          body,
          headers: { "user-agent": PHONE, "x-forwarded-for": "203.0.113.5", ...headers },
        }),
      );

    const ok = await send(JSON.stringify({ path: "/guide" }), {
      "x-vercel-ip-country": "IN",
      "x-vercel-ip-country-region": "KA",
      "x-vercel-ip-city": "Bengaluru",
    });
    expect(ok.status).toBe(204);
    expect((await send("not json")).status).toBe(204);
    expect((await send("x".repeat(5000))).status).toBe(204);

    const row = await db.usageDaily.findFirstOrThrow();
    expect(row).toMatchObject({ feature: "guide", country: "IN", region: "KA", city: "Bengaluru", hits: 1 });
  });
});
