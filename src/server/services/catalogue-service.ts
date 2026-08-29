import "server-only";

import { Prisma, type AgeGroup, type BookCategory, type CopyCondition, type CopyStatus, type DonorDisplayConsent } from "@prisma/client";
import { z } from "zod";

import {
  AGE_GROUP_VALUES,
  CATALOGUE_LIMITS,
  CONDITION_VALUES,
  donorAcknowledgement,
  PAGE_SIZES,
  SELECTABLE_STATUSES,
  type Page,
} from "@/lib/catalogue";
import { dateOnlyInTimezone } from "@/lib/dates";
import { NO_RATINGS, type RatingSummary } from "@/lib/reviews";
import { prisma } from "@/server/db";
import {
  can,
  getActor,
  requireActor,
  requireAnyPermission,
  requirePermission,
  type Actor,
} from "@/server/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { allocateCopyCode } from "@/server/lib/codes";
import { NotFoundError, RuleViolationError, ValidationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import {
  claimUnclaimedBookCover,
  purgeScheduledMedia,
  scheduleMediaDeletion,
} from "@/server/services/media-service";
import { copyIsOnLoan } from "@/server/services/circulation-service";
import { borrowCountForTitle } from "@/server/services/circulation-service";
import { ratingForTitle } from "@/server/services/review-service";

/**
 * The catalogue.
 *
 * Two audiences, one collection:
 *
 *   * a librarian — who may well be a twelve-year-old volunteer — adding a book
 *     in about a minute, and correcting one later;
 *   * a child looking for something to read.
 *
 * Three rules shape everything below.
 *
 * **1. The physical book is the unit.** `book_title` is what the book *is*;
 * `book_copy` is the object on the shelf with a code stuck to it. They stay
 * separate, because three copies of The Jungle Book are three things that can
 * be borrowed and one thing that can be described. The forms are built around
 * copies, which is what a librarian actually holds.
 *
 * **2. Nothing is destroyed.** There is no delete. A book that is lost is LOST,
 * one beyond mending is DAMAGED, and one permanently gone from the shelf is
 * ARCHIVED — and its donation, its code and its history stay exactly where they
 * are. Somebody gave that book.
 *
 * **3. Circulation is not here.** Phase 2 records what the library owns. Issue,
 * return, renewal, due dates and overdue are Phase 3, and no code path in this
 * file creates a loan or moves a copy between AVAILABLE and BORROWED as a side
 * effect. A librarian may *set* a status, because the shelf existed before this
 * software did; that is a statement of fact, not a circulation workflow.
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Server-side validation, always. The dropdowns in the browser narrow what a
 * librarian can pick; they are not what makes an invalid value impossible.
 * Behind this there are database CHECK constraints and enums saying the same
 * thing again, because a service is code and code gets refactored.
 */
const bookInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "What is the book called?")
    .max(CATALOGUE_LIMITS.titleMax, `Please keep the title under ${CATALOGUE_LIMITS.titleMax} characters.`),
  author: z
    .string()
    .trim()
    .min(1, "Who wrote it?")
    .max(CATALOGUE_LIMITS.authorMax, `Please keep the author under ${CATALOGUE_LIMITS.authorMax} characters.`),
  categoryId: z.string().trim().min(1, "Please choose a shelf."),
  ageGroup: z.enum(AGE_GROUP_VALUES as [AgeGroup, ...AgeGroup[]], {
    message: "Please choose a reading age.",
  }),
  condition: z.enum(CONDITION_VALUES as [CopyCondition, ...CopyCondition[]], {
    message: "Please choose a condition.",
  }),
  /*
   * Optional as of Phase 3.
   *
   * BORROWED left `SELECTABLE_STATUSES` when circulation took ownership of it,
   * so the edit form for a book that is currently out has no status control at
   * all — there is nothing valid for it to offer, and a dropdown that could set
   * "Available" on a book in a child's bag is exactly the inconsistency Phase 3
   * exists to prevent. That form therefore submits no status, and this field
   * means "leave it as it is".
   */
  status: z
    .enum(SELECTABLE_STATUSES as unknown as [CopyStatus, ...CopyStatus[]], {
      message: "Please choose where this book is.",
    })
    .optional(),
  /*
   * Donation is voluntary — for the donor and for this form.
   *
   * A blank donor name means no donation record, which is the right answer for
   * a book the library bought or was handed anonymously at the desk. Nothing
   * about membership, borrowing or anything else ever depends on a donation
   * existing; recording one is only how the library says thank you.
   */
  donorName: z
    .string()
    .trim()
    .max(CATALOGUE_LIMITS.donorNameMax, "That name is too long.")
    .optional()
    .default(""),
  donorFlat: z
    .string()
    .trim()
    .max(CATALOGUE_LIMITS.donorFlatMax, "That looks too long for a flat number.")
    .optional()
    .default(""),
  donatedOn: z.string().trim().optional().default(""),
  /**
   * Ticked when this family asked us not to print their name.
   *
   * The default is to say thank you by name -- that is what the donors page is
   * for, and asking every family to opt in would leave it empty. So this is the
   * opt OUT, and the wording at the desk has to say that the name goes on a
   * public page unless somebody says otherwise.
   */
  donorAnonymous: z.coerce.boolean().optional().default(false),
  /** Media id of an already-uploaded, still-unclaimed cover. */
  coverMediaId: z.string().trim().optional().default(""),
});

export type BookInput = z.input<typeof bookInputSchema>;

