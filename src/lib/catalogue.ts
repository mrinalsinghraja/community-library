import type { AgeGroup, CopyCondition, CopyStatus, DonorDisplayConsent } from "@prisma/client";

/**
 * The catalogue's vocabulary, in one place.
 *
 * Every dropdown, badge, filter and label in the application is rendered from
 * this file. Nothing anywhere parses "8–10 years" back into numbers, and no
 * component owns a private copy of the word "Damaged".
 *
 * Isomorphic on purpose (no `server-only`): the seed, the services, the React
 * components and the tests all read the same lists, so a value that exists in
 * one place exists in all of them.
 *
 * Version 1 is deliberately small. Before adding anything here, the question in
 * docs/CATALOGUE.md applies: does it help a child find a book, or a librarian
 * manage the physical collection? If not, it does not belong in Version 1.
 */

// ---------------------------------------------------------------------------
// Recommended age
// ---------------------------------------------------------------------------

export interface AgeGroupDefinition {
  value: AgeGroup;
  label: string;
  /** Inclusive bounds. Null for ALL_AGES, which deliberately has none. */
  minYears: number | null;
  maxYears: number | null;
}

/**
 * Shelf bands, in the order they appear in the dropdown.
 *
 * These are a *catalogue* taxonomy, not the library's membership rule. The
 * range a child must be in to join lives in `library_settings.age_min/age_max`
 * and answers a different question — a nine-year-old may perfectly well borrow
 * a book banded 11–14.
 */
export const AGE_GROUPS: readonly AgeGroupDefinition[] = [
  { value: "AGE_5_7", label: "5–7 years", minYears: 5, maxYears: 7 },
  { value: "AGE_8_10", label: "8–10 years", minYears: 8, maxYears: 10 },
  { value: "AGE_11_14", label: "11–14 years", minYears: 11, maxYears: 14 },
  { value: "ALL_AGES", label: "All Ages", minYears: null, maxYears: null },
] as const;

export const AGE_GROUP_VALUES = AGE_GROUPS.map((group) => group.value);

export function ageGroupLabel(value: AgeGroup): string {
  const found = AGE_GROUPS.find((group) => group.value === value);
  // Throwing rather than falling back: an unknown band means the enum and this
  // file have drifted, and a silent "Unknown" on a child's screen would hide it.
  if (!found) throw new Error(`Unknown age group: ${value}`);
  return found.label;
}

export function isAgeGroup(value: unknown): value is AgeGroup {
  return AGE_GROUP_VALUES.includes(value as AgeGroup);
}

/**
 * The band as a reader should read it: a recommendation, never a permission.
 *
 * **No book in this library is restricted by age, and nothing in the code
 * enforces one.** The whole collection is for children, the membership range in
 * `library_settings` is who may join, and the band on a book says who it was
 * written for — an eight-year-old may borrow a book banded 11–14 and a
 * thirteen-year-old may borrow a picture book, and neither needs to ask.
 *
 * This wording exists because the bare label did not say that. "8–10 years" on
 * a badge beside "On the shelf" reads like a condition of borrowing, and a
 * child who reads ahead of their years would be the one to believe it.
 */
export function ageGroupSuggestion(value: AgeGroup): string {
  const found = AGE_GROUPS.find((group) => group.value === value);
  if (!found) throw new Error(`Unknown age group: ${value}`);
  return found.value === "ALL_AGES" ? "Good for any age" : `Best for ${found.label}`;
}

/** Said once, in full, wherever a child might mistake the band for a rule. */
export const AGE_BAND_NOTE =
  "This is a suggestion, not a rule. Anyone may borrow any book in our library.";

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

export interface ConditionDefinition {
  value: CopyCondition;
  label: string;
  /** Shown to staff only. A child never needs to read a condition rubric. */
  hint: string;
}

export const CONDITIONS: readonly ConditionDefinition[] = [
  { value: "GOOD", label: "Good", hint: "Ready for the shelf." },
  { value: "FAIR", label: "Fair", hint: "Well loved — a few marks or a soft corner." },
  { value: "DAMAGED", label: "Damaged", hint: "Torn, missing pages, or coming apart." },
] as const;

