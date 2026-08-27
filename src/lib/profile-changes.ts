import { APARTMENT_ERROR, APARTMENT_HINT, isValidApartment, normaliseApartment } from "@/lib/apartment";

/**
 * A reader asking for their own details to be corrected.
 *
 * **Nothing here changes anything.** A submission stores what was asked for and
 * leaves the account exactly as it was; the values move onto the record only
 * when a Super Admin approves them. That is the whole design, and it is what
 * makes it safe to let a nine-year-old edit the field that their password reset
 * email goes to — because they cannot, they can only ask.
 *
 * The alternative, letting a reader write directly to their own row, fails in a
 * specific way worth naming: a child who mistypes their guardian's address
 * locks the family out of recovery, and nobody finds out until the day they
 * need it.
 *
 * Isomorphic, so the form, the server action and the service allow exactly the
 * same fields. A field that is not on this list has no way through.
 */

export interface ChangeableField {
  key: string;
  /** What the reader sees above the box. */
  label: string;
  /** One line under it, in the reader's language. */
  hint?: string;
  /** Where the value actually lives once approved. */
  target: "user" | "member" | "guardian";
  maxLength: number;
  inputType: "text" | "email" | "tel";
  /**
   * True when changing this alters where a password-reset link is delivered.
   *
   * The desk is warned about exactly these, because approving one is the single
   * most consequential thing on the review screen: it moves the account's
   * recovery path to a different inbox.
   */
  affectsRecovery?: boolean;
}

export const CHANGEABLE_FIELDS: readonly ChangeableField[] = [
  {
    key: "displayName",
    label: "Your name",
    hint: "How your name appears on your card and your reviews.",
    target: "user",
    maxLength: 80,
    inputType: "text",
  },
  {
    key: "apartment",
    label: "Your flat",
    hint: APARTMENT_HINT,
    target: "member",
    maxLength: 20,
    inputType: "text",
  },
  {
    key: "guardianName",
    label: "Your guardian's name",
    target: "guardian",
    maxLength: 80,
    inputType: "text",
  },
  {
    key: "guardianEmail",
    label: "Your guardian's email",
    hint: "This is where we send a link if you forget your password.",
    target: "guardian",
    maxLength: 160,
    inputType: "email",
    affectsRecovery: true,
  },
  {
    key: "guardianPhone",
    label: "Your guardian's phone",
    target: "guardian",
    maxLength: 30,
    inputType: "tel",
  },
];

export const CHANGEABLE_FIELD_KEYS: readonly string[] = CHANGEABLE_FIELDS.map((field) => field.key);

export function changeableField(key: string): ChangeableField | undefined {
  return CHANGEABLE_FIELDS.find((field) => field.key === key);
}

/** Birth year is absent on purpose — see `NOT_CHANGEABLE`. */
export const NOT_CHANGEABLE = {
  birthYear:
    "A reader cannot change their own birth year. It decides whether they are still the right age for the library, so editing it is the one field that could be used to stay past the range — it is corrected by a librarian, who can see the registration it came from.",
  memberCode:
    "A card number is the library's own identifier and appears on the spine labels and in the loan history. It is never edited.",
} as const;

export const CHANGE_LIMITS = {
  /** Long enough to say "we moved to B-204", short enough to read at a glance. */
  noteMaxLength: 200,
  decisionNoteMaxLength: 200,
} as const;

/** A proposal, as stored and as rendered. Values are always strings. */
export type ProposedChanges = Record<string, string>;

/**
 * Keeps only the fields that are on the list, are non-empty, and differ from
 * what is on the record now.
 *
 * Dropping unchanged values matters more than it looks: a form posts every box,
 * so without this a reader correcting one letter of their flat number would
 * submit a request to "change" their guardian's email to the same string — and
 * the desk would be asked to approve a recovery-address change that nobody
 * meant to make.
 */
export function collectChanges(
  submitted: Record<string, string | undefined>,
  current: Record<string, string | null | undefined>,
): ProposedChanges {
  const changes: ProposedChanges = {};

  for (const field of CHANGEABLE_FIELDS) {
    const raw = submitted[field.key];
    if (raw === undefined) continue;

    const value = raw.trim();
    if (value.length === 0) continue;
    if (value.length > field.maxLength) continue;

    const existing = (current[field.key] ?? "").trim();
    if (value === existing) continue;

    changes[field.key] = value;
  }

  return changes;
}

/**
 * Field-level problems with a proposal, in the reader's own words.
 *
 * Runs on both sides. The browser gets to be helpful; the server gets to be
 * right.
 */
export function validateChanges(changes: ProposedChanges): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(changes)) {
    const field = changeableField(key);
    if (!field) {
      errors[key] = "That is not something you can change here.";
      continue;
    }

    if (value.length > field.maxLength) {
      errors[key] = `That is too long — ${field.maxLength} characters at most.`;
      continue;
    }

    if (field.key === "apartment" && !isValidApartment(value)) {
      errors[key] = APARTMENT_ERROR;
      continue;
    }

    if (field.inputType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[key] = "That does not look like an email address.";
      continue;
    }

    if (field.key === "guardianPhone" && !/^[+()\-\s\d]{6,30}$/.test(value)) {
      errors[key] = "That does not look like a phone number.";
    }
  }

  return errors;
}

/** Trims a flat number the same way the registration form does. */
export function normaliseChange(key: string, value: string): string {
  return key === "apartment" ? normaliseApartment(value) : value.trim();
}

export const CHANGE_MESSAGES = {
  heading: "Your details",
  intro:
    "If something here is wrong, change it and the librarian will check it. Nothing changes until they say yes.",
  submitted: "Sent to the librarian. Nothing has changed yet — they will take a look.",
  nothingChanged: "Nothing was different, so there is nothing to send.",
  alreadyWaiting:
    "You already have a change waiting for the librarian. They will look at it soon.",
  withdrawn: "Taken back.",
  pendingTitle: "Waiting for the librarian",
  pendingBody: "You asked for these to be changed. Nothing changes until the librarian says yes.",
  approved: "Applied to the account.",
  rejected: "Sent back to the reader.",
  needReason: "Please say why, so the reader is told something.",
  closedAccount: "This account is closed, so its details cannot be changed here.",
} as const;