function parseBookInput(input: BookInput) {
  const result = bookInputSchema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    throw new ValidationError(fieldErrors, "Book input failed validation");
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** What a librarian's table row needs. */
export interface StaffBookRow {
  copyId: string;
  copyCode: string;
  title: string;
  authors: string[];
  categoryName: string;
  categoryIcon: string | null;
  ageGroup: AgeGroup;
  condition: CopyCondition;
  status: CopyStatus;
  coverMediaId: string | null;
  donorName: string | null;
  donorApartment: string | null;
  donatedAt: Date | null;
  donorDisplayConsent: DonorDisplayConsent | null;
  archivedAt: Date | null;
  createdAt: Date;
}

/**
 * What a child's screen needs — and nothing else.
 *
 * No database ids, no audit fields, no storage keys, no staff notes, no donor
 * details beyond the acknowledgement the donor chose. This is a projection, not
 * a filtered render: a template cannot show a field that never left the server.
 */
export interface ReaderBookCard {
  /** The book's own code. Opaque to a child, and not a database id. */
  code: string;
  title: string;
  authors: string[];
  categoryName: string;
  categoryIcon: string | null;
  ageGroup: AgeGroup;
  status: CopyStatus;
  coverMediaId: string | null;
  /**
   * What readers made of it, averaged over every copy of the same work.
   *
   * Always present, never null: a book nobody has rated is `{average: 0,
   * count: 0}` rather than a missing field, so every card renders the same
   * shape and "no ratings yet" is a state rather than an absence.
   */
  rating: RatingSummary;
  /**
   * How many times this work has been borrowed, across every copy of it.
   *
   * A number and nothing else. No borrower, no dates, no loan ids — which child
   * read what is nobody's business but theirs, and a figure that cannot name
   * anyone is what makes this safe on a shelf a visitor can read signed out.
   *
   * Zero is a real value, not a missing one: the surfaces decide whether an
   * unborrowed book says so, and `borrowCountLabel` says it stays quiet.
   */
  borrowCount: number;
}

export interface ReaderBookDetail extends ReaderBookCard {
  /** Pre-rendered, already respecting the donor's own choice. Null when none. */
  donorAcknowledgement: string | null;
  /**
   * The work this copy is one of. Reviews hang off the work, so the page needs
   * it to ask for them — and it is the one internal id that leaves this
   * service. It identifies a book, never a person, and it is not in
   * `ReaderBookCard`, so no listing carries it.
   */
  titleId: string;
}

/**
 * Re-exported so that call sites and tests reading about the catalogue keep
 * importing from the catalogue. The definitions moved to `@/lib/catalogue` when
 * circulation needed them too — a pure function and a page shape do not belong
 * to one service, and leaving them here would have made the two services import
 * each other in a circle.
 */
export { donorAcknowledgement, type Page };

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * The gate on every reader-facing catalogue read.
 *
 * `catalogue_visibility` is a setting, not a constant, and defaults to
 * MEMBER_ONLY for this deployment — the owner's decision that the shelf stays
 * behind the front door. Reading it here rather than in each page means opening
 * the catalogue to the public later is one switch in the database.
 *
 * Members hold `book.view`; so does every staff role. A signed-in account with
 * neither is refused, which is what makes a suspended or role-less account
 * unable to browse.
 */
async function requireCatalogueAccess(): Promise<{ libraryId: string; actor: Actor | null }> {
  const { library, settings } = await getCurrentLibrary();

  if (settings.catalogueVisibility === "PUBLIC") {
    const actor = await getActor();
    return { libraryId: library.id, actor };
  }

  const actor = await requireActor();
  if (!actor.permissions.has("book.view")) {
    throw new NotFoundError(`User ${actor.userId} may not browse the catalogue`);
  }
  return { libraryId: actor.libraryId, actor };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** The shelves, in display order. Active ones only — a retired shelf is not a choice. */
export async function listCategories(libraryId?: string): Promise<BookCategory[]> {
  const resolved = libraryId ?? (await getCurrentLibrary()).library.id;
  return prisma.bookCategory.findMany({
    where: { libraryId: resolved, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

export interface CatalogueQuery {
  search?: string;
  categoryId?: string;
  ageGroup?: AgeGroup;
  condition?: CopyCondition;
  status?: CopyStatus;
  /** Staff only. A reader never sees an archived book at all. */
  includeArchived?: boolean;
  /**
   * Books added to the catalogue on or after this instant, and on or before
   * `addedTo`. Both are instants, not dates: the caller has already resolved a
   * day the librarian typed into the library's own timezone, because "books
   * added on Saturday" means Saturday in Bengaluru and not in UTC.
   */
  addedFrom?: Date;
  addedTo?: Date;
  sort?: CatalogueSort;
  page?: number;
  pageSize?: number;
}

export type CatalogueSort = "newest" | "title" | "author" | "code" | "loved" | "borrowed";

/**
 * Sort is chosen from a fixed list and never interpolated from user input.
 *
 * `Prisma.raw` does not escape anything, so the only safe way to use it is on a
 * value the user could not have supplied. That is what this map is: the request
 * picks a key, the key picks the SQL.
 */
const SORT_SQL: Record<CatalogueSort, Prisma.Sql> = {
  newest: Prisma.sql`c.created_at DESC, c.copy_code DESC`,
  title: Prisma.sql`lower(t.title) ASC, c.copy_code ASC`,
  author: Prisma.sql`book_title_authors_text(t.authors) ASC, lower(t.title) ASC`,
  code: Prisma.sql`c.copy_code ASC`,
  /*
   * Best loved first.
   *
   * `NULLS LAST` matters: a book nobody has rated has no average, and without
   * it PostgreSQL would sort every unrated book to the top of a list whose
   * whole purpose is the opposite. The count is the tie-break, so 5.0 from
   * eleven readers outranks 5.0 from one — otherwise the top of this list would
   * be whichever book happened to get a single enthusiastic review.
   */
  loved: Prisma.sql`r.rating_average DESC NULLS LAST, r.rating_count DESC, lower(t.title) ASC`,
  /*
   * Most borrowed first.
   *
   * Counted per work and not per copy, for the same reason the rating is: three
   * copies of one book are one book as far as "what is popular here" goes, and
   * a library that bought two copies of a title would otherwise push it up this
   * list for a reason that has nothing to do with children wanting it.
   *
   * Cancelled loans do not count — a loan that was issued by mistake and undone
   * the same minute is not evidence anybody read anything. Returned and still-out
   * loans both do.
   *
   * `coalesce` rather than `NULLS LAST`: a book nobody has borrowed has a real
   * answer, and it is zero.
   */
  borrowed: Prisma.sql`coalesce(l.loan_count, 0) DESC, lower(t.title) ASC`,
};

/**
 * Escapes a search term for LIKE.
 *
 * Prisma parameterises the value, so this is not about injection — it is about
 * a child typing "50%" and matching the entire catalogue. `%` and `_` are
 * wildcards and have to be neutralised before they are wrapped in wildcards of
 * ours.
 */
function likeTerm(search: string): string {
  const escaped = search.trim().toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`);
  return `%${escaped}%`;
}

function buildWhere(libraryId: string, query: CatalogueQuery): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`c.library_id = ${libraryId}`];

  if (!query.includeArchived) {
    clauses.push(Prisma.sql`c.status <> 'ARCHIVED'`);
  }

  if (query.search?.trim()) {
    const term = likeTerm(query.search);
    /*
     * Title, author and book code — the three things somebody actually knows
     * about a book they are looking for. Case-insensitive and partial, so
     * "jungle" finds The Jungle Book and "kipl" finds Kipling.
     *
     * Each side matches an expression index built in
     * prisma/sql/004_catalogue.sql, so this stays fast as the shelf grows.
     * Donor fields are deliberately absent: a donor's name is a thank-you, not
     * a search key, and nobody should be able to enumerate the catalogue by who
     * lives where.
     */
    clauses.push(Prisma.sql`(
      lower(t.title) LIKE ${term}
      OR book_title_authors_text(t.authors) LIKE ${term}
      OR lower(c.copy_code) LIKE ${term}
    )`);
  }

  // Inclusive at both ends. `addedTo` is the last instant of the chosen day,
  // so a single-day range covers that day rather than nothing at all.
  if (query.addedFrom) clauses.push(Prisma.sql`c.created_at >= ${query.addedFrom}`);
  if (query.addedTo) clauses.push(Prisma.sql`c.created_at <= ${query.addedTo}`);

  if (query.categoryId) clauses.push(Prisma.sql`t.category_id = ${query.categoryId}`);
  if (query.ageGroup) clauses.push(Prisma.sql`t.age_group = ${query.ageGroup}::"AgeGroup"`);
  if (query.condition) clauses.push(Prisma.sql`c.condition = ${query.condition}::"CopyCondition"`);
  if (query.status) clauses.push(Prisma.sql`c.status = ${query.status}::"CopyStatus"`);

  return Prisma.join(clauses, " AND ");
}

interface CopyRow {
  copy_id: string;
  copy_code: string;
  status: CopyStatus;
  condition: CopyCondition;
  archived_at: Date | null;
  created_at: Date;
  title: string;
  authors: string[];
  age_group: AgeGroup;
  cover_media_id: string | null;
  category_name: string;
  category_icon: string | null;
  donor_name: string | null;
  donor_apartment: string | null;
  donated_at: Date | null;
  display_consent: DonorDisplayConsent | null;
  /** Null when nobody has rated the work. Postgres returns numeric as string. */
  rating_average: string | number | null;
  rating_count: bigint;
  loan_count: bigint;
}

/**
 * One page of copies, filtered, sorted and counted in PostgreSQL.
 *
 * Raw SQL rather than the query builder for one reason: partial author search.
 * `authors` is a text[], and matching "kipl" inside an element needs
 * `book_title_authors_text(authors) LIKE ...` — both to be correct and to use
 * the trigram index. Every value is still parameterised by the tagged template;
 * the only interpolated fragments are the sort clauses above, which come from a
 * fixed map.
 */
async function queryCopies(
  libraryId: string,
  query: CatalogueQuery,
  pageSize: number,
): Promise<Page<CopyRow>> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const where = buildWhere(libraryId, query);
  const order = SORT_SQL[query.sort ?? "newest"];

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
      FROM book_copy c
      JOIN book_title t ON t.id = c.title_id
     WHERE ${where}
  `;

  const total = Number(count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A filter change can leave someone on page 7 of a 2-page result. Clamping
  // shows them the last page instead of an empty one with no way back.
  const safePage = Math.min(page, pageCount);

  const items = await prisma.$queryRaw<CopyRow[]>`
    SELECT c.id            AS copy_id,
           c.copy_code     AS copy_code,
           c.status        AS status,
           c.condition     AS condition,
           c.archived_at   AS archived_at,
           c.created_at    AS created_at,
           t.title         AS title,
           t.authors       AS authors,
           t.age_group     AS age_group,
           t.cover_media_id AS cover_media_id,
           cat.name        AS category_name,
           cat.icon        AS category_icon,
           d.donor_name    AS donor_name,
           d.donor_apartment AS donor_apartment,
           d.donated_at    AS donated_at,
           d.display_consent AS display_consent,
           r.rating_average AS rating_average,
           coalesce(r.rating_count, 0) AS rating_count,
           coalesce(l.loan_count, 0) AS loan_count
      FROM book_copy c
      JOIN book_title t ON t.id = c.title_id
      JOIN book_category cat ON cat.id = t.category_id
      LEFT JOIN donation d ON d.copy_id = c.id
      /*
       * The rating, aggregated per work rather than per copy — three copies of
       * the same book are one book as far as an opinion is concerned.
       *
       * A LATERAL against the indexed (library_id, title_id) rather than a
       * GROUP BY over the whole join: this runs once per row of the page, which
       * is twenty-four, and it leaves the outer query's shape and its ORDER BY
       * exactly as they were.
       *
       * PUBLISHED only. A review waiting for the desk moves no average and
       * appears in no count — the shelf must never hint that an opinion exists
       * before a guardian has read it.
       */
      LEFT JOIN LATERAL (
        SELECT avg(br.rating) AS rating_average,
               count(*)       AS rating_count
          FROM book_review br
         WHERE br.title_id = t.id
           AND br.status = 'PUBLISHED'
      ) r ON TRUE
      /*
       * How often this work has gone home, counted across every copy of it.
       *
       * Joined through book_copy rather than read off the copy in hand: the
       * question a reader is asking with "most borrowed" is about the book, and
       * the library's second copy of it should not split the answer in two.
       *
       * CANCELLED is excluded. An issue undone by the desk a minute later is a
       * correction, not a reading, and counting it would let a mistake make a
       * book look popular.
       *
       * No borrower, no dates, no loan ids leave this subquery — only a number.
       * Which child read what is nobody's business but theirs, and a count that
       * cannot name anyone is what makes this safe to show on a public shelf.
       */
      LEFT JOIN LATERAL (
        SELECT count(*) AS loan_count
          FROM loan ln
          JOIN book_copy lc ON lc.id = ln.copy_id
         WHERE lc.title_id = t.id
           AND ln.status <> 'CANCELLED'
      ) l ON TRUE
     WHERE ${where}
     ORDER BY ${order}
     LIMIT ${pageSize} OFFSET ${(safePage - 1) * pageSize}
  `;

  return { items, total, page: safePage, pageSize, pageCount };
}

// ---------------------------------------------------------------------------
// Reading — staff
// ---------------------------------------------------------------------------

/**
 * Permissions that mean "you help run the catalogue".
 *
 * Deliberately NOT `book.view`. Every reader holds `book.view` — it is what
 * lets a child browse the shelf — so guarding the desk screens with it would
 * let any nine-year-old open the librarian's book list, complete with donor
 * names and condition notes. The staff surfaces need a permission that only
 * someone managing the collection has.
 */
const CATALOGUE_MANAGEMENT = ["book.create", "book.edit", "book.archive"] as const;

/** The librarian's book list. */
export async function listBooksForStaff(query: CatalogueQuery = {}): Promise<Page<StaffBookRow>> {
  const actor = await requireAnyPermission(CATALOGUE_MANAGEMENT);
  const page = await queryCopies(actor.libraryId, query, query.pageSize ?? PAGE_SIZES.desk);

  return {
    ...page,
    items: page.items.map((row) => ({
      copyId: row.copy_id,
      copyCode: row.copy_code,
      title: row.title,
      authors: row.authors,
      categoryName: row.category_name,
      categoryIcon: row.category_icon,
      ageGroup: row.age_group,
      condition: row.condition,
      status: row.status,
      coverMediaId: row.cover_media_id,
      donorName: row.donor_name,
      donorApartment: row.donor_apartment,
      donatedAt: row.donated_at,
      donorDisplayConsent: row.display_consent,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    })),
  };
}

export interface StaffBookDetail extends StaffBookRow {
  titleId: string;
  categoryId: string;
}

/** One copy, for the edit form. */
export async function getBookForStaff(copyId: string): Promise<StaffBookDetail> {
  const actor = await requireAnyPermission(CATALOGUE_MANAGEMENT);

  const copy = await prisma.bookCopy.findFirst({
    where: { id: copyId, libraryId: actor.libraryId },
    select: {
      id: true,
      copyCode: true,
      status: true,
      condition: true,
      archivedAt: true,
      createdAt: true,
      title: {
        select: {
          id: true,
          title: true,
          authors: true,
          ageGroup: true,
          coverMediaId: true,
          category: { select: { id: true, name: true, icon: true } },
        },
      },
      donation: {
        select: {
          donorName: true,
          donorApartment: true,
          donatedAt: true,
          displayConsent: true,
        },
      },
    },
  });

  if (!copy) throw new NotFoundError(`Book copy ${copyId} not found in library ${actor.libraryId}`);

  return {
    copyId: copy.id,
    copyCode: copy.copyCode,
    titleId: copy.title.id,
    title: copy.title.title,
    authors: copy.title.authors,
    categoryId: copy.title.category.id,
    categoryName: copy.title.category.name,
    categoryIcon: copy.title.category.icon,
    ageGroup: copy.title.ageGroup,
    condition: copy.condition,
    status: copy.status,
    coverMediaId: copy.title.coverMediaId,
    donorName: copy.donation?.donorName ?? null,
    donorApartment: copy.donation?.donorApartment ?? null,
    donatedAt: copy.donation?.donatedAt ?? null,
    donorDisplayConsent: copy.donation?.displayConsent ?? null,
    archivedAt: copy.archivedAt,
    createdAt: copy.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Reading — readers
// ---------------------------------------------------------------------------

/**
 * The child-facing shelf.
 *
 * Archived books are absent, not marked absent: `includeArchived` is forced
 * false here rather than defaulted, so a query-string parameter cannot turn it
 * back on.
 */
export async function browseCatalogue(
  query: CatalogueQuery = {},
): Promise<Page<ReaderBookCard>> {
  const { libraryId } = await requireCatalogueAccess();

  const page = await queryCopies(
    libraryId,
    {
      search: query.search,
      categoryId: query.categoryId,
      ageGroup: query.ageGroup,
      sort: query.sort ?? "newest",
      page: query.page,
      includeArchived: false,
    },
    query.pageSize ?? PAGE_SIZES.reader,
  );

  return {
    ...page,
    items: page.items.map(toReaderCard),
  };
}

function toReaderCard(row: CopyRow): ReaderBookCard {
  return {
    code: row.copy_code,
    title: row.title,
    authors: row.authors,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    ageGroup: row.age_group,
    status: row.status,
    coverMediaId: row.cover_media_id,
    rating: toRatingSummary(row),
    borrowCount: Number(row.loan_count),
  };
}

/**
 * The two aggregate columns, as the shape every surface renders.
 *
 * `avg()` comes back from PostgreSQL as `numeric`, which the driver hands over
 * as a string rather than a number — `4.3333333333333333` — and `count()` comes
 * back as a bigint. Both would survive all the way to a template and fail there,
 * so they are converted once, here.
 */
function toRatingSummary(row: Pick<CopyRow, "rating_average" | "rating_count">): RatingSummary {
  const count = Number(row.rating_count);
  if (count === 0 || row.rating_average === null) return NO_RATINGS;
  return { average: Number(row.rating_average), count };
}

/**
 * One book, by its printed code.
 *
 * The child-facing URL carries the code on the book's own label, not a database
 * id — the thing a reader can read off the book in their hand.
 */
export async function getBookByCode(code: string): Promise<ReaderBookDetail> {
  const { libraryId } = await requireCatalogueAccess();

  const copy = await prisma.bookCopy.findFirst({
    where: {
      libraryId,
      copyCode: { equals: code.trim(), mode: "insensitive" },
      // Archived books are gone from the reader's world entirely.
      status: { not: "ARCHIVED" },
    },
    select: {
      copyCode: true,
      status: true,
      titleId: true,
      title: {
        select: {
          title: true,
          authors: true,
          ageGroup: true,
          coverMediaId: true,
          category: { select: { name: true, icon: true } },
        },
      },
      donation: {
        select: { donorName: true, donorApartment: true, displayConsent: true },
      },
    },
  });

  if (!copy) throw new NotFoundError(`No book with code ${code} in library ${libraryId}`);

  return {
    code: copy.copyCode,
    title: copy.title.title,
    authors: copy.title.authors,
    categoryName: copy.title.category.name,
    categoryIcon: copy.title.category.icon,
    ageGroup: copy.title.ageGroup,
    status: copy.status,
    coverMediaId: copy.title.coverMediaId,
    donorAcknowledgement: donorAcknowledgement(copy.donation),
    titleId: copy.titleId,
    /*
     * Two small queries rather than one large one. This page reads a single
     * copy through Prisma; the shelf reads twenty-four rows of raw SQL with
     * both aggregates lateral-joined. Sharing a code path between them would
     * mean rewriting one of the two into the other's shape for no gain a reader
     * would notice on a page that is already one round trip from the database.
     *
     * What must not differ is the rule, and it does not: both count PUBLISHED
     * reviews, and both count loans across every copy of the work with
     * CANCELLED excluded. `tests/database/catalogue.test.ts` pins the pair
     * together against the same fixture.
     */
    rating: await ratingForTitle(copy.titleId),
    borrowCount: await borrowCountForTitle(copy.titleId),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface CreatedBook {
  copyId: string;
  copyCode: string;
  title: string;
  /** False when this joined an existing title as a second physical copy. */
  createdNewTitle: boolean;
}

/**
 * Adds one physical book.
 *
 * The librarian fills in one form and gets one book. Underneath, that is either
 * a new `book_title` plus its first `book_copy`, or a second `book_copy` on a
 * title the library already has — decided by matching title and author, so that
 * three copies of The Jungle Book really are three copies of one book rather
 * than three unrelated records that happen to share a name.
 *
 * When an existing title is reused, its category, reading age and cover are
 * left exactly as they are. The bibliographic record belongs to the book, not
 * to whoever happened to catalogue the newest copy; the return value says which
 * happened so the screen can tell the librarian.
 */
export async function createBook(input: BookInput): Promise<CreatedBook> {
  const actor = await requirePermission("book.create");
  const parsed = parseBookInput(input);
  const { settings } = await getCurrentLibrary();

  const category = await requireCategory(actor.libraryId, parsed.categoryId);
  const donatedAt = parseDonationDate(parsed.donatedOn, settings.timezone);
  const hasDonor = parsed.donorName.length > 0;

  const created = await prisma.$transaction(async (tx) => {
    const existingTitle = await findMatchingTitle(tx, actor.libraryId, parsed.title, parsed.author);

    const titleId =
      existingTitle?.id ??
      (
        await tx.bookTitle.create({
          data: {
            libraryId: actor.libraryId,
            title: parsed.title,
            authors: [parsed.author],
            ageGroup: parsed.ageGroup,
            categoryId: category.id,
            createdById: actor.userId,
          },
          select: { id: true },
        })
      ).id;

    if (!existingTitle) {
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BOOK_TITLE_CREATED,
        entityType: "book_title",
        entityId: titleId,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: {
          title: parsed.title,
          author: parsed.author,
          category: category.name,
          ageGroup: parsed.ageGroup,
        },
      });
    }

    // Cover claimed inside the transaction that links it, so "attached" and
    // "kept" commit together. See docs/MEDIA.md.
    if (parsed.coverMediaId) {
      await claimUnclaimedBookCover(tx, {
        mediaId: parsed.coverMediaId,
        libraryId: actor.libraryId,
      });
      await tx.bookTitle.update({
        where: { id: titleId },
        data: { coverMediaId: parsed.coverMediaId },
      });
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BOOK_COVER_ADDED,
        entityType: "book_title",
        entityId: titleId,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { mediaId: parsed.coverMediaId },
      });
    }

    /*
     * The code is allocated inside the transaction on purpose: a failure
     * anywhere below rolls the reservation back rather than burning a number,
     * and the allocator's single atomic UPDATE means two librarians cataloguing
     * at the same desk cannot be handed the same one. See server/lib/codes.ts.
     */
    const copyCode = await allocateCopyCode(
      tx,
      actor.libraryId,
      settings.copyCodePrefix,
      settings.copyCodePadding,
    );

    const copy = await tx.bookCopy.create({
      data: {
        libraryId: actor.libraryId,
        titleId,
        copyCode,
        // A brand new copy is on the shelf unless the librarian says otherwise,
        // and "otherwise" can no longer be BORROWED: a book cannot be catalogued
        // as already lent, because there would be nobody it was lent to.
        status: parsed.status ?? "AVAILABLE",
        condition: parsed.condition,
        acquisitionType: hasDonor ? "RESIDENT_DONATION" : "PURCHASE",
      },
      select: { id: true, copyCode: true },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COPY_CREATED,
      entityType: "book_copy",
      entityId: copy.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        copyCode: copy.copyCode,
        title: parsed.title,
        status: parsed.status,
        condition: parsed.condition,
      },
    });

    if (hasDonor) {
      await tx.donation.create({
        data: {
          libraryId: actor.libraryId,
          copyId: copy.id,
          donorName: parsed.donorName,
          donorApartment: parsed.donorFlat || null,
          donatedAt,
          // The library's configured default unless the family asked us not to
          // print their name, which the intake form asks in as many words.
          displayConsent: resolveDisplayConsent(
            parsed.donorAnonymous,
            null,
            settings.donorDisplayDefault,
          ),
          recordedById: actor.userId,
        },
      });

      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.DONATION_RECORDED,
        entityType: "book_copy",
        entityId: copy.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        // The name and flat are the donation. No contact details exist to leak.
        metadata: {
          donorName: parsed.donorName,
          donorApartment: parsed.donorFlat || null,
          anonymous: parsed.donorAnonymous,
        },
      });
    }

    return {
      copyId: copy.id,
      copyCode: copy.copyCode,
      title: parsed.title,
      createdNewTitle: !existingTitle,
    };
  });

  return created;
}

/**
 * Edits one physical book.
 *
 * Title-level fields (title, author, shelf, reading age, cover) belong to the
 * `book_title` and therefore change for every copy of that book — which is
 * correct, and is why the screen says so. Copy-level fields (condition, status)
 * and the donation belong to this object alone.
 */
export async function updateBook(copyId: string, input: BookInput): Promise<{ copyCode: string }> {
  const actor = await requirePermission("book.edit");
  const parsed = parseBookInput(input);
  const { settings } = await getCurrentLibrary();

  const category = await requireCategory(actor.libraryId, parsed.categoryId);
  const donatedAt = parseDonationDate(parsed.donatedOn, settings.timezone);

  const existing = await prisma.bookCopy.findFirst({
    where: { id: copyId, libraryId: actor.libraryId },
    select: {
      id: true,
      copyCode: true,
      status: true,
      condition: true,
      title: { select: { id: true, title: true, authors: true, ageGroup: true, categoryId: true, coverMediaId: true } },
      donation: {
        select: { id: true, donorName: true, donorApartment: true, displayConsent: true },
      },
    },
  });

  if (!existing) throw new NotFoundError(`Book copy ${copyId} not found in library ${actor.libraryId}`);

  if (existing.status === "ARCHIVED") {
    throw new RuleViolationError(
      `Refusing to edit archived copy ${copyId}`,
      "This book has been archived. Bring it back to the shelf first if you need to change it.",
    );
  }

  /*
   * Circulation owns AVAILABLE ↔ BORROWED, so the catalogue may not move a
   * book that is out.
   *
   * The database says the same thing and says it harder — the constraint
   * trigger in 005_circulation.sql would refuse the transaction outright. This
   * check exists so the librarian gets a sentence about the desk rather than a
   * Postgres exception, and so bibliographic edits (title, author, shelf,
   * cover) still work perfectly well on a book that happens to be in a bag.
   */
  const onLoan = await copyIsOnLoan(existing.id);
  if (onLoan && parsed.status && parsed.status !== existing.status) {
    throw new RuleViolationError(
      `Refusing to change status of copy ${copyId} while it has an active loan`,
      "This book is out with a reader. Take it back at the desk to change where it is.",
    );
  }

  const previousCoverId = existing.title.coverMediaId;
  const coverChanged = Boolean(parsed.coverMediaId) && parsed.coverMediaId !== previousCoverId;

  await prisma.$transaction(async (tx) => {
    await tx.bookTitle.update({
      where: { id: existing.title.id },
      data: {
        title: parsed.title,
        authors: [parsed.author],
        ageGroup: parsed.ageGroup,
        categoryId: category.id,
        ...(coverChanged ? { coverMediaId: parsed.coverMediaId } : {}),
      },
    });

    if (coverChanged) {
      // Same commit as the re-point, so either both happened or neither did.
      // The old object's bytes are chased afterwards; the sweeper is the net.
      await claimUnclaimedBookCover(tx, {
        mediaId: parsed.coverMediaId,
        libraryId: actor.libraryId,
      });
      if (previousCoverId) await scheduleMediaDeletion(tx, previousCoverId);

      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: previousCoverId ? AUDIT_ACTIONS.BOOK_COVER_REPLACED : AUDIT_ACTIONS.BOOK_COVER_ADDED,
        entityType: "book_title",
        entityId: existing.title.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { mediaId: parsed.coverMediaId, previousMediaId: previousCoverId ?? null },
      });
    }

    if (existing.title.categoryId !== category.id) {
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BOOK_CATEGORY_CHANGED,
        entityType: "book_title",
        entityId: existing.title.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { from: existing.title.categoryId, to: category.id, categoryName: category.name },
      });
    }

    await tx.bookCopy.update({
      where: { id: existing.id },
      // An omitted status means "unchanged", which is what the edit form for a
      // borrowed book submits.
      data: { status: parsed.status ?? existing.status, condition: parsed.condition },
    });

    if (parsed.status && existing.status !== parsed.status) {
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BOOK_COPY_STATUS_CHANGED,
        entityType: "book_copy",
        entityId: existing.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { copyCode: existing.copyCode, from: existing.status, to: parsed.status },
      });
    }

    if (existing.condition !== parsed.condition) {
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.BOOK_COPY_CONDITION_CHANGED,
        entityType: "book_copy",
        entityId: existing.id,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: { copyCode: existing.copyCode, from: existing.condition, to: parsed.condition },
      });
    }

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COPY_UPDATED,
      entityType: "book_copy",
      entityId: existing.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: existing.copyCode, title: parsed.title },
    });

    await upsertDonation(tx, {
      actor,
      copyId: existing.id,
      copyCode: existing.copyCode,
      existingDonationId: existing.donation?.id ?? null,
      previousDonorName: existing.donation?.donorName ?? null,
      previousDonorApartment: existing.donation?.donorApartment ?? null,
      previousDisplayConsent: existing.donation?.displayConsent ?? null,
      donorName: parsed.donorName,
      donorFlat: parsed.donorFlat,
      donorAnonymous: parsed.donorAnonymous,
      donatedAt,
      defaultDisplayConsent: settings.donorDisplayDefault,
    });
  });

  if (coverChanged && previousCoverId) await purgeScheduledMedia(previousCoverId);

  // Returned so the screen can name the book it just saved without asking for
  // it again. The code was already loaded to do the work.
  return { copyCode: existing.copyCode };
}

