import "server-only";

import { grownUpBirthYearCutoff } from "@/lib/account-lifecycle";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { applyClosure } from "@/server/services/account-service";

/**
 * The nightly pass that retires readers who have grown out of the library.
 *
 * **It is deliberately slow to act.** The library holds a birth year and not a
 * birthday (ADR-051), so a reader born in 2011 is, during 2026, either 14 or
 * 15 — and this closes an account only once the year is past the range on
 * *every* reading of it. The cost is that a reader keeps their card for up to a
 * year longer than a library holding birthdays would allow. The alternative
 * cost is locking a fourteen-year-old out in January over a birthday in
 * November, which is the wrong mistake to make.
 *
 * During that extra year the reader is a full member and sees a quiet note on
 * their own page asking them to have a word with the librarian. Nothing here
 * sends anybody an email: the first a family hears about it should be a person,
 * not a machine.
 *
 * Runs with no actor. `actorUserId` is null and the audit row says
 * `automatic: true`, which is the only trace that a scheduled job closed
 * somebody's account — and "why did my child's card stop working?" has to be
 * answerable a year later.
 */

export interface GrowingUpResult {
  /** Accounts closed on this run. */
  retired: number;
  /** The newest birth year considered past the range, for the log. */
  cutoffBirthYear: number;
}

export async function retireGrownUpReaders(now: Date = new Date()): Promise<GrowingUpResult> {
  const libraries = await prisma.library.findMany({
    select: { id: true, settings: { select: { ageMax: true, timezone: true } } },
  });

  let retired = 0;
  let cutoffBirthYear = 0;

  for (const library of libraries) {
    if (!library.settings) continue;

    // The library's own calendar year, not the server's. A pass running at
    // 03:00 UTC on 31 December is already the next year in Asia/Kolkata, and
    // the year is the whole input to this decision.
    const year = Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: library.settings.timezone,
        year: "numeric",
      }).format(now),
    );

    cutoffBirthYear = grownUpBirthYearCutoff(library.settings.ageMax, year);

    const candidates = await prisma.appUser.findMany({
      where: {
        libraryId: library.id,
        kind: "MEMBER",
        // Only accounts that are actually working. A suspended or already
        // closed account is somebody's decision, and this pass must not
        // overwrite it with a different one.
        status: { in: ["ACTIVE", "INVITED"] },
        memberProfile: { birthYear: { lte: cutoffBirthYear } },
      },
      select: { id: true, status: true, memberProfile: { select: { birthYear: true } } },
    });

    for (const candidate of candidates) {
      await applyClosure({
        memberUserId: candidate.id,
        libraryId: library.id,
        previousStatus: candidate.status,
        status: "GROWN_UP",
        reason: `Born ${candidate.memberProfile?.birthYear}, past the library's range of ${library.settings.ageMax} in ${year}.`,
        actorUserId: null,
        actorLabel: "the library",
        automatic: true,
      });
      retired += 1;
    }

    if (candidates.length > 0) {
      await recordAudit(prisma, {
        libraryId: library.id,
        action: AUDIT_ACTIONS.GROWN_UP_SWEEP,
        entityType: "app_user",
        actorUserId: null,
        actorLabel: "the library",
        metadata: { retired: candidates.length, cutoffBirthYear, year },
      });
    }
  }

  return { retired, cutoffBirthYear };
}
