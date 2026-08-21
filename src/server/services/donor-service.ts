import "server-only";

import { createHash } from "node:crypto";

import type { DonorDisplayConsent } from "@prisma/client";

import { formatInTimezone } from "@/lib/dates";
import { prisma } from "@/server/db";
import { NotFoundError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";

/**
 * The donor register.
 *
 * This is the one reader-facing service in the application that is deliberately
 * ungated. The catalogue sits behind `catalogue_visibility`; the thank-you page
 * does not, because its whole job is to be read by somebody who has not joined
 * the library and may be deciding whether to give it a book. A front door you
 * have to unlock before you can read the thank-you note on it is not a front
 * door.
 *
 * Three rules hold this together, and none of them are the owner's to waive:
 *
 *   1. **The donor's own choice decides what is printed.** `displayConsent` is
 *      recorded when the book is taken in. NAMED prints the name and the flat,
 *      APARTMENT_ONLY prints the flat and never the name, and ANONYMOUS is not
 *      a row on this page at all -- it is counted into one closing line that
 *      identifies nobody, and it has no page of its own to open.
 *   2. **Alphabetical, never by how many.** The count exists now (see ADR-046),
 *      so the ordering is the thing that has to stop it becoming a league
 *      table. `entries` come back sorted by the label the reader sees, and
 *      there is no sort key on this type that a page could switch to.
 *   3. **No contact details, ever.** `donation` has no phone, no email and no
 *      address by design; this service selects three columns, and they are the
 *      three that were already being shown on each book's own page.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface DonorRegisterEntry {
  /**
   * Opaque and stable, derived from the credit and this library's id.
   *
   * A donation carries no donor row to key off -- the name and flat are written
   * onto each gift -- so the link needs an identifier invented here. It is a
   * hash rather than a readable slug on purpose: a name and a flat number in a
   * URL end up in server logs, in `Referer` headers on the way out to anywhere
   * this page links, and in browser history on a shared family laptop. The page
   * prints the name because the family agreed to that; the address bar was
   * never part of the agreement.
   */
  id: string;
  /**
   * What the register calls this family, and what it is sorted by.
   *
   * Built here rather than in the page so that the order on screen is the order
   * of the words on screen. A page that printed one string and sorted by
   * another would show rows out of alphabetical order and look broken -- which
   * is what happened when every flat-only family was drawn as "a family in this
   * building" and quietly sorted by a flat number nobody could see.
   */
  label: string;
  /** Only when the family agreed to be named. Null for APARTMENT_ONLY. */
  name: string | null;
  /** Null when a named donor gave no flat. */
  apartment: string | null;
  /** Books given, not a score. Rendered with its unit attached. */
  bookCount: number;
  /**
   * The years this family gave in, in the library's timezone.
   *
   * On the register this is a column, and it is there because **flats are
   * rented**. The same flat number over five years can be three different
   * households, and without a year two of them read as one entry that grew.
   * With it, "B-208 · 2024" and "B-208 · 2026" are visibly two families who
   * happen to share an address.
   */
  firstYear: number;
  lastYear: number;
}

export interface DonorRegister {
  /** Alphabetical by the label a reader sees. */
  entries: DonorRegisterEntry[];
  /**
   * How many families asked not to be printed -- families, not books. Enough to
   * thank them out loud, not enough to work out who any of them are.
   */
  anonymousDonors: number;
}

export interface DonorGift {
  /** The book's own code. Used as a stable key, and to link when allowed. */
  code: string;
  title: string;
  authors: string[];
  /**
   * The jacket.
   *
   * A signed-out visitor can read this one because the book is on this page --
   * see `getAuthorizedMedia`, which allows a cover whose title carries a
   * credited donation and refuses every other cover exactly as before. The
   * catalogue did not open; four jackets did.
   */
  coverMediaId: string | null;
  givenAt: Date;
}