/**
 * Removes a book's cover picture, leaving the book itself alone.
 *
 * A cover belongs to the title, so this affects every copy of that book — which
 * is the same rule as changing its author, and the screen says so.
 */
export async function removeBookCover(copyId: string): Promise<void> {
  const actor = await requirePermission("book.edit");

  const copy = await prisma.bookCopy.findFirst({
    where: { id: copyId, libraryId: actor.libraryId },
    select: { id: true, copyCode: true, title: { select: { id: true, coverMediaId: true } } },
  });

  if (!copy) throw new NotFoundError(`Book copy ${copyId} not found in library ${actor.libraryId}`);

  const coverId = copy.title.coverMediaId;
  if (!coverId) return; // Already the desired end state.

  await prisma.$transaction(async (tx) => {
    await tx.bookTitle.update({
      where: { id: copy.title.id },
      data: { coverMediaId: null },
    });
    await scheduleMediaDeletion(tx, coverId);
    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COVER_REMOVED,
      entityType: "book_title",
      entityId: copy.title.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      // The object's id, never its storage key.
      metadata: { mediaId: coverId, copyCode: copy.copyCode },
    });
  });

  await purgeScheduledMedia(coverId);
}

/**
 * Takes a book permanently off the shelf.
 *
 * Not a delete, and there is no delete. The copy keeps its code, its donation,
 * its condition and every audit row that mentions it; it simply stops being
 * part of the collection. Somebody gave that book, and erasing the record would
 * erase the gift along with it.
 *
 * Reversible by design — `restoreBook` puts it back — because "archived by
 * mistake" is a thing that happens at a busy desk.
 */
