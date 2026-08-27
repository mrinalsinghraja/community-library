import "server-only";

import { looksLikeCode, squashCode } from "@/lib/codes";
import { prisma } from "@/server/db";

/**
 * Turning what somebody typed into the account they meant.
 *
 * One function, because there used to be two: `src/server/auth/index.ts` and
 * `src/server/services/password-service.ts` each kept their own copy, and the
 * consequence of two copies is that signing in and asking for a reset link can
 * disagree about who you are. They must not.
 *
 * Three identities reach this:
 *
 *   * a library card code, the only one a child has;
 *   * an email address, which is how staff sign in;
 *   * a username, which nothing in the application has ever written — kept
 *     because the column exists and an import could fill it, but it is not
 *     something any screen should offer a reader. See ADR-065.
 *
 * The card is matched on its letters and digits alone. A card is copied off a
 * printed rectangle by a parent on a phone: the hyphen goes missing, a space
 * arrives instead, the capitals do not. Refusing those is refusing the right
 * answer on a technicality, and on the reset form the refusal is *silent* —
 * which is how a family ends up staring at "we have sent instructions" and an
 * empty inbox.
 */
export async function findUserByIdentifier(raw: string) {
  const identifier = raw.trim().toLowerCase();
  if (!identifier) return null;

  /*
   * Only when it could be a card. An email squashes to letters and digits too
   * ("a@b.example" → "ABEXAMPLE"), and matching that against card numbers would
   * be a lottery nobody asked for.
   */
  if (!identifier.includes("@") && looksLikeCode(identifier)) {
    const squashed = squashCode(identifier);

    /*
     * Raw SQL because the comparison is on a normalised form of the stored
     * column, which Prisma's query API cannot express. LIMIT 2 so an ambiguous
     * match is detectable: two cards that differ only in punctuation should
     * make this refuse rather than pick one. The table holds one row per
     * reader, so this scan is small and stays small.
     */
    const rows = await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT user_id
        FROM member_profile
       WHERE upper(regexp_replace(member_code, '[^A-Za-z0-9]', '', 'g')) = ${squashed}
       LIMIT 2
    `;

    if (rows.length === 1) {
      return prisma.appUser.findUnique({ where: { id: rows[0].user_id } });
    }
    // More than one card normalises to this. Guessing between children is worse
    // than answering nothing.
    if (rows.length > 1) return null;
  }

  return prisma.appUser.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
  });
}
