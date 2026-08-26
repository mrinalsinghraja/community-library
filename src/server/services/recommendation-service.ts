import "server-only";

import { createHash } from "node:crypto";

import { requireActor } from "@/server/authz";
import { prisma } from "@/server/db";
import { GroqUnavailableError, bookHelperEnabled, groqJson } from "@/server/lib/ai/groq";
import {
  buildRecommendPrompt,
  type RecommendCandidate,
  type RecommendHistoryEntry,
} from "@/server/lib/ai/recommend-prompt";
import { checkActionThrottle, recordAction } from "@/server/lib/rate-limit";
import { getBranding } from "@/server/lib/settings";

/**
 * "Based on your reading, the AI Librarian suggests…"
 *
 * The one place the library makes a guess about a particular child. Everything
 * else it shows them is a fact — this book is on the shelf, that one is due on
 * Friday. This is an opinion, and opinions about children need their edges
 * written down.
 *
 * WHAT LEAVES THIS BUILDING. Titles, authors, shelf names and the reader's own
 * star ratings. That is the whole list. No name, no member code, no age, no
 * birth year, no flat, no email, no dates, no ids of any kind. The model is
 * handed a stack of books and asked which one a person who liked these would
 * like next; it is never told who that person is, and there is nothing in what
 * it receives that could pick one child out of the building.
 *
 * WHAT COMES BACK IS NOT TRUSTED. The model answers with numbers into a list we
 * gave it. Every number is mapped back through our own catalogue before a word
 * reaches a page, so the feature cannot recommend a book this library does not
 * own — the classic failure of a book recommender, and the one that sends a
 * child looking for something that was never in the room. The sentences it
 * writes are shown beside our title and our author, never instead of them.
 *
 * NOTHING IS KEPT THAT WOULD BUILD A PROFILE. One row per reader, replaced in
 * place. No history of past suggestions, no prompt, no raw reply. See the
 * `ReaderRecommendation` model.
 *
 * WHO CAN ASK. A signed-in member, for themselves, and nobody else — there is
 * no staff surface here and no way to ask for another reader's suggestions.
 * That is deliberate: a librarian reading a list of what one child is being
 * steered towards is a different feature with different consent behind it.
 */

/** How many books the AI Librarian suggests. Three fits a row and a decision. */
export const RECOMMENDATION_COUNT = 3;

/**
 * How many past loans are described to the model.
 *
 * Twelve is enough to show a pattern and short enough that a child who has
 * borrowed sixty books does not have sixty titles sent anywhere. Most recent
 * first, because what someone liked last month predicts better than what they
 * liked two years ago.
 */
export const HISTORY_LIMIT = 12;

/**
 * How many unread books are offered for it to choose from.
 *
 * Forty keeps the prompt small enough to stay inside a free tier and wide
 * enough that the answer is a choice rather than a formality.
 */
export const CANDIDATE_LIMIT = 40;

/** Below this, there is not enough reading to draw a line through. */
export const MIN_HISTORY = 2;

/** Per reader, per hour. A suggestion is not something anyone needs twice a minute. */
export const REFRESHES_PER_HOUR = 4;

export const RECOMMENDATION_MESSAGES = {
  heading: "The AI Librarian suggests",
  /** Shown above the picks, before the model's own sentence. */
  intro: "Based on your past reading, the AI Librarian recommends",
  tooNew:
    "Borrow a couple of books first, and the AI Librarian will start suggesting what to read next.",
  nothingLeft:
    "You have borrowed almost everything on our shelves! Ask your librarian what is coming next.",
  unavailable: "The AI Librarian is having a quiet moment. Try again in a little while.",
  busy: "You have asked for a few of these already. Try again in a little while.",
  outOfFuel: "The AI Librarian has done a lot of thinking today. It will be back tomorrow.",
  stale: "You have borrowed something since these were picked.",
  refresh: "Suggest something new",
  /** Never a promise. A suggestion is not a reservation. */
  footnote: "A suggestion, not a booking — the librarian decides what goes home.",
} as const;

export interface RecommendedBook {
  /** The copy code a reader can tap through to. Chosen from copies we still hold. */
  code: string;
  title: string;
  authors: string[];
  categoryName: string;
  categoryIcon: string | null;
  coverMediaId: string | null;
  /** The model's one sentence about why this reader in particular. */
  why: string;
}

export type RecommendationFailure =
  | "unavailable"
  | "too-new"
  | "nothing-left"
  | "busy"
  | "out-of-fuel"
  | "failed";

