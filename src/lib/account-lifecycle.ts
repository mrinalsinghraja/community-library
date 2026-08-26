import type { UserStatus } from "@prisma/client";

import { agesDuringYear } from "@/lib/birth-year";

/**
 * What an account is, and what it may still do.
 *
 * Every gate in this application is written as an **allowlist**, and that is
 * the load-bearing decision in this file rather than an implementation detail.
 * A denylist — "refuse SUSPENDED, DEACTIVATED and ARCHIVED" — is correct on the
 * day it is written and silently wrong the moment somebody adds a status, which
 * is exactly what happened here: the password-reset gate listed three statuses
 * to refuse, so a new one would have been let through by default and a child
 * whose account had been closed could have reset their way back in.
 *
 * So: statuses are listed by what they permit, never by what they forbid. A
 * status added tomorrow can do nothing at all until somebody puts it on a list
 * on purpose.
 *
 * Isomorphic, so the reader's screen, the desk's screen and the services all
 * describe an account the same way.
 */

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/** May sign in. */
export const LOGIN_ALLOWED_STATUSES: readonly UserStatus[] = ["ACTIVE"];

/**
 * May consume an activation or password-reset link.
 *
 * INVITED is here because activation is how an invited account becomes a real
 * one. ACTIVE is here because that is who resets a forgotten password. Nothing
 * else: a closed account must not be reachable through an emailed link.
 */
export const TOKEN_ALLOWED_STATUSES: readonly UserStatus[] = ["INVITED", "ACTIVE"];

export function maySignIn(status: UserStatus): boolean {
  return LOGIN_ALLOWED_STATUSES.includes(status);
}

export function mayUseAuthToken(status: UserStatus): boolean {
  return TOKEN_ALLOWED_STATUSES.includes(status);
}

/**
 * Statuses that keep the record and close the account.
 *
 * Nothing here is ever deleted. A child who has grown out of the library and a
 * family who have moved away both leave loan history behind, and that history
 * is the library's own record of what it lent and got back — not the member's
 * alone, and not something to erase because somebody moved flat.
 */
export const CLOSED_STATUSES: readonly UserStatus[] = [
  "GROWN_UP",
  "LEFT",
  "DEACTIVATED",
  "ARCHIVED",
];

