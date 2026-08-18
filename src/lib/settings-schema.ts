/**
 * What a Super Admin may change, and how far.
 *
 * Isomorphic on purpose — no `server-only` marker — because three callers must
 * agree about the same numbers: the form that renders the bounds as `min`/`max`
 * attributes, the service that enforces them, and the tests that prove the
 * service does. A bound written twice is a bound that will disagree with itself.
 *
 * Two lists carry most of the weight here:
 *
 *   • `EDITABLE_SETTING_FIELDS` — an allowlist. The service builds its update
 *     from this list and nothing else, so a column that is not on it cannot be
 *     written through the settings screen however a form is tampered with.
 *   • `UNAVAILABLE_FEATURES` — the honest half. Configuration that exists in the
 *     schema and does nothing is rendered as "Not available yet", never as a
 *     switch. A control that looks like a rule but is not one is worse than a
 *     missing feature: it is a promise the software will not keep.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * The numbers a library may choose between, and the values the owner approved.
 *
 * The defaults are not re-decided here — they are the ones in the Prisma schema
 * and in ADR-032 (fourteen days, two books, one renewal, fourteen more days).
 * They appear again only so a screen can offer "back to the usual" without
 * hard-coding a policy number into a component.
 */
export const SETTING_BOUNDS = {
  borrowingPeriodDays: { min: 1, max: 30, standard: 14 },
  maxActiveLoans: { min: 1, max: 5, standard: 2 },
  maxRenewals: { min: 0, max: 3, standard: 1 },
  renewalPeriodDays: { min: 1, max: 30, standard: 14 },
  ageMin: { min: 2, max: 18, standard: 5 },
  ageMax: { min: 2, max: 18, standard: 14 },
} as const;

/** Code prefixes are printed on physical labels and cards, so: short and plain. */
export const CODE_PREFIX_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,9}$/;

/**
 * Date formats offered to a librarian, as date-fns patterns.
 *
 * A free-text pattern field would let somebody type `dd/MM/yy HH:mm:ss` into a
 * children's library and then wonder why the shelf looks like a spreadsheet.
 */
export const DATE_FORMAT_OPTIONS = [
  { value: "d MMM yyyy", example: "3 Sep 2026" },
  { value: "dd/MM/yyyy", example: "03/09/2026" },
  { value: "d MMMM yyyy", example: "3 September 2026" },
  { value: "yyyy-MM-dd", example: "2026-09-03" },
] as const;

/**
 * Timezones offered in the dropdown. Any valid IANA zone is accepted by the
 * validator below — this list is only what the screen suggests, so that the
 * common answer is one tap rather than a search through six hundred names.
 */
export const TIMEZONE_OPTIONS = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
] as const;

