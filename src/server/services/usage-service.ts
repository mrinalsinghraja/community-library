import "server-only";

import { Prisma } from "@prisma/client";

import {
  USAGE_RETENTION_DAYS,
  addDays,
  cleanPlace,
  dateOnly,
  featureForPath,
  localDateString,
  looksLikeRobot,
} from "@/lib/usage";
import { prisma } from "@/server/db";
import { hashIdentifier } from "@/server/lib/crypto";

/**
 * Anonymous usage counting and its report (ADR-077).
 *
 * Two small tables, both without anything that names a person:
 *
 *   usage_daily    one row per day / part of the site / place, with a hit count
 *   usage_visitor  one row per day / device / part of the site, so a device that
 *                  opens ten pages is one user, not ten
 *
 * The device is never stored. `visitorHash` is an HMAC of the day, the
 * connection address and the browser, keyed with the server secret; it changes
 * at midnight, so nobody can be followed from one day to the next, and the
 * address cannot be recovered from it.
 */

export interface UsageHit {
  libraryId: string;
  timezone: string;
  path: unknown;
  ip: string | null;
  userAgent: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  now?: Date;
}

/** Records one page view. Returns false when it was deliberately not counted. */
export async function recordUsage(hit: UsageHit): Promise<boolean> {
  const feature = featureForPath(hit.path);
  if (!feature || looksLikeRobot(hit.userAgent)) return false;

  const place = cleanPlace(hit);
  const dayString = localDateString(hit.now ?? new Date(), hit.timezone);
  const day = dateOnly(dayString);
  const visitorHash = hashIdentifier(`usage|${dayString}|${hit.ip ?? "?"}|${hit.userAgent ?? "?"}`);

  const where = {
    libraryId_day_feature_country_region_city: {
      libraryId: hit.libraryId,
      day,
      feature,
      country: place.country,
      region: place.region,
      city: place.city,
    },
  };

  const bump = async () => {
    try {
      await prisma.usageDaily.upsert({
        where,
        create: { libraryId: hit.libraryId, day, feature, ...place, hits: 1 },
        update: { hits: { increment: 1 } },
      });
    } catch (error) {
      // Two first-of-the-day views racing to create the same row: the loser
      // just adds to the winner's row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await prisma.usageDaily.update({ where, data: { hits: { increment: 1 } } });
        return;
      }
      throw error;
    }
  };

  await Promise.all([
    bump(),
    prisma.usageVisitor.createMany({
      data: [{ libraryId: hit.libraryId, day, visitorHash, feature, ...place }],
      skipDuplicates: true,
    }),
  ]);
  return true;
}

/** Daily housekeeping: nothing older than the retention window is kept. */
export async function pruneOldUsage(
  now = new Date(),
  timezone = "Asia/Kolkata",
  days = USAGE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = dateOnly(addDays(localDateString(now, timezone), -days));
  const [a, b] = await Promise.all([
    prisma.usageDaily.deleteMany({ where: { day: { lt: cutoff } } }),
    prisma.usageVisitor.deleteMany({ where: { day: { lt: cutoff } } }),
  ]);
  return a.count + b.count;
}

export interface UsageRow {
  key: string;
  /** Second level of a grouping: the state for a city, otherwise "". */
  group: string;
  hits: number;
  users: number;
}

export interface UsageReport {
  from: string;
  to: string;
  days: Array<{ day: string; hits: number; users: number }>;
  features: UsageRow[];
  countries: UsageRow[];
  states: UsageRow[];
  cities: UsageRow[];
  totals: { hits: number; userDays: number };
  /** Earliest day with any count, so the page can say when counting began. */
  firstDay: string | null;
}

type Dimension = "feature" | "country" | "region" | "city";

