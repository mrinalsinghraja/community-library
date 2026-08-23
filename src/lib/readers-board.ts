/**
 * The readers' board: five children, celebrated together.
 *
 * Isomorphic, so the card in the browser and the service on the server agree
 * about how many sockets there are and what an empty one says.
 *
 * **Nothing here ranks anybody.** Five readers are chosen by how much they read
 * last month and then arranged by name, so the board says "these five had a
 * good month" and not "this one beat that one". A library is not a scoreboard,
 * and a spreadsheet of children in finishing order is a thing that gets
 * forwarded. See ADR-055.
 */

/** How many sockets the figure has. Five, filled or waiting. */
export const BOARD_SIZE = 5;

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

/**
 * The month the board is about: the one that has just finished.
 *
 * Never the current month. A board that updated live would rank children
 * against each other in real time and invite a child to refresh it, which is
 * the behaviour this feature is most at risk of encouraging. A finished month
 * is a settled fact somebody can be pleased about and then forget.
 */
export function previousMonthWindow(now: Date): { from: Date; to: Date; label: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 1);

  const label = from.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return { from, to, label };
}