export function isValidTimezone(value: string): boolean {
  try {
    // Throws RangeError on an unknown zone. Cheap, and it is the runtime's own
    // list rather than one this repository would have to maintain.
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/**
 * Every `library_settings` column the settings screen may write.
 *
 * Guardian verification and the reminder switch are deliberately NOT here: both
 * are written through their own service functions, because both need something
 * an ordinary field does not — an explicit confirmation, and a precondition on
 * the environment.
 */
export const EDITABLE_SETTING_FIELDS = [
  "timezone",
  "dateFormat",
  "borrowingPeriodDays",
  "maxActiveLoans",
  "maxRenewals",
  "renewalPeriodDays",
  "ageMin",
  "ageMax",
  "memberCodePrefix",
  "copyCodePrefix",
  "catalogueVisibility",
] as const;

export type EditableSettingField = (typeof EDITABLE_SETTING_FIELDS)[number];

/** Branding columns the branding screen may write. `libraryName` is on `library`. */
export const EDITABLE_BRANDING_FIELDS = [
  "primaryColor",
  "welcomeMessage",
  "rulesMarkdown",
  "donationPolicyMarkdown",
  "contactEmail",
  "contactPhone",
] as const;

// ---------------------------------------------------------------------------
// Things that exist and do nothing
// ---------------------------------------------------------------------------

export interface UnavailableFeature {
  /** What a librarian would call it. */
  label: string;
  /** Why it is not here, in one sentence, without jargon. */
  reason: string;
  /** The column or permission it would have been, for the documentation. */
  backedBy: string;
}

/**
 * Rendered under "Not available yet" on the settings screen, as text.
 *
 * Nothing in this list gets a control of any kind. The point is that a librarian
 * who wonders "can I stop a child borrowing while a book is late?" gets a
 * straight no on the screen instead of finding a column in the database later
 * and assuming it works.
 */
export const UNAVAILABLE_FEATURES: readonly UnavailableFeature[] = [
  {
    label: "Reserving a book",
    reason: "There is one shelf in one room. Nothing can be held or queued for.",
    backedBy: "library_settings.renewal_blocked_when_reserved",
  },
  {
    label: "Stopping a child borrowing while a book is late",
    reason:
      "A late book would become a closed door for a nine-year-old. Whether this library wants that is not the software's decision.",
    backedBy: "library_settings.block_on_overdue_days",
  },
  {
    label: "A single switch for all email",
    reason:
      "Switching all email off would silently stop the links families need to join, with nothing on screen to explain it.",
    backedBy: "library_settings.email_enabled",
  },
  {
    label: "Reports",
    reason: "Not built yet.",
    backedBy: "permission report.view",
  },
  {
    label: "Announcements",
    reason: "Not built yet.",
    backedBy: "permission announcement.manage",
  },
  {
    label: "Overriding a borrowing rule at the desk",
    reason: "Not built yet. The rules above are the rules.",
    backedBy: "permission loan.override_rules",
  },
  {
    label: "Marking a book lost",
    reason: "A copy's condition is changed on the book's own page instead.",
    backedBy: "permission loan.mark_lost",
  },
];

/*
 * There is deliberately no second list of dormant columns here.
 * `DORMANT_CIRCULATION_SETTINGS` in `@/lib/circulation` is the one that exists,
 * and the settings screen keeps its promise by construction instead: the update
 * is assembled from `EDITABLE_SETTING_FIELDS`, and a dormant column is simply
 * not on it. A test asserts the two lists never overlap.
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const bounded = (bound: { min: number; max: number }, label: string) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(bound.min, `${label} must be at least ${bound.min}.`)
    .max(bound.max, `${label} must be at most ${bound.max}.`);

const prefix = (label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => CODE_PREFIX_PATTERN.test(value), {
      message: `${label} should be 2–10 characters: capitals, numbers and hyphens.`,
    });

export const librarySettingsSchema = z
  .object({
    libraryName: z
      .string()
      .trim()
      .min(2, "The library needs a name.")
      .max(80, "That name is too long for a heading."),
    timezone: z
      .string()
      .trim()
      .refine(isValidTimezone, { message: "That is not a timezone this server knows." }),
    dateFormat: z.enum(
      DATE_FORMAT_OPTIONS.map((option) => option.value) as [string, ...string[]],
      { error: "Choose one of the date formats offered." },
    ),
    borrowingPeriodDays: bounded(SETTING_BOUNDS.borrowingPeriodDays, "The loan period"),
    maxActiveLoans: bounded(SETTING_BOUNDS.maxActiveLoans, "The number of books"),
    maxRenewals: bounded(SETTING_BOUNDS.maxRenewals, "The number of renewals"),
    renewalPeriodDays: bounded(SETTING_BOUNDS.renewalPeriodDays, "The renewal period"),
    ageMin: bounded(SETTING_BOUNDS.ageMin, "The youngest age"),
    ageMax: bounded(SETTING_BOUNDS.ageMax, "The oldest age"),
    memberCodePrefix: prefix("The reader card prefix"),
    copyCodePrefix: prefix("The book label prefix"),
    catalogueVisibility: z.enum(["MEMBER_ONLY", "PUBLIC"], {
      error: "Choose who may browse the books.",
    }),
  })
  .refine((value) => value.ageMin <= value.ageMax, {
    path: ["ageMax"],
    message: "The oldest age cannot be younger than the youngest.",
  });

export type LibrarySettingsInput = z.infer<typeof librarySettingsSchema>;

/** `#rrggbb`. One colour, not a theme builder. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * WCAG relative luminance, and the contrast ratio between two colours.
 *
 * Here because the library mark is drawn as white shapes on the brand colour,
 * and a pale colour makes the logo disappear. Phase 0 measured every token
 * numerically rather than judging it by eye (`DESIGN_SYSTEM.md`); a colour a
 * Super Admin types in gets the same treatment instead of being trusted.
 */
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const part = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(hex: string, against = "#FFFFFF"): number {
  const a = relativeLuminance(hex);
  const b = relativeLuminance(against);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The floor for the brand colour: 3:1 against white, WCAG's threshold for a
 * graphical object that has to be distinguishable. Not 4.5:1 — no text is
 * printed on this colour today, and demanding a text ratio would rule out
 * perfectly good mid-tones for no benefit.
 */
export const MIN_BRAND_CONTRAST = 3;

export const brandingSchema = z.object({
  primaryColor: z
    .string()
    .trim()
    .refine((value) => HEX_COLOR_PATTERN.test(value), {
      message: "Use a colour like #1F6F5C.",
    })
    .refine((value) => !HEX_COLOR_PATTERN.test(value) || contrastRatio(value) >= MIN_BRAND_CONTRAST, {
      message: "That colour is too pale — the library's mark would disappear. Try a deeper one.",
    }),
  welcomeMessage: z
    .string()
    .trim()
    .max(160, "Keep the welcome short enough for a child to read in one breath.")
    .optional(),
  rulesMarkdown: z.string().trim().max(8000, "That is longer than anyone will read.").optional(),
  donationPolicyMarkdown: z
    .string()
    .trim()
    .max(8000, "That is longer than anyone will read.")
    .optional(),
  contactEmail: z
    .union([z.literal(""), z.email("That does not look like an email address.")])
    .optional(),
  contactPhone: z
    .string()
    .trim()
    .max(30, "That is too long for a phone number.")
    .optional(),
});

export type BrandingInput = z.infer<typeof brandingSchema>;