export async function archiveBook(copyId: string, reason?: string): Promise<void> {
  const actor = await requirePermission("book.archive");

  const copy = await prisma.bookCopy.findFirst({
    where: { id: copyId, libraryId: actor.libraryId },
    select: { id: true, copyCode: true, status: true },
  });

  if (!copy) throw new NotFoundError(`Book copy ${copyId} not found in library ${actor.libraryId}`);
  if (copy.status === "ARCHIVED") return;

  // A book cannot leave the collection while a child has it. Taking it back is
  // the first step, and it is a step somebody has to physically perform.
  if (await copyIsOnLoan(copy.id)) {
    throw new RuleViolationError(
      `Refusing to archive copy ${copyId} while it has an active loan`,
      "This book is out with a reader. Take it back at the desk before archiving it.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.bookCopy.update({
      where: { id: copy.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COPY_ARCHIVED,
      entityType: "book_copy",
      entityId: copy.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        copyCode: copy.copyCode,
        previousStatus: copy.status,
        reason: reason?.trim().slice(0, CATALOGUE_LIMITS.archiveReasonMax) || undefined,
      },
    });
  });
}

/**
 * Erases a book that should never have been here.
 *
 * **The only permanent deletion in this application, and it is the Super
 * Admin's alone** — `book.delete` is held by no other role. Everything a
 * librarian needs in order to fix a mistake is reversible: edit the details,
 * archive the copy, restore it again.
 *
 * It exists for one situation, which is real and common: somebody typed the
 * same book in twice, or catalogued a book that was never given. A duplicate is
 * not history — it is a row that was never true — and archiving it would leave
 * a permanent ARCHIVED entry recording a book the library never had.
 *
 * So the rule is drawn around history rather than around status: **a copy that
 * anything has ever happened to cannot be deleted.** One loan, ever, and this
 * refuses and says to archive it instead. A donation is history too — somebody
 * gave that book, and the gift outlives the object. What is left deletable is
 * exactly the set of rows that record nothing: catalogued, never lent, never
 * given, never asked for.
 *
 * The deletion itself is audited, with the code and title in the row, so the
 * library's account of what was removed survives the thing that was removed.
 */
