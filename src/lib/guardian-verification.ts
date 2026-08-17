import type {
  GuardianVerificationMethod,
  GuardianVerificationStrength,
} from "@prisma/client";

/**
 * Guardian verification policy.
 *
 * ⚠️  THIS FILE DESCRIBES TECHNICAL CATEGORIES, NOT LEGAL SUFFICIENCY.
 *
 * Nothing here asserts that any method satisfies "verifiable parental consent"
 * under India's Digital Personal Data Protection Act, 2023 or any other law.
 * Which strength a deployment must require is a legal decision recorded in
 * `library_settings.required_guardian_verification`, never a constant in code.
 * See docs/GUARDIAN_VERIFICATION.md.
 *
 * The distinction this module exists to hold open:
 *
 *   CONSENT       did a guardian agree, to what wording, when, and can they
 *                 withdraw it?                         → src/lib/consent.ts
 *   VERIFICATION  what evidence is there that the person who agreed is
 *                 actually the child's guardian?       → this file
 *
 * A tickbox produces the first and essentially none of the second. Modelling
 * them together would make raising the bar later a rewrite of consent history.
 *
 * Isomorphic on purpose (no server-only import): the form, the librarian's
 * queue, the services, the seed and the tests all read one ordering.
 */

/**
 * Strength ordering, weakest first.
 *
 * The index is the comparison. It is not a score, a percentage, or a claim
 * about legal weight — only "at least as strong as".
 */
export const VERIFICATION_STRENGTH_ORDER: readonly GuardianVerificationStrength[] = [
  "NONE",
  "SELF_DECLARED",
  "EMAIL_CONFIRMED",
  "STAFF_VERIFIED",
  "IDENTITY_PROVIDER",
];

/**
 * What each method is worth, frozen onto the record when it is created.
 *
 * The same mapping is enforced by a CHECK constraint
 * (`guardian_verification_strength_matches_method`), so a bug here cannot store
 * a tickbox as an identity check — the database refuses the row.
 */
export const STRENGTH_BY_METHOD: Record<
  GuardianVerificationMethod,
  GuardianVerificationStrength
> = {
  SELF_DECLARED: "SELF_DECLARED",
  EMAIL_CONFIRMATION: "EMAIL_CONFIRMED",
  STAFF_VERIFIED: "STAFF_VERIFIED",
  VERIFIED_IDENTITY_PROVIDER: "IDENTITY_PROVIDER",
  // A method a future legal review introduces. Its worth is that review's call,
  // so it is passed in explicitly rather than assumed here.
  OTHER: "NONE",
};

export function strengthRank(strength: GuardianVerificationStrength): number {
  const index = VERIFICATION_STRENGTH_ORDER.indexOf(strength);
  if (index < 0) throw new Error(`Unknown verification strength: ${strength}`);
  return index;
}

/** "Is what we have at least what this library requires?" */
export function meetsRequiredStrength(
  achieved: GuardianVerificationStrength,
  required: GuardianVerificationStrength,
): boolean {
  return strengthRank(achieved) >= strengthRank(required);
}

/** The strongest verification in a set, or NONE. */
export function highestStrength(
  strengths: readonly GuardianVerificationStrength[],
): GuardianVerificationStrength {
  return strengths.reduce<GuardianVerificationStrength>(
    (best, current) => (strengthRank(current) > strengthRank(best) ? current : best),
    "NONE",
  );
}

/**
 * Whether a method can be completed by the guardian alone, without a staff
 * member present. Decides what the registration flow can start on its own.
 */
export function isSelfServiceMethod(method: GuardianVerificationMethod): boolean {
  return method === "SELF_DECLARED" || method === "EMAIL_CONFIRMATION";
}

/**
 * Which method a library should attempt automatically to reach its configured
 * requirement. Returns null when only a human can close the gap — the request
 * then waits in the queue for a librarian, which is the intended behaviour and
 * not an error.
 */
export function selfServiceMethodFor(
  required: GuardianVerificationStrength,
): GuardianVerificationMethod | null {
  switch (required) {
    case "NONE":
    case "SELF_DECLARED":
      return "SELF_DECLARED";
    case "EMAIL_CONFIRMED":
      return "EMAIL_CONFIRMATION";
    // STAFF_VERIFIED and IDENTITY_PROVIDER need somebody other than the person
    // filling in the form.
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Staff-facing. Plain, and never congratulatory about a weak method. */
export const METHOD_LABELS: Record<GuardianVerificationMethod, string> = {
  SELF_DECLARED: "Ticked the box on the form",
  EMAIL_CONFIRMATION: "Confirmed by email",
  STAFF_VERIFIED: "Confirmed by a member of staff",
  VERIFIED_IDENTITY_PROVIDER: "Confirmed by a verified-identity service",
  OTHER: "Other method",
};

export const STRENGTH_LABELS: Record<GuardianVerificationStrength, string> = {
  NONE: "Not verified",
  SELF_DECLARED: "Self-declared only",
  EMAIL_CONFIRMED: "Email confirmed",
  STAFF_VERIFIED: "Staff confirmed",
  IDENTITY_PROVIDER: "Identity service confirmed",
};

/**
 * The banner the librarian's queue shows when the configured requirement is at
 * or below SELF_DECLARED.
 *
 * Deliberately blunt. The single most likely way this system causes harm is
 * somebody believing a ticked box was a check on who that person is.
 */
export const DEVELOPMENT_VERIFICATION_WARNING =
  "DEVELOPMENT / NOT PRODUCTION VERIFICATION — this library currently accepts a ticked box as guardian verification. That records a claim; it does not check who the person is.";

/**
 * True when the configured requirement is weak enough that the warning applies.
 * Read from settings, never assumed from NODE_ENV: a deployment can be in
 * production and still, wrongly, be configured this way — and that is precisely
 * when the warning most needs to appear.
 */
export function isDevelopmentVerificationMode(
  required: GuardianVerificationStrength,
): boolean {
  return strengthRank(required) <= strengthRank("SELF_DECLARED");
}

/**
 * Version of the verification policy. Stored on every record so that raising
 * the bar later leaves the old records legible rather than retroactively
 * reinterpreted.
 *
 * CHANGING THE MEANING OF ANY METHOD ABOVE REQUIRES BUMPING THIS.
 */
export const VERIFICATION_POLICY_VERSION = "2026-08-v1";

/** How long a guardian has to open an emailed confirmation link. */
export const VERIFICATION_CHALLENGE_HOURS = 72;
