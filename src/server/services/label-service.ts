import "server-only";

import {
  bookFilterParams,
  describeBookFilter,
  EMPTY_BOOK_FILTER,
  type BookFilter,
} from "@/lib/book-filter";
import { ageGroupLabel, donorLabelCredit } from "@/lib/catalogue";
import { dateOnlyInTimezone, formatInTimezone } from "@/lib/dates";
import { MAX_LABELS, labelFilename, type LabelSize } from "@/lib/labels";
import { requirePermission } from "@/server/authz";
import { prisma } from "@/server/db";
import { AUDIT_ACTIONS, recordAudit } from "@/server/lib/audit";
import { RuleViolationError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import { buildLabelSheet } from "@/server/reports/label-sheet";
import {
  bookFilterToQuery,
  listBooksForStaff,
  listCategories,
} from "@/server/services/catalogue-service";

/**
 * Printing shelf labels.
 *
 * Two permissions have to hold, on the same rule as the report exports:
 *
 *  1. `report.view` — may this person take something printable out of the
 *     building at all. Checked here.
 *  2. whatever the books screen already demands. Checked by
 *     `listBooksForStaff`, which is the same call the screen makes and refuses
 *     independently of who is asking it or why.
 *
 * Neither is restated and neither is sufficient alone. A label sheet is a
 * catalogue extract in a different shape, and it must never become the way
 * somebody prints a list they were not allowed to open.
 *
 * Nothing about a reader is on a label — no borrower, no loan, no member code.
 * The one personal thing that is on it is the donor's credit, and it is there
 * on the donor's own terms: `donorLabelCredit` reads the consent recorded at
 * intake, and a family who asked for their flat only, or for nothing at all,
 * gets exactly that printed. Everything else — the code, the title, the shelf,
 * the reading age — is already on the public shelf. That is what still makes
 * this the one export that can be left lying on the desk.
 */

export interface LabelRequest {
  /**
   * Which books, in the same words the book list uses.
   *
   * The same filter object both screens read, so a sheet of labels is the list
   * the librarian was looking at and not a second, similar idea of it. Days
   * arrive as typed `yyyy-mm-dd` and are resolved here, where the library's
   * timezone is known.
   */
  filter: BookFilter;
  size: LabelSize;
  cutGuides: boolean;
  /** Ticked rows from the books screen. Empty means everything the filter finds. */
  selectedIds: string[];
}

export interface LabelFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
  labelCount: number;
  sheetCount: number;
}

/**
 * What this sheet is a sheet of, for its own footer.
 *
 * A page of stickers outlives the screen that made it. Somebody holding one a
 * week later should be able to read what it was printed for without having to
 * remember which filters were on.
 */
function describeScope(
  filter: BookFilter,
  timezone: string,
  categoryName: string | undefined,
  selectedCount: number,
): string {
  if (selectedCount > 0) return `${selectedCount} chosen ${selectedCount === 1 ? "book" : "books"}`;

  return describeBookFilter(filter, {
    categoryName,
    formatDay: (day) => {
      const parsed = dateOnlyInTimezone(day, timezone);
      return parsed ? formatInTimezone(parsed, timezone, "d MMM yyyy") : day;
    },
  });
}