export async function deleteBook(copyId: string, reason: string): Promise<{ copyCode: string }> {
  const actor = await requirePermission("book.delete");

  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ValidationError(
      { reason: "Please note why, for the library's records." },
      "Book deletion attempted without a reason",
    );
  }

  const copy = await prisma.bookCopy.findFirst({
    where: { id: copyId, libraryId: actor.libraryId },
    select: {
      id: true,
      copyCode: true,
      status: true,
      title: { select: { id: true, title: true } },
      _count: { select: { loans: true, borrowRequests: true } },
      donation: { select: { id: true } },
    },
  });

  if (!copy) throw new NotFoundError(`Book copy ${copyId} not found in library ${actor.libraryId}`);

  const history: string[] = [];
  if (copy._count.loans > 0) history.push("it has been borrowed");
  if (copy._count.borrowRequests > 0) history.push("a reader has asked for it");
  if (copy.donation) history.push("it was given to the library");

  if (history.length > 0) {
    await recordAudit(prisma, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COPY_DELETE_REFUSED,
      entityType: "book_copy",
      entityId: copy.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: copy.copyCode, because: history },
    }).catch(() => undefined);

    throw new RuleViolationError(
      `Refusing to delete copy ${copy.copyCode}: ${history.join(", ")}`,
      `This book has a history — ${history.join(", and ")}. Archive it instead, so the record stays.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Audited first, inside the transaction: the row that says what was removed
    // must be written by the same commit that removes it.
    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COPY_DELETED,
      entityType: "book_copy",
      entityId: copy.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        copyCode: copy.copyCode,
        title: copy.title.title,
        previousStatus: copy.status,
        reason: trimmed.slice(0, CATALOGUE_LIMITS.archiveReasonMax),
      },
    });

    await tx.bookCopy.delete({ where: { id: copy.id } });

    // A title with no copies left is a shelf label for a book the library does
    // not have. Removed only when this was its last copy, and never when other
    // copies survive.
    const remaining = await tx.bookCopy.count({ where: { titleId: copy.title.id } });
    if (remaining === 0) {
      await tx.bookTitle.delete({ where: { id: copy.title.id } });
    }
  });

  return { copyCode: copy.copyCode };
}

/** Puts an archived copy back on the shelf, as AVAILABLE. */
export async function restoreBook(copyId: string): Promise<void> {
  const actor = await requirePermission("book.archive");

  const copy = await prisma.bookCopy.findFirst({
    where: { id: copyId, libraryId: actor.libraryId },
    select: { id: true, copyCode: true, status: true },
  });

  if (!copy) throw new NotFoundError(`Book copy ${copyId} not found in library ${actor.libraryId}`);
  if (copy.status !== "ARCHIVED") return;

  await prisma.$transaction(async (tx) => {
    await tx.bookCopy.update({
      where: { id: copy.id },
      // archived_at must go with the status — a CHECK constraint requires the
      // two to agree in both directions.
      data: { status: "AVAILABLE", archivedAt: null },
    });

    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: AUDIT_ACTIONS.BOOK_COPY_STATUS_CHANGED,
      entityType: "book_copy",
      entityId: copy.id,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: { copyCode: copy.copyCode, from: "ARCHIVED", to: "AVAILABLE" },
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/**
 * Resolves a category id, and refuses one belonging to another library or one
 * that has been retired.
 *
 * The dropdown only ever offers valid ones; this is what makes a hand-crafted
 * form submission fail too. The `libraryId` comes from the session, never from
 * the request, so a category id from another community resolves to nothing.
 */
async function requireCategory(libraryId: string, categoryId: string): Promise<BookCategory> {
  const category = await prisma.bookCategory.findFirst({
    where: { id: categoryId, libraryId, isActive: true },
  });

  if (!category) {
    throw new ValidationError(
      { categoryId: "Please choose a shelf from the list." },
      `Category ${categoryId} is not an active category of library ${libraryId}`,
    );
  }
  return category;
}

/**
 * Finds an existing title with the same name and author, case-insensitively.
 *
 * Matching on both is deliberate: two different books can share a title, and a
 * silent merge would attach a copy of the wrong book to a record. Author is the
 * cheapest disambiguator a librarian has already typed.
 */
async function findMatchingTitle(
  tx: Tx,
  libraryId: string,
  title: string,
  author: string,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id
      FROM book_title
     WHERE library_id = ${libraryId}
       AND lower(title) = ${title.toLowerCase()}
       AND book_title_authors_text(authors) = ${author.toLowerCase()}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Turns the date picker's value into an instant.
 *
 * Empty means today, which is what the form pre-fills anyway — a book being
 * catalogued now was almost always donated now. "Today" is computed in the
 * library's timezone, so a server in another part of the world does not shift
 * the date by one.
 */
function parseDonationDate(value: string, timezone: string): Date {
  if (!value) return new Date();

  const parsed = dateOnlyInTimezone(value, timezone);
  if (!parsed) {
    throw new ValidationError(
      { donatedOn: "That does not look like a date. Please pick one from the calendar." },
      `Unparseable donation date: ${value}`,
    );
  }

  // One day of slack for the library being ahead of the server's clock. The
  // database CHECK says the same thing; this is the version with a sentence a
  // librarian can act on.
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new ValidationError(
      { donatedOn: "That date is in the future. Please pick today or a day already past." },
      `Donation date in the future: ${value}`,
    );
  }
  return parsed;
}

/**
 * What to store in `display_consent` after this save.
 *
 * Ticked is unambiguous: ANONYMOUS. Unticked is the part that needs care --
 * it must NOT mean "reset to the library default", because a family already
 * recorded as APARTMENT_ONLY would have their name published by a librarian who
 * opened the form to fix a typo and saved it. Unticked therefore keeps whatever
 * non-anonymous choice is already on record, and only falls back to the default
 * when there is nothing to keep. Unticking an anonymous donation is the one way
 * a name comes back, which is the deliberate act it should be.
 */
function resolveDisplayConsent(
  anonymous: boolean,
  previous: DonorDisplayConsent | null,
  fallback: DonorDisplayConsent,
): DonorDisplayConsent {
  if (anonymous) return "ANONYMOUS";
  if (previous && previous !== "ANONYMOUS") return previous;
  return fallback;
}

/** Creates, updates or removes the donation attached to one copy. */
async function upsertDonation(
  tx: Tx,
  params: {
    actor: Actor;
    copyId: string;
    copyCode: string;
    existingDonationId: string | null;
    previousDonorName: string | null;
    previousDonorApartment: string | null;
    previousDisplayConsent: DonorDisplayConsent | null;
    donorName: string;
    donorFlat: string;
    donorAnonymous: boolean;
    donatedAt: Date;
    defaultDisplayConsent: DonorDisplayConsent;
  },
): Promise<void> {
  const { actor } = params;
  const hasDonor = params.donorName.length > 0;
  const displayConsent = resolveDisplayConsent(
    params.donorAnonymous,
    params.previousDisplayConsent,
    params.defaultDisplayConsent,
  );
  const changed =
    params.previousDonorName !== (hasDonor ? params.donorName : null) ||
    params.previousDonorApartment !== (params.donorFlat || null) ||
    // A family who asks to be taken off the page has changed the donation as
    // surely as a corrected spelling, and the audit log has to say so.
    (params.previousDisplayConsent !== null && params.previousDisplayConsent !== displayConsent);

  if (!hasDonor) {
    /*
     * Clearing the donor name removes the credit.
     *
     * This is the one place the catalogue deletes anything, and it is right:
     * the alternative is a permanent thank-you to somebody who did not give the
     * book, usually because a name was typed into the wrong row. The audit log
     * keeps what was there.
     */
    if (params.existingDonationId) {
      await tx.donation.delete({ where: { id: params.existingDonationId } });
      await recordAudit(tx, {
        libraryId: actor.libraryId,
        action: AUDIT_ACTIONS.DONATION_UPDATED,
        entityType: "book_copy",
        entityId: params.copyId,
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
        metadata: {
          copyCode: params.copyCode,
          removed: true,
          previousDonorName: params.previousDonorName,
        },
      });
    }
    return;
  }

  if (params.existingDonationId) {
    await tx.donation.update({
      where: { id: params.existingDonationId },
      data: {
        donorName: params.donorName,
        donorApartment: params.donorFlat || null,
        donatedAt: params.donatedAt,
        displayConsent,
      },
    });
  } else {
    await tx.donation.create({
      data: {
        libraryId: actor.libraryId,
        copyId: params.copyId,
        donorName: params.donorName,
        donorApartment: params.donorFlat || null,
        donatedAt: params.donatedAt,
        displayConsent,
        recordedById: actor.userId,
      },
    });
  }

  if (changed) {
    await recordAudit(tx, {
      libraryId: actor.libraryId,
      action: params.existingDonationId
        ? AUDIT_ACTIONS.DONATION_UPDATED
        : AUDIT_ACTIONS.DONATION_RECORDED,
      entityType: "book_copy",
      entityId: params.copyId,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      metadata: {
        copyCode: params.copyCode,
        donorName: params.donorName,
        donorApartment: params.donorFlat || null,
        anonymous: displayConsent === "ANONYMOUS",
      },
    });
  }
}

/** Whether the current viewer may see the real donor behind an anonymous credit. */
export async function canSeePrivateDonors(): Promise<boolean> {
  return can(await getActor(), "donation.view_private");
}