export interface RecommendationSet {
  books: RecommendedBook[];
  /** The model's one sentence naming what it noticed. */
  basis: string;
  generatedAt: Date;
  /** True when the reader has borrowed something since these were chosen. */
  stale: boolean;
}

export type RecommendationResult =
  | { ok: true; set: RecommendationSet }
  | { ok: false; reason: RecommendationFailure };

interface StoredPick {
  titleId: string;
  why: string;
}

/**
 * A fingerprint of the reading this was drawn from.
 *
 * A digest and not the ids themselves: this column exists to answer "has
 * anything changed?", and storing the loan ids to answer it would put a second
 * copy of a child's borrowing history in a second table for no gain.
 */
function historySignature(loanIds: readonly string[]): string {
  return createHash("sha256").update(loanIds.join(",")).digest("hex").slice(0, 32);
}

/**
 * What this reader has taken home, most recent first.
 *
 * Cancelled loans are skipped — an issue undone at the desk is not a book
 * anybody read, and letting it into the history would have the AI Librarian
 * draw conclusions from a typing mistake.
 */
async function readingHistory(memberUserId: string) {
  return prisma.loan.findMany({
    where: { memberUserId, status: { in: ["ACTIVE", "RETURNED"] } },
    orderBy: { issuedAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      copy: {
        select: {
          titleId: true,
          title: {
            select: {
              id: true,
              title: true,
              authors: true,
              categoryId: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Books on the shelf this reader has not had.
 *
 * Ordered by how well the library's other readers have received them, so that
 * when the model is given forty to choose from they are forty worth choosing.
 * The ordering uses published ratings only — the same aggregate any child can
 * already see on the shelf — and a plain loan count. Neither can name anyone.
 *
 * ARCHIVED and LOST copies are excluded: suggesting a book that is not in the
 * building is the failure this whole service is arranged to avoid.
 *
 * The array parameters below are cast to `text[]` and not `uuid[]`. Every id in
 * them is a UUIDv7, but the columns are Prisma `String`, which is TEXT in
 * PostgreSQL — casting to uuid gets "operator does not exist: text = uuid" at
 * runtime and never at build time.
 */
async function candidateBooks(
  libraryId: string,
  excludeTitleIds: readonly string[],
  preferredCategoryIds: readonly string[],
) {
  const rows = await prisma.$queryRaw<
    {
      title_id: string;
      title: string;
      authors: string[];
      category_name: string;
    }[]
  >`
    SELECT t.id            AS title_id,
           t.title         AS title,
           t.authors       AS authors,
           cat.name        AS category_name
      FROM book_title t
      JOIN book_category cat ON cat.id = t.category_id
      LEFT JOIN LATERAL (
        SELECT avg(br.rating) AS rating_average
          FROM book_review br
         WHERE br.title_id = t.id
           AND br.status = 'PUBLISHED'
      ) r ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) AS loan_count
          FROM loan ln
          JOIN book_copy lc ON lc.id = ln.copy_id
         WHERE lc.title_id = t.id
           AND ln.status <> 'CANCELLED'
      ) l ON TRUE
     WHERE t.library_id = ${libraryId}
       AND NOT (t.id = ANY(${[...excludeTitleIds]}::text[]))
       AND EXISTS (
         SELECT 1 FROM book_copy c
          WHERE c.title_id = t.id
            AND c.status NOT IN ('ARCHIVED', 'LOST')
            AND c.condition <> 'DAMAGED'
       )
     ORDER BY (t.category_id = ANY(${[...preferredCategoryIds]}::text[])) DESC,
              r.rating_average DESC NULLS LAST,
              coalesce(l.loan_count, 0) DESC,
              lower(t.title) ASC
     LIMIT ${CANDIDATE_LIMIT}
  `;
  return rows;
}

interface ModelReply {
  basis?: unknown;
  picks?: unknown;
}

/**
 * Turns whatever the model said into picks we are willing to show, or nothing.
 *
 * Exported for `tests/unit/recommendations.test.ts` and called from nowhere
 * else. The bounds check below is the only thing standing between a model that
 * invented a number and a child being sent to look for a book that does not
 * exist, and a guard that cannot be tested directly is a guard that quietly
 * stops working.
 *
 * Every guard here exists because a language model is allowed to be wrong and
 * this function is the only thing between it and a child's screen. A number
 * outside the list, a repeat, a missing sentence, a paragraph where a sentence
 * was asked for, the whole reply not being JSON at all — each is dropped rather
 * than repaired, because a half-understood suggestion is worse than none.
 */
export function parseReply(
  raw: string,
  candidates: readonly RecommendCandidate[],
  candidateTitleIds: readonly string[],
): { basis: string; picks: StoredPick[] } | null {
  let parsed: ModelReply;
  try {
    parsed = JSON.parse(raw) as ModelReply;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed.picks)) return null;

  const seen = new Set<number>();
  const picks: StoredPick[] = [];

  for (const entry of parsed.picks) {
    if (typeof entry !== "object" || entry === null) continue;
    const { n, why } = entry as { n?: unknown; why?: unknown };

    if (typeof n !== "number" || !Number.isInteger(n)) continue;
    // One-based into the list we numbered. Anything else is the model having
    // invented a book, and there is nothing to map it to.
    const index = n - 1;
    if (index < 0 || index >= candidates.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);

    const sentence = typeof why === "string" ? why.trim().replace(/\s+/g, " ") : "";
    if (!sentence) continue;

    picks.push({ titleId: candidateTitleIds[index], why: sentence.slice(0, 200) });
    if (picks.length === RECOMMENDATION_COUNT) break;
  }

  if (picks.length === 0) return null;

  const basisRaw = typeof parsed.basis === "string" ? parsed.basis.trim().replace(/\s+/g, " ") : "";
  const basis = basisRaw.slice(0, 200) || RECOMMENDATION_MESSAGES.intro;

  return { basis, picks };
}

/**
 * Turns stored title ids back into something renderable, dropping any book the
 * library no longer has.
 *
 * Re-read on every render rather than stored alongside the pick: a book that
 * was archived, lost or damaged since the suggestion was made must vanish from
 * it. The alternative is a child tapping a card and meeting a 404, or worse,
 * walking down to the room for a book that is not there.
 */
async function hydrate(picks: readonly StoredPick[]): Promise<RecommendedBook[]> {
  if (picks.length === 0) return [];

  const titles = await prisma.bookTitle.findMany({
    where: { id: { in: picks.map((pick) => pick.titleId) } },
    select: {
      id: true,
      title: true,
      authors: true,
      coverMediaId: true,
      category: { select: { name: true, icon: true } },
      copies: {
        where: { status: { notIn: ["ARCHIVED", "LOST"] }, condition: { not: "DAMAGED" } },
        select: { copyCode: true, status: true },
        // AVAILABLE sorts before BORROWED, so the code a reader taps is a copy
        // that is actually on the shelf when one is.
        orderBy: [{ status: "asc" }, { copyCode: "asc" }],
        take: 1,
      },
    },
  });

  const byId = new Map(titles.map((title) => [title.id, title]));

  return picks.flatMap((pick) => {
    const title = byId.get(pick.titleId);
    if (!title || title.copies.length === 0) return [];
    return [
      {
        code: title.copies[0].copyCode,
        title: title.title,
        authors: title.authors,
        categoryName: title.category.name,
        categoryIcon: title.category.icon,
        coverMediaId: title.coverMediaId,
        why: pick.why,
      },
    ];
  });
}

/**
 * What was suggested last time, if anything, without asking a model.
 *
 * Called on every render of the reader's own page, so it must be cheap and must
 * never reach the network. When the stored set no longer matches the reader's
 * borrowing it is still returned, flagged `stale` — showing three slightly old
 * suggestions with a "pick again" button beats showing an empty card.
 */
export async function getStoredRecommendations(): Promise<RecommendationSet | null> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return null;

  const stored = await prisma.readerRecommendation.findUnique({
    where: { memberUserId: actor.userId },
  });
  if (!stored) return null;

  const picks = Array.isArray(stored.picks) ? (stored.picks as unknown as StoredPick[]) : [];
  const books = await hydrate(picks.filter((pick) => pick && typeof pick.titleId === "string"));
  if (books.length === 0) return null;

  const loans = await prisma.loan.findMany({
    where: { memberUserId: actor.userId, status: { in: ["ACTIVE", "RETURNED"] } },
    orderBy: { issuedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true },
  });

  return {
    books,
    basis: stored.basis,
    generatedAt: stored.generatedAt,
    stale: historySignature(loans.map((loan) => loan.id)) !== stored.historySignature,
  };
}

/** Whether the reader has read enough for a suggestion to mean anything. */
export async function canRecommend(): Promise<boolean> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return false;
  if (!bookHelperEnabled()) return false;

  const count = await prisma.loan.count({
    where: { memberUserId: actor.userId, status: { in: ["ACTIVE", "RETURNED"] } },
  });
  return count >= MIN_HISTORY;
}

/**
 * Ask the AI Librarian for three books, and remember the answer.
 *
 * Never called during a page render. It is a server action behind a button, so
 * that a reader who never opens the card costs the library's Groq allowance
 * nothing, and so that a model taking ten seconds delays a click rather than a
 * page.
 */
export async function refreshRecommendations(): Promise<RecommendationResult> {
  const actor = await requireActor();
  // Staff have no version of this. There is no parameter for whose suggestions
  // to fetch, so there is nothing to pass to read another child's.
  if (actor.kind !== "MEMBER") return { ok: false, reason: "unavailable" };
  if (!bookHelperEnabled()) return { ok: false, reason: "unavailable" };

  const throttle = await checkActionThrottle({
    bucket: "recommendations",
    subject: actor.userId,
    max: REFRESHES_PER_HOUR,
    windowMinutes: 60,
  });
  if (!throttle.allowed) return { ok: false, reason: "busy" };

  const loans = await readingHistory(actor.userId);
  if (loans.length < MIN_HISTORY) return { ok: false, reason: "too-new" };

  /*
   * The reader's own ratings, including ones still waiting at the moderation
   * desk. Publication is about whether other children read someone's words;
   * this is a number the reader gave a book, used to choose books for that same
   * reader, and it goes nowhere near another reader's screen.
   */
  const ownRatings = await prisma.bookReview.findMany({
    where: { memberUserId: actor.userId },
    select: { titleId: true, rating: true },
  });
  const ratingByTitle = new Map(ownRatings.map((row) => [row.titleId, row.rating]));

  const readTitleIds = [...new Set(loans.map((loan) => loan.copy.titleId))];
  const preferredCategoryIds = [...new Set(loans.map((loan) => loan.copy.title.categoryId))];

  const history: RecommendHistoryEntry[] = loans.map((loan) => ({
    title: loan.copy.title.title,
    authors: loan.copy.title.authors,
    categoryName: loan.copy.title.category.name,
    rating: ratingByTitle.get(loan.copy.title.id) ?? null,
  }));

  const rows = await candidateBooks(actor.libraryId, readTitleIds, preferredCategoryIds);
  if (rows.length === 0) return { ok: false, reason: "nothing-left" };

  const candidates: RecommendCandidate[] = rows.map((row, index) => ({
    n: index + 1,
    title: row.title,
    authors: row.authors,
    categoryName: row.category_name,
  }));
  const candidateTitleIds = rows.map((row) => row.title_id);

  const branding = await getBranding();

  let raw: string;
  try {
    raw = await groqJson([
      {
        role: "system",
        content: buildRecommendPrompt({
          history,
          candidates,
          wanted: Math.min(RECOMMENDATION_COUNT, candidates.length),
          libraryName: branding.libraryName,
        }),
      },
      { role: "user", content: "What should I read next?" },
    ]);
    await recordAction("recommendations", actor.userId);
  } catch (error) {
    if (error instanceof GroqUnavailableError) {
      if (error.reason !== "rate-limited") return { ok: false, reason: "failed" };
      // Same split as the book helper: a burst clears within the hour, the
      // day's allowance does not, and those need different sentences.
      return { ok: false, reason: error.retryAfterSeconds >= 3600 ? "out-of-fuel" : "busy" };
    }
    throw error;
  }

  const parsed = parseReply(raw, candidates, candidateTitleIds);
  if (!parsed) return { ok: false, reason: "failed" };

  const signature = historySignature(loans.map((loan) => loan.id));

  const stored = await prisma.readerRecommendation.upsert({
    where: { memberUserId: actor.userId },
    create: {
      libraryId: actor.libraryId,
      memberUserId: actor.userId,
      picks: parsed.picks as unknown as object,
      basis: parsed.basis,
      historySignature: signature,
      generatedAt: new Date(),
    },
    update: {
      picks: parsed.picks as unknown as object,
      basis: parsed.basis,
      historySignature: signature,
      generatedAt: new Date(),
    },
  });

  const books = await hydrate(parsed.picks);
  if (books.length === 0) return { ok: false, reason: "nothing-left" };

  return {
    ok: true,
    set: { books, basis: stored.basis, generatedAt: stored.generatedAt, stale: false },
  };
}
