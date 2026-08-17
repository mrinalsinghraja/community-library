import type { AgeGroup, CopyCondition, CopyStatus } from "@prisma/client";

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
 * BORROWED is here because a book can be catalogued while it is already in a
 * child's bag — the shelf existed before this software did. What Phase 2 does
 * NOT do is *drive* that transition: no issue, no return, no due date, no loan
 * row. Phase 3 owns AVAILABLE ↔ BORROWED, and when it lands, this list is where
 * BORROWED should be removed from manual choice.
 *
 * ARCHIVED is absent deliberately: archiving is its own audited action with its
 * own reason, not a value someone can pick from a list by mistake.
 * RESERVED is absent because nothing in Version 1 reserves anything.
 */
export const SELECTABLE_STATUSES: readonly CopyStatus[] = [
  "AVAILABLE",
  "BORROWED",
  "LOST",
  "DAMAGED",
] as const;

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
// Paging
// ---------------------------------------------------------------------------

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