export const CONDITION_VALUES = CONDITIONS.map((condition) => condition.value);

export function conditionLabel(value: CopyCondition): string {
  const found = CONDITIONS.find((condition) => condition.value === value);
  if (!found) throw new Error(`Unknown condition: ${value}`);
  return found.label;
}

export function isCondition(value: unknown): value is CopyCondition {
  return CONDITION_VALUES.includes(value as CopyCondition);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface StatusDefinition {
  value: CopyStatus;
  /** Wording for the librarian's screens. */
  staffLabel: string;
  /** Wording for a child. Warmer, and never about the library's inventory. */
  readerLabel: string;
  /**
   * Decoration only. Status is never carried by colour or by an emoji alone —
   * every badge pairs this with the word, per docs/DESIGN_SYSTEM.md §6.
   */
  mark: string;
  tone: "available" | "out" | "soon" | "late" | "neutral";
  /** True when a reader may expect to take this book home today. */
  onShelf: boolean;
}

/**
 * Every status the catalogue can hold.
 *
 * BORROWED and RESERVED are listed because the database can hold them and a
 * reader must be told the truth about a book that is out — **not** because
 * Phase 2 sets them. Circulation is Phase 3. See `SELECTABLE_STATUSES`.
 */
export const STATUSES: readonly StatusDefinition[] = [
  {
    value: "AVAILABLE",
    staffLabel: "Available",
    readerLabel: "On the shelf",
    mark: "🟢",
    tone: "available",
    onShelf: true,
  },
  {
    value: "BORROWED",
    staffLabel: "Borrowed",
    readerLabel: "Someone is reading it",
    mark: "📕",
    tone: "out",
    onShelf: false,
  },
  {
    value: "RESERVED",
    staffLabel: "Reserved",
    readerLabel: "Being kept for someone",
    mark: "🔖",
    tone: "soon",
    onShelf: false,
  },
  {
    value: "LOST",
    staffLabel: "Lost",
    readerLabel: "Missing right now",
    mark: "🔍",
    tone: "neutral",
    onShelf: false,
  },
  {
    value: "DAMAGED",
    staffLabel: "Damaged",
    readerLabel: "Being mended",
    mark: "⚠️",
    tone: "late",
    onShelf: false,
  },
  {
    value: "ARCHIVED",
    staffLabel: "Archived",
    readerLabel: "No longer in the library",
    mark: "📦",
    tone: "out",
    onShelf: false,
  },
] as const;

/**
 * What a librarian may choose in the Add Book and Edit Book forms.
 *
 * **BORROWED is not on this list, as of Phase 3.** It was in Phase 2, when the
 * catalogue had to describe a shelf that existed before the software did and a
 * book could be catalogued while already in a child's bag. Circulation now owns
 * that transition: a copy is BORROWED because a loan says so and for no other
 * reason, and a database trigger enforces the two agreeing. Leaving BORROWED
 * pickable would let a dropdown create a borrowed book with no borrower — the
 * exact inconsistency Phase 3 exists to make impossible.
 *
 * ARCHIVED is absent deliberately: archiving is its own audited action with its
 * own reason, not a value someone can pick from a list by mistake.
 * RESERVED is absent because nothing in Version 1 reserves anything.
 */
export const SELECTABLE_STATUSES: readonly CopyStatus[] = [
  "AVAILABLE",
  "LOST",
  "DAMAGED",
] as const;

/**
 * Statuses a copy may be in and still be handed to a child.
 *
 * Exactly one, and that is the point. A book that is LOST has to be found and
 * explicitly restored; one that is DAMAGED has to be mended and its condition
 * changed by somebody who looked at it; one that is ARCHIVED is not part of the
 * collection any more. None of those become issuable as a side effect of trying
 * to issue them. See docs/CIRCULATION.md §"What blocks an issue".
 */
export const ISSUABLE_STATUSES: readonly CopyStatus[] = ["AVAILABLE"] as const;

/**
 * Conditions a copy may be in and still be handed to a child.
 *
 * A DAMAGED book is not issued. The way to make it issuable is for a librarian
 * to look at the physical object and change its condition to Good or Fair —
 * which is a deliberate human judgement with an audit row, not a checkbox that
 * says "issue anyway".
 */
export const ISSUABLE_CONDITIONS: readonly CopyCondition[] = ["GOOD", "FAIR"] as const;

export function statusDefinition(value: CopyStatus): StatusDefinition {
  const found = STATUSES.find((status) => status.value === value);
  if (!found) throw new Error(`Unknown copy status: ${value}`);
  return found;
}

export function isSelectableStatus(value: unknown): value is CopyStatus {
  return SELECTABLE_STATUSES.includes(value as CopyStatus);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * The categories a fresh library starts with.
 *
 * Seeded, not hard-coded: categories are rows in `book_category`, and an
 * administrator can add more without a deploy. This list is the starting point
 * only, and the application always reads the table.
 *
 * Seven, not thirty. A child choosing a shelf, and a volunteer filing a book,
 * both do better with a list they can hold in their head.
 */
export const DEFAULT_CATEGORIES: readonly { name: string; slug: string; icon: string }[] = [
  { name: "Stories", slug: "stories", icon: "📖" },
  { name: "Comics", slug: "comics", icon: "💥" },
  { name: "Science & Knowledge", slug: "science-and-knowledge", icon: "🔬" },
  { name: "Adventure & Fantasy", slug: "adventure-and-fantasy", icon: "🗺️" },
  { name: "Activity & Learning", slug: "activity-and-learning", icon: "🧩" },
  { name: "Young Readers", slug: "young-readers", icon: "🌱" },
  { name: "Other", slug: "other", icon: "📚" },
] as const;

// ---------------------------------------------------------------------------
// Field limits
// ---------------------------------------------------------------------------

/**
 * Length limits, shared by the Zod schemas and the database CHECK constraints
 * so that the two cannot disagree about what a valid book is.
 */
export const CATALOGUE_LIMITS = {
  titleMax: 200,
  authorMax: 120,
  donorNameMax: 120,
  donorFlatMax: 20,
  archiveReasonMax: 500,
} as const;

// ---------------------------------------------------------------------------
// Donor acknowledgement
// ---------------------------------------------------------------------------

/**
 * How a donation is credited, according to the choice the donor made.
 *
 * `displayConsent` is the donor's decision and this function is the only place
 * that reads it, so there is one answer to "what may we say about this
 * donation?" rather than one per template.
 *
 * There is deliberately no count, no total and no ranking here or anywhere
 * else. Gratitude, not competition.
 *
 * Lives in the isomorphic module rather than in a service because it is pure,
 * and because both the catalogue and circulation need it — a child looking at
 * one of their own borrowed books sees the same thank-you as on the book's
 * page. Putting it here is also what keeps those two services from importing
 * each other in a circle.
 */
export function donorAcknowledgement(donation: {
  donorName: string;
  donorApartment: string | null;
  displayConsent: DonorDisplayConsent;
} | null): string | null {
  if (!donation) return null;

  switch (donation.displayConsent) {
    case "NAMED":
      return donation.donorApartment
        ? `📚 Donated by ${donation.donorName} from ${donation.donorApartment}`
        : `📚 Donated by ${donation.donorName}`;
    case "APARTMENT_ONLY":
      return `📚 Donated by a family in ${donation.donorApartment}`;
    case "ANONYMOUS":
      // No name, no flat. An anonymous donor is still thanked.
      return "📚 Donated by a neighbour";
  }
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/** One page of anything, counted and sliced in PostgreSQL. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * One page of results.
 *
 * Filtering, sorting and paging all happen in PostgreSQL. The browser is never
 * sent the whole catalogue and asked to sort it — at 50 books that would work
 * and at 5,000 it would not, and the child on the oldest phone in the building
 * is the one who would notice first.
 */
export const PAGE_SIZES = {
  /** Dense staff table. */
  desk: 25,
  /** Big picture cards, so fewer per page. */
  reader: 24,
} as const;