export function isClosed(status: UserStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Growing out of a children's library
// ---------------------------------------------------------------------------

/**
 * Where a reader stands against the library's age range.
 *
 * `child`      — comfortably inside it.
 * `lastYear`   — might have passed the top of the range this year, might not.
 *                Still a full member. This is the year the quiet note appears.
 * `grownUp`    — past it on any reading of the birth year.
 */
export type AgeStage = "child" | "lastYear" | "grownUp";

/**
 * The stage a birth year puts a reader in, this year.
 *
 * **This is deliberately slow to restrict anybody, and the reason is ADR-051:
 * the library asks for a birth year and not a birthday.** A reader born in 2011
 * is, during 2026, either 14 or 15 — and which one depends on a date the
 * library chose not to know.
 *
 * So the two edges are drawn at opposite ends of that uncertainty:
 *
 *   * the note appears as soon as they *might* have passed the range, because
 *     a note costs nothing if it is early;
 *   * the restriction lands only once they have passed it on *every* reading,
 *     because being wrong here locks a fourteen-year-old out of the library in
 *     January over a birthday in November.
 *
 * The cost is that a reader keeps their card for up to a year longer than a
 * library holding birthdays would allow. That is the right way round for a
 * free library in one building, and it is the price of not holding the date.
 */
export function ageStage(birthYear: number, ageMax: number, year: number): AgeStage {
  const { beforeBirthday, afterBirthday } = agesDuringYear(birthYear, year);

  // Past the range even if their birthday has not happened yet.
  if (beforeBirthday > ageMax) return "grownUp";
  // Will pass the range this year, but may not have yet.
  if (afterBirthday > ageMax) return "lastYear";
  return "child";
}

/**
 * The birth years that are certainly past the range, for a query.
 *
 * Returns the newest such year, so the daily pass can ask for
 * `birthYear <= cutoff` rather than computing a stage per row. Mirrors
 * `ageStage` exactly: a year is included only when `beforeBirthday > ageMax`.
 */
export function grownUpBirthYearCutoff(ageMax: number, year: number): number {
  // beforeBirthday = year - birthYear - 1 > ageMax  ⇔  birthYear < year - ageMax - 1
  return year - ageMax - 2;
}

// ---------------------------------------------------------------------------
// What each of them is called
// ---------------------------------------------------------------------------

export interface StatusDefinition {
  value: UserStatus;
  /** Dense and factual, for a librarian scanning a list. */
  staffLabel: string;
  /** What the desk needs to know about it in one line. */
  staffHint: string;
}

export const STATUS_DEFINITIONS: readonly StatusDefinition[] = [
  { value: "INVITED", staffLabel: "Invited", staffHint: "The link has gone out; nobody has set a password yet." },
  { value: "ACTIVE", staffLabel: "Active", staffHint: "Can sign in and borrow." },
  { value: "SUSPENDED", staffLabel: "Paused", staffHint: "Temporarily stopped. Can be turned back on." },
  {
    value: "GROWN_UP",
    staffLabel: "Grown up",
    staffHint: "Past the library's age range. Kept for the library's records.",
  },
  {
    value: "LEFT",
    staffLabel: "Left",
    staffHint: "The family has moved away. Kept for the library's records.",
  },
  { value: "DEACTIVATED", staffLabel: "Closed", staffHint: "Closed for another reason. Kept for the library's records." },
  { value: "ARCHIVED", staffLabel: "Archived", staffHint: "Closed, with personal details redacted." },
];

export function statusDefinition(value: UserStatus): StatusDefinition {
  return (
    STATUS_DEFINITIONS.find((definition) => definition.value === value) ?? {
      value,
      staffLabel: value,
      staffHint: "",
    }
  );
}

/**
 * The two closures a Super Admin chooses between, and the words for each.
 *
 * Separate statuses rather than one "closed" with a note, because the two are
 * different facts about a person and the library will want to count them
 * differently: children grow up every year and that is the library working,
 * while families leaving is churn. A free-text reason cannot be counted.
 */
export const CLOSURE_KINDS = [
  {
    status: "GROWN_UP" as const,
    label: "Grown up",
    /** Shown on the button and in the confirmation. */
    description:
      "Past the age this library is for. Their history stays, and they can no longer sign in or borrow.",
  },
  {
    status: "LEFT" as const,
    label: "Left the building",
    description:
      "The family has moved away. Their history stays, and they can no longer sign in or borrow.",
  },
] as const;

export type ClosureStatus = (typeof CLOSURE_KINDS)[number]["status"];

export function isClosureStatus(value: string): value is ClosureStatus {
  return CLOSURE_KINDS.some((kind) => kind.status === value);
}

// ---------------------------------------------------------------------------
// What a reader is told
// ---------------------------------------------------------------------------

export const LIFECYCLE_MESSAGES = {
  /**
   * The quiet note in the reader's own corner, during the year they might pass
   * the top of the range.
   *
   * Warm, and it asks rather than announces. A child who reads this has done
   * nothing wrong and is not being shown the door — they are being told that
   * the library is for younger readers and that somebody should have a word
   * about it, which is a conversation between a family and a librarian rather
   * than a decision this software should make on its own.
   */
  growingUpTitle: "You are one of our oldest readers now",
  growingUp: (ageMin: number, ageMax: number) =>
    `Our library is for children aged ${ageMin} to ${ageMax}, and you are getting close to the top of that. Please have a word with the librarian next time you are in — there is no rush, and nothing changes today.`,

  /** On the sign-in screen, once an account has aged out. */
  grownUpTitle: "You have grown up!",
  grownUp:
    "Thank you for all your reading. This library is for younger children, so your card has been retired — but everything you borrowed is still part of our story. Please come and say hello to the librarian.",

  /** Once a family has moved away. */
  leftTitle: "This card has been closed",
  left: "Your family is no longer registered at this address, so this card has been closed. If that is not right, please speak to the librarian.",
} as const;
