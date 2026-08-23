import "server-only";

import { BOARD_SIZE, previousMonthWindow, type BoardReader } from "@/lib/readers-board";
import { requireActor } from "@/server/authz";
import { prisma } from "@/server/db";

/**
 * Who was reading last month.
 *
 * Three rules hold this together, and each exists because the obvious version
 * of this feature would have broken something:
 *
 *  1. **Consent gates appearance, not just the photograph.** A child appears
 *     only where a guardian has granted READERS_BOARD and not withdrawn it.
 *     Putting a child's first name in front of every other family is a
 *     disclosure in its own right, so it is asked for in its own right. No
 *     consent on record means no appearance — which is every child's state
 *     until somebody actively opts in, and is why the board starts empty.
 *
 *  2. **The month is finished.** Always the previous calendar month, never a
 *     running total. A live board would rank children against each other in
 *     real time and reward refreshing it.
 *
 *  3. **The five are chosen by reading and then ordered by name.** The count
 *     decides who is on the board and is then thrown away — it is never
 *     returned, never rendered, and there is no ordering anywhere the browser
 *     could reconstruct one from.
 */

interface BoardRow {
  user_id: string;
  first_name: string;
  photo_media_id: string | null;
  avatar_key: string | null;
}

/**
 * Up to five readers, in alphabetical order, for the month just gone.
 *
 * Signed in only. This is a page a child opens about their own library, and a
 * signed-out request has no business learning which children are in it.
 */
export async function readersOfTheMonth(now: Date = new Date()): Promise<BoardReader[]> {
  const actor = await requireActor();
  const { from, to } = previousMonthWindow(now);

  /*
   * One statement, so the choosing and the ordering cannot drift apart.
   *
   * The inner query ranks by how many books each consenting child took out and
   * keeps the top few; the outer one re-sorts those by name. The count exists
   * only inside this query and never leaves it.
   *
   * `split_part(display_name, ' ', 1)` is the first name. A board carries a
   * first name and nothing else — a surname alongside a photograph identifies a
   * child to a stranger, which is the thing a community board must not do.
   */
  const rows = await prisma.$queryRaw<BoardRow[]>`
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
         WHERE l.library_id = ${actor.libraryId}
           AND l.issued_at >= ${from}
           AND l.issued_at <= ${to}
           AND u.status = 'ACTIVE'
           AND EXISTS (
             SELECT 1 FROM consent_record c
              WHERE c.member_user_id = u.id
                AND c.library_id = ${actor.libraryId}
                AND c.type = 'READERS_BOARD'
                AND c.status = 'GRANTED'
           )
         GROUP BY u.id, u.display_name, m.photo_media_id, m.avatar_key
         ORDER BY count(*) DESC, lower(u.display_name) ASC
         LIMIT ${BOARD_SIZE}
      ) AS chosen
     ORDER BY lower(chosen.first_name) ASC
  `;

  return rows.map((row) => ({
    firstName: row.first_name,
    photoMediaId: row.photo_media_id,
    avatarKey: row.avatar_key,
  }));
}

/**
 * Whether this member's photograph may be shown to other readers right now.
 *
 * Asked by `getAuthorizedMedia` before it will serve one child's photograph to
 * another child. It is a **query, not a flag**, deliberately: the same rule that
 * puts a face on the board decides whether the bytes may be read, so the two can
 * never disagree. A child who drops off the board next month stops being
 * readable the moment the board changes, with nothing to remember to switch off.
 *
 * The same rule appears on the donor register for book covers, and for the same
 * reason. See ADR-055.
 */
export async function memberIsOnReadersBoard(
  libraryId: string,
  memberUserId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { from, to } = previousMonthWindow(now);

  const rows = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT u.id AS user_id
      FROM loan l
      JOIN app_user u ON u.id = l.member_user_id
     WHERE l.library_id = ${libraryId}
       AND l.issued_at >= ${from}
       AND l.issued_at <= ${to}
       AND u.status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM consent_record c
          WHERE c.member_user_id = u.id
            AND c.library_id = ${libraryId}
            AND c.type = 'READERS_BOARD'
            AND c.status = 'GRANTED'
       )
     GROUP BY u.id, u.display_name
     ORDER BY count(*) DESC, lower(u.display_name) ASC
     LIMIT ${BOARD_SIZE}
  `;

  return rows.some((row) => row.user_id === memberUserId);
}