export async function printBookLabels(request: LabelRequest): Promise<LabelFile> {
  const actor = await requirePermission("report.view");
  const { library, settings } = await getCurrentLibrary();

  /*
   * Archived copies are left out and there is no switch to include them — the
   * filter's own `includeArchived` is overruled here rather than trusted. A
   * label exists to be stuck to a book that is on the shelf; a sheet of
   * stickers for books that have been withdrawn is waste at best and a
   * mislabelled shelf at worst.
   *
   * Sorted by code so the sheet comes off the printer in the order the books
   * sit in a pile — which is the order somebody works through them.
   */
  const page = await listBooksForStaff({
    ...bookFilterToQuery(request.filter, settings.timezone),
    includeArchived: false,
    sort: "code",
    page: 1,
    pageSize: MAX_LABELS + 1,
  });

  const selected = new Set(request.selectedIds);
  const rows =
    selected.size === 0 ? page.items : page.items.filter((row) => selected.has(row.copyId));

  if (rows.length > MAX_LABELS) {
    throw new RuleViolationError(
      `Label run of ${rows.length} exceeds the ${MAX_LABELS} label limit`,
      `That is more than ${MAX_LABELS} labels at once. Narrow it down and print in batches.`,
    );
  }

  // Looked up only when a shelf was chosen, and only so the sheet's own footer
  // can name it. A filter carries an id; a person reads a word.
  const categoryName = request.filter.categoryId
    ? (await listCategories(actor.libraryId)).find(
        (category) => category.id === request.filter.categoryId,
      )?.name
    : undefined;

  const generatedAt = new Date();

  const sheet = await buildLabelSheet({
    /*
     * The shelf and the age are turned into words here, not in the PDF writer.
     * `ageGroupLabel` is the catalogue's own vocabulary and there is exactly one
     * copy of it — a renderer that knew what `AGE_8_11` meant would be a second.
     */
    rows: rows.map((row) => {
      /*
       * Keyed off the consent, not off the name. A row with a donor name but no
       * recorded choice is not a donation this may credit — and because the
       * column is only ever null when there is no donation at all, guarding on
       * it costs nothing and closes the case where that stops being true.
       */
      const credit = donorLabelCredit(
        row.donorDisplayConsent
          ? {
              donorName: row.donorName ?? "",
              donorApartment: row.donorApartment,
              displayConsent: row.donorDisplayConsent,
            }
          : null,
        // The month is resolved here because a month is a fact about a calendar
        // somewhere, and only the library knows which one.
        row.donatedAt ? formatInTimezone(row.donatedAt, settings.timezone, "MMM yyyy") : null,
      );

      return {
        code: row.copyCode,
        title: row.title,
        shelf: row.categoryName,
        age: ageGroupLabel(row.ageGroup),
        donor: credit?.credit ?? "",
        donatedOn: credit?.when ?? "",
      };
    }),
    size: request.size,
    // Read from settings, never written as a literal — the lint rule that keeps
    // this library's name out of `src/` applies here as much as anywhere.
    libraryName: library.name,
    scopeLabel: describeScope(request.filter, settings.timezone, categoryName, selected.size),
    generatedAt,
    cutGuides: request.cutGuides,
  });

  /*
   * Logged after the file exists, so a failed render is not recorded as a print
   * that never happened.
   *
   * Which filters were used, never what was typed into them. No book codes, no
   * titles, and above all no donor name or flat: a librarian may now print
   * "everything the Nairs gave", and the audit log must not become the place
   * that quietly records who searched for which family.
   */
  await recordAudit(prisma, {
    libraryId: actor.libraryId,
    action: AUDIT_ACTIONS.BOOK_LABELS_PRINTED,
    entityType: "book_label_sheet",
    entityId: null,
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    metadata: {
      labelCount: rows.length,
      sheetCount: sheet.sheetCount,
      size: request.size,
      scope: selected.size === 0 ? "filter" : "selection",
      filters: Object.keys(bookFilterParams(request.filter)).sort(),
    },
  });

  return {
    filename: labelFilename(library.name, generatedAt),
    contentType: "application/pdf",
    bytes: sheet.bytes,
    labelCount: rows.length,
    sheetCount: sheet.sheetCount,
  };
}

/**
 * How many labels a given filter would produce, for the screen to say so before
 * anybody spends a sheet of paper.
 *
 * Same query, same authorisation, no PDF and no audit entry — counting what you
 * are allowed to see is not a disclosure, and a page that logged an export
 * every time somebody changed a date would make the audit log useless.
 */
export async function countBookLabels(filter: BookFilter = EMPTY_BOOK_FILTER): Promise<number> {
  await requirePermission("report.view");
  const { settings } = await getCurrentLibrary();

  const page = await listBooksForStaff({
    ...bookFilterToQuery(filter, settings.timezone),
    includeArchived: false,
    sort: "code",
    page: 1,
    pageSize: 1,
  });

  return page.total;
}