/** Distinct users: one per device per day, however many pages it opened. */
async function usersBy(
  libraryId: string,
  from: Date,
  column: Dimension | null,
  indiaOnly: boolean,
): Promise<Array<{ key: string; group: string; users: number }>> {
  const col = column ? Prisma.raw(`"${column}"`) : Prisma.raw(`"day"::text`);
  const group = column === "city" ? Prisma.raw(`"region"`) : Prisma.raw(`''`);
  const india = indiaOnly ? Prisma.sql`AND "country" = 'IN'` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ key: string; grp: string; users: number }>>`
    SELECT ${col} AS key, ${group} AS grp,
           COUNT(DISTINCT ("day"::text || "visitor_hash"))::int AS users
    FROM "usage_visitor"
    WHERE "library_id" = ${libraryId} AND "day" >= ${from} ${india}
    GROUP BY 1, 2`;
  return rows.map((r) => ({ key: r.key, group: r.grp, users: r.users }));
}

export async function getUsageReport(
  libraryId: string,
  timezone: string,
  now = new Date(),
  days = USAGE_RETENTION_DAYS,
): Promise<UsageReport> {
  const to = localDateString(now, timezone);
  const from = addDays(to, -(days - 1));
  const fromDate = dateOnly(from);
  const base = { libraryId, day: { gte: fromDate } };

  const [dailyHits, dailyUsers, byFeature, byCountry, byRegion, byCity, first] = await Promise.all([
    prisma.usageDaily.groupBy({ by: ["day"], where: base, _sum: { hits: true } }),
    usersBy(libraryId, fromDate, null, false),
    prisma.usageDaily.groupBy({ by: ["feature"], where: base, _sum: { hits: true } }),
    prisma.usageDaily.groupBy({ by: ["country"], where: base, _sum: { hits: true } }),
    prisma.usageDaily.groupBy({ by: ["region"], where: { ...base, country: "IN" }, _sum: { hits: true } }),
    prisma.usageDaily.groupBy({
      by: ["region", "city"],
      where: { ...base, country: "IN" },
      _sum: { hits: true },
    }),
    prisma.usageDaily.findFirst({ where: { libraryId }, orderBy: { day: "asc" }, select: { day: true } }),
  ]);

  const [userFeature, userCountry, userRegion, userCity] = await Promise.all([
    usersBy(libraryId, fromDate, "feature", false),
    usersBy(libraryId, fromDate, "country", false),
    usersBy(libraryId, fromDate, "region", true),
    usersBy(libraryId, fromDate, "city", true),
  ]);

  const hitsByDay = new Map(dailyHits.map((r) => [r.day.toISOString().slice(0, 10), r._sum.hits ?? 0]));
  const usersByDay = new Map(dailyUsers.map((r) => [r.key, r.users]));

  // Every day in the window, so a quiet day shows as zero rather than a gap.
  const daySeries: UsageReport["days"] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    daySeries.push({ day: d, hits: hitsByDay.get(d) ?? 0, users: usersByDay.get(d) ?? 0 });
  }

  const join = (
    hits: Array<{ key: string; group: string; hits: number }>,
    users: Array<{ key: string; group: string; users: number }>,
  ): UsageRow[] => {
    const u = new Map(users.map((r) => [`${r.group}|${r.key}`, r.users]));
    return hits
      .map((h) => ({ ...h, users: u.get(`${h.group}|${h.key}`) ?? 0 }))
      .sort((a, b) => b.hits - a.hits);
  };

  return {
    from,
    to,
    days: daySeries,
    features: join(
      byFeature.map((r) => ({ key: r.feature, group: "", hits: r._sum.hits ?? 0 })),
      userFeature,
    ),
    countries: join(
      byCountry.map((r) => ({ key: r.country, group: "", hits: r._sum.hits ?? 0 })),
      userCountry,
    ),
    states: join(
      byRegion.map((r) => ({ key: r.region, group: "", hits: r._sum.hits ?? 0 })),
      userRegion,
    ),
    cities: join(
      byCity.map((r) => ({ key: r.city, group: r.region, hits: r._sum.hits ?? 0 })),
      userCity,
    ),
    totals: {
      hits: daySeries.reduce((sum, d) => sum + d.hits, 0),
      userDays: daySeries.reduce((sum, d) => sum + d.users, 0),
    },
    firstDay: first ? first.day.toISOString().slice(0, 10) : null,
  };
}