export interface DonorRegisterDetail {
  entry: DonorRegisterEntry;
  /** Oldest gift first -- the order this family's books arrived. */
  gifts: DonorGift[];
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

interface CreditColumns {
  donorName: string;
  donorApartment: string | null;
  displayConsent: DonorDisplayConsent;
}

/**
 * What makes two gifts the same family.
 *
 * Consent is part of the key, not a property of the group. A family who gave
 * one book named and one anonymously gets a row for the first and is counted in
 * the anonymous line for the second -- which is exactly what they asked for on
 * each occasion, and is the only reading of the field that cannot leak.
 *
 * Case and surrounding space are normalised so that "the Iyer family" and "The
 * Iyer Family " are one entry rather than two. The spelling that is displayed
 * comes from the first gift, so the library's own writing is what shows.
 */
function groupKey(credit: CreditColumns): string {
  return [
    credit.displayConsent,
    credit.donorName.trim().toLowerCase(),
    (credit.donorApartment ?? "").trim().toLowerCase(),
  ].join("|");
}

/** Stable across deploys, scoped to the library, and reveals nothing on its own. */
function donorId(libraryId: string, key: string): string {
  return createHash("sha256").update(`${libraryId}|${key}`).digest("hex").slice(0, 16);
}

/**
 * What a family is called on the page.
 *
 * A family who asked for the flat alone is named by their flat, because two
 * rows both reading "a family in this building" are two rows a reader cannot
 * tell apart -- and the flat is the part they agreed to.
 */
function registerLabel(entry: { name: string | null; apartment: string | null }): string {
  if (entry.name) return entry.name;
  if (entry.apartment) return `The family in ${entry.apartment}`;
  return "A family in this building";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every family who has given a book, once each, alphabetically.
 *
 * Grouped in memory rather than in SQL because the key is case- and
 * space-insensitive, which `GROUP BY` cannot do without an expression index
 * this table does not need: a community library's donation table is measured in
 * hundreds of rows, and three columns of those hundreds is a smaller read than
 * the page around it.
 *
 * An archived book still counts. The copy may have fallen apart and left the
 * shelf; the gift still happened, and a thank-you that quietly retracts itself
 * when a book wears out would be a strange kind of thank-you.
 */
export async function listDonorRegister(): Promise<DonorRegister> {
  const { library, settings } = await getCurrentLibrary();

  const donations = await prisma.donation.findMany({
    where: { libraryId: library.id },
    select: {
      donorName: true,
      donorApartment: true,
      displayConsent: true,
      donatedAt: true,
    },
  });

  const byKey = new Map<string, DonorRegisterEntry>();
  const anonymousKeys = new Set<string>();

  for (const donation of donations) {
    const key = groupKey(donation);

    if (donation.displayConsent === "ANONYMOUS") {
      anonymousKeys.add(key);
      continue;
    }

    // The library's own calendar, not the server's. A gift recorded at 11pm in
    // Bengaluru belongs to that day, and to that year.
    const year = Number(formatInTimezone(donation.donatedAt, settings.timezone, "yyyy"));

    const existing = byKey.get(key);
    if (existing) {
      existing.bookCount += 1;
      existing.firstYear = Math.min(existing.firstYear, year);
      existing.lastYear = Math.max(existing.lastYear, year);
      continue;
    }

    const name = donation.displayConsent === "NAMED" ? donation.donorName.trim() : null;
    const apartment = donation.donorApartment?.trim() || null;

    byKey.set(key, {
      id: donorId(library.id, key),
      label: registerLabel({ name, apartment }),
      /*
       * The one line of this service that has to be right. APARTMENT_ONLY means
       * the flat and nothing else -- the name is not handed to the page and
       * then hidden by it, it never leaves this function.
       */
      name,
      apartment,
      bookCount: 1,
      firstYear: year,
      lastYear: year,
    });
  }

  const entries = [...byKey.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );

  return { entries, anonymousDonors: anonymousKeys.size };
}

/**
 * One family's gifts.
 *
 * The id is resolved by rebuilding the same grouping and matching the hash,
 * rather than by storing it. Nothing is written to hold this together, so
 * nothing can drift out of step with the register, and a link bookmarked a year
 * ago still resolves for as long as the gift is still recorded.
 *
 * An anonymous family has no page here, and asking for one by id is a plain
 * `NotFoundError` -- the same answer as an id that was never real. Anything
 * more specific would confirm that the hash belongs to somebody.
 */
export async function getDonorGifts(id: string): Promise<DonorRegisterDetail> {
  const { library, settings } = await getCurrentLibrary();

  const donations = await prisma.donation.findMany({
    where: { libraryId: library.id },
    select: {
      donorName: true,
      donorApartment: true,
      displayConsent: true,
      donatedAt: true,
      copy: {
        select: {
          copyCode: true,
          title: { select: { title: true, authors: true, coverMediaId: true } },
        },
      },
    },
    orderBy: [{ donatedAt: "asc" }],
  });

  let entry: DonorRegisterEntry | null = null;
  const gifts: DonorGift[] = [];

  for (const donation of donations) {
    if (donation.displayConsent === "ANONYMOUS") continue;

    const key = groupKey(donation);
    if (donorId(library.id, key) !== id) continue;

    const year = Number(formatInTimezone(donation.donatedAt, settings.timezone, "yyyy"));

    if (!entry) {
      const name = donation.displayConsent === "NAMED" ? donation.donorName.trim() : null;
      const apartment = donation.donorApartment?.trim() || null;
      entry = {
        id,
        label: registerLabel({ name, apartment }),
        name,
        apartment,
        bookCount: 0,
        firstYear: year,
        lastYear: year,
      };
    }
    entry.bookCount += 1;
    entry.firstYear = Math.min(entry.firstYear, year);
    entry.lastYear = Math.max(entry.lastYear, year);

    gifts.push({
      code: donation.copy.copyCode,
      title: donation.copy.title.title,
      authors: donation.copy.title.authors,
      coverMediaId: donation.copy.title.coverMediaId,
      givenAt: donation.donatedAt,
    });
  }

  if (!entry) throw new NotFoundError(`No donor register entry for ${id}`);

  return { entry, gifts };
}
