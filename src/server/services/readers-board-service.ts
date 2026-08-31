import "server-only";

import {
  BOARD_SIZE,
  currentMonthWindow,
  previousMonthWindow,
  type BoardReader,
} from "@/lib/readers-board";
import { requireActor } from "@/server/authz";
import { prisma } from "@/server/db";

/**
 * Who is reading, on two boards: this month so far, and the month just gone.
 *
 * Three rules hold this together, and each exists because the obvious version
 * of this feature would have broken something:
 *
 *  1. **Every member may appear; a family may opt out.** Appearing is disclosed
 *     in the consent a guardian gives when the account is created, so there is
 *     no second question and no child is missing because nobody got round to
 *     asking. A family who would rather their child were left off says so to
 *     the librarian, which writes a WITHDRAWN `READERS_BOARD` record — the
 *     presence of that record, not its absence, is what removes a child.
 *
 *     This is the one place the polarity is worth stating twice, because
 *     getting it backwards would silently show every child who had opted out.
 *
 *  2. **Two windows, each a whole calendar month.** The running month is a
 *     board a child can still join today; the finished one is a settled fact
 *     that stops changing. Never a rolling thirty days, which would belong to
 *     no month a child could name.
 *
 *  3. **The six are chosen by reading and then ordered by name.** The count
 *     decides who is on a board and is then thrown away — it is never
 *     returned, never rendered, and there is no ordering anywhere the browser
 *     could reconstruct one from. This is what makes a live board safe: with no
 *     number and no position on it, there is nothing to watch move.
 */

interface BoardRow {
  user_id: string;
  first_name: string;
  photo_media_id: string | null;
  avatar_key: string | null;
}

/**
 * The board for one month window. The only query that decides who is on a board.
 *
 * One statement, so the choosing and the ordering cannot drift apart. The inner
 * query ranks by how many books each consenting child took out and keeps the
 * top few; the outer one re-sorts those by name. The count exists only inside
 * this query and never leaves it.
 *
 * `split_part(display_name, ' ', 1)` is the first name. A board carries a first
 * name and nothing else — a surname alongside a photograph identifies a child
 * to a stranger, which is the thing a community board must not do.
 */
async function boardFor(libraryId: string, from: Date, to: Date): Promise<BoardRow[]> {
  return prisma.$queryRaw<BoardRow[]>`
    SELECT chosen.user_id,
           chosen.first_name,
           chosen.photo_media_id,
           chosen.avatar_key
      FROM (
        SELECT u.id AS user_id,
               -- Computed here rather than outside, so the outer ORDER BY has a
               -- real column to sort on. A SELECT alias is not in scope for a
               -- qualified reference in the enclosing query.
               split_part(trim(u.display_name), ' ', 1) AS first_name,
               m.photo_media_id,
               m.avatar_key,
               count(*) AS borrowed
          FROM loan l
          JOIN app_user u ON u.id = l.member_user_id
          JOIN member_profile m ON m.user_id = u.id
         WHERE l.library_id = ${libraryId}
           AND l.issued_at >= ${from}
           AND l.issued_at <= ${to}
           AND u.status = 'ACTIVE'
           -- Opted out, not opted in. A family who asked to be left off has a
           -- WITHDRAWN record; everybody else simply has none.
           AND NOT EXISTS (
             SELECT 1 FROM consent_record c
              WHERE c.member_user_id = u.id
                AND c.library_id = ${libraryId}
                AND c.type = 'READERS_BOARD'
                AND c.status = 'WITHDRAWN'
           )
         GROUP BY u.id, u.display_name, m.photo_media_id, m.avatar_key
         ORDER BY count(*) DESC, lower(u.display_name) ASC
         LIMIT ${BOARD_SIZE}
      ) AS chosen
     ORDER BY lower(chosen.first_name) ASC
  `;
}

function toReaders(rows: BoardRow[]): BoardReader[] {
  return rows.map((row) => ({
    firstName: row.first_name,
    photoMediaId: row.photo_media_id,
    avatarKey: row.avatar_key,
  }));
}

/**
 * Up to six readers, in alphabetical order, for the month now running.
 *
 * Signed in only. This is a page a child opens about their own library, and a
 * signed-out request has no business learning which children are in it.
 */
export async function readersOfTheMonth(now: Date = new Date()): Promise<BoardReader[]> {
  const actor = await requireActor();
  const { from, to } = currentMonthWindow(now);

  return toReaders(await boardFor(actor.libraryId, from, to));
}

/** The same six for the month that has finished. Signed in only, like the above. */
export async function readersOfLastMonth(now: Date = new Date()): Promise<BoardReader[]> {
  const actor = await requireActor();
  const { from, to } = previousMonthWindow(now);

  return toReaders(await boardFor(actor.libraryId, from, to));
}

/**
 * Whether this member's photograph may be shown to other readers right now.
 *
 * Asked by `getAuthorizedMedia` before it will serve one child's photograph to
 * another child. It is a **query, not a flag**, deliberately: the same rule that
 * puts a face on a board decides whether the bytes may be read, so the two can
 * never disagree. A child who drops off both boards — or whose family asks to be
 * left off — stops being readable the moment the boards change, with nothing to
 * remember to switch off.
 *
 * Both windows, because both boards are on the page. Checking only one would
 * draw a card with a broken picture on it, which is the failure a child would
 * read as being singled out. The rule itself has not widened: the same six
 * places, the same opt-out, the same signed-in-only route — a photograph is
 * simply readable for as long as it is on something being shown.
 *
 * The same rule appears on the donor register for book covers, and for the same
 * reason. See ADR-055.
 */
export async function memberIsOnReadersBoard(
  libraryId: string,
  memberUserId: string,
  now: Date = new Date(),
): Promise<boolean> {
  for (const window of [currentMonthWindow(now), previousMonthWindow(now)]) {
    const rows = await boardFor(libraryId, window.from, window.to);
    if (rows.some((row) => row.user_id === memberUserId)) return true;
  }

  return false;
}
