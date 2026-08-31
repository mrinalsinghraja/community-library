/**
 * The readers' board: six children, celebrated together, twice.
 *
 * Isomorphic, so the cards in the browser and the service on the server agree
 * about how many sockets there are and what an empty one says.
 *
 * **Nothing here ranks anybody.** Six readers are chosen by how much they read
 * and then arranged by name, so a board says "these six had a good month" and
 * not "this one beat that one". A library is not a scoreboard, and a
 * spreadsheet of children in finishing order is a thing that gets forwarded.
 * See ADR-055.
 */

/** How many sockets a board has. Six, filled or waiting. */
export const BOARD_SIZE = 6;

/** What one socket holds once somebody is in it. */
export interface BoardReader {
  /** First name only. Never a surname, never a flat, never a card number. */
  firstName: string;
  /**
   * The child's photograph, when their guardian has said other families may see
   * it. Null is the ordinary case and the card must look complete without it.
   */
  photoMediaId: string | null;
  /** The illustrated mark they chose, shown when there is no photograph. */
  avatarKey: string | null;
}

/** The words in an empty socket. The invitation is the point of the card. */
export const EMPTY_SOCKET_LABEL = "It could be you";

/**
 * A first name reduced to one letter, for a child with no photograph.
 *
 * A monogram rather than a silhouette: a grey outline of a person reads as a
 * missing thing, where a letter reads as somebody who simply has not sent a
 * picture — which is the true and much kinder statement.
 */
export function monogram(firstName: string): string {
  const first = [...firstName.trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
}

export interface MonthWindow {
  from: Date;
  to: Date;
  label: string;
}

/**
 * One whole calendar month, in UTC, with the name a child would call it.
 *
 * UTC rather than the library's own timezone, which is the boundary the rest of
 * this feature has always used: it means a board turns over at half past five
 * on the morning of the first, and the alternative — a month that starts at a
 * different instant for the query than for the label — is a worse bug than a
 * few hours of lag on one morning a month.
 */
function monthWindow(year: number, month: number): MonthWindow {
  const from = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - 1);

  const label = from.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return { from, to, label };
}

/**
 * The month happening now — the board that is still being written.
 *
 * This used to be refused outright, on the reasoning that a live board ranks
 * children against each other in real time and rewards refreshing it. The
 * library's owner asked for it anyway, and the reasoning does not survive
 * contact with what this card actually shows: there is no count on it, no
 * order, and no numeral, so a child refreshing it learns only whether they are
 * among six names sorted alphabetically. There is no position to watch move.
 *
 * What a running month buys is the thing the finished-month board could not do
 * in a library this small — a child who borrows a book on the second of the
 * month sees themselves that afternoon rather than five weeks later. Early in
 * the month the six are chosen from very little; by the end they are chosen
 * from a month. That is understood, and the card says the month is not over.
 */
export function currentMonthWindow(now: Date): MonthWindow {
  return monthWindow(now.getUTCFullYear(), now.getUTCMonth());
}

/**
 * The month that has just finished — a settled fact, kept where it can be seen.
 *
 * The second board exists because the first one resets: without it, everything
 * a child did in August disappears at midnight on the 31st, which is the
 * opposite of appreciating it. This one never changes again once its month
 * ends.
 */
export function previousMonthWindow(now: Date): MonthWindow {
  return monthWindow(now.getUTCFullYear(), now.getUTCMonth() - 1);
}
