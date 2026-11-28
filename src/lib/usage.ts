/**
 * Anonymous usage counting, the pure half (ADR-077).
 *
 * Nothing here touches a database or a request, so every rule — which part of
 * the site a path belongs to, what counts as a robot, how a place is written
 * down — is testable on its own. The recorder is `usage-service.ts`.
 */

export const USAGE_RETENTION_DAYS = 90;

/** Display name for every part of the site the report can name. */
export const FEATURE_LABELS = {
  home: "Home page",
  catalogue: "Book catalogue",
  book: "Book page",
  guide: "How to use the library",
  faq: "FAQ",
  rules: "Library rules",
  "how-to-join": "How to join",
  join: "Registration form",
  "sign-in": "Sign in and password",
  "my-books": "My books",
  "my-card": "My library card",
  "my-reviews": "My reviews",
  account: "Account",
  donors: "Donors",
  contact: "Contact",
  legal: "Privacy, terms, accessibility",
  verify: "Guardian verification",
  desk: "Librarian desk",
  admin: "Administration",
  other: "Other pages",
} as const;

export type UsageFeature = keyof typeof FEATURE_LABELS;

const SEGMENT_TO_FEATURE: Record<string, UsageFeature> = {
  books: "catalogue",
  guide: "guide",
  faq: "faq",
  rules: "rules",
  "how-to-join": "how-to-join",
  join: "join",
  login: "sign-in",
  forgot: "sign-in",
  reset: "sign-in",
  activate: "sign-in",
  "my-books": "my-books",
  "my-card": "my-card",
  "my-reviews": "my-reviews",
  account: "account",
  donors: "donors",
  contact: "contact",
  privacy: "legal",
  terms: "legal",
  accessibility: "legal",
  verify: "verify",
  desk: "desk",
  admin: "admin",
};

/**
 * Which part of the site a path belongs to, or null when it must not be
 * counted at all.
 *
 * Only the first segment is ever looked at, and only a name from the list above
 * is ever stored. A path can carry a book's id, a card number or a token in its
 * later segments; none of that can reach the table, because nothing but one of
 * these labels is written.
 */
export function featureForPath(rawPath: unknown): UsageFeature | null {
  if (typeof rawPath !== "string") return null;
  if (rawPath.length === 0 || rawPath.length > 300) return null;
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) return null;

  const path = rawPath.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "home";

  const first = segments[0]!.toLowerCase();
  // The report watches the library; it is not part of what it measures.
  if (first === "report" || first === "api" || first === "dev") return null;

  if (first === "books" && segments.length > 1) return "book";
  return SEGMENT_TO_FEATURE[first] ?? "other";
}

/** Crawlers and link-preview fetchers that run scripts. */
const ROBOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios/i;

export function looksLikeRobot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return ROBOT.test(userAgent);
}

export interface Place {
  country: string;
  region: string;
  city: string;
}

/**
 * The place a connection came from, as the host's own headers report it.
 *
 * A city arrives percent-encoded ("Navi%20Mumbai"). Anything odd is cut short
 * or dropped, since this is the one string from outside that gets stored.
 */
export function cleanPlace(raw: {
  country?: string | null;
  region?: string | null;
  city?: string | null;
}): Place {
  const country = /^[A-Za-z]{2}$/.test(raw.country ?? "") ? raw.country!.toUpperCase() : "??";

  const decode = (value: string | null | undefined): string => {
    if (!value) return "";
    let text = value;
    try {
      text = decodeURIComponent(value);
    } catch {
      // keep it as it came
    }
    return text.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60);
  };

  const region = decode(raw.region).toUpperCase().slice(0, 8);
  return { country, region, city: decode(raw.city) };
}

/** The calendar date, in the library's own timezone, as `YYYY-MM-DD`. */
export function localDateString(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** A `YYYY-MM-DD` as the UTC-midnight Date a Postgres DATE column wants. */
export function dateOnly(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export function addDays(dateString: string, days: number): string {
  const d = dateOnly(dateString);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO 3166-2:IN subdivision codes, as the host reports them. */
export const INDIA_STATES: Record<string, string> = {
  AN: "Andaman and Nicobar Islands",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CH: "Chandigarh",
  CG: "Chhattisgarh",
  CT: "Chhattisgarh",
  DD: "Daman and Diu",
  DH: "Dadra and Nagar Haveli and Daman and Diu",
  DN: "Dadra and Nagar Haveli",
  DL: "Delhi",
  GA: "Goa",
  GJ: "Gujarat",
  HP: "Himachal Pradesh",
  HR: "Haryana",
  JH: "Jharkhand",
  JK: "Jammu and Kashmir",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Ladakh",
  LD: "Lakshadweep",
  MH: "Maharashtra",
  ML: "Meghalaya",
  MN: "Manipur",
  MP: "Madhya Pradesh",
  MZ: "Mizoram",
  NL: "Nagaland",
  OD: "Odisha",
  OR: "Odisha",
  PB: "Punjab",
  PY: "Puducherry",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TG: "Telangana",
  TN: "Tamil Nadu",
  TR: "Tripura",
  TS: "Telangana",
  UK: "Uttarakhand",
  UP: "Uttar Pradesh",
  UT: "Uttarakhand",
  WB: "West Bengal",
};

export function indiaStateName(code: string): string {
  if (!code) return "Unknown state";
  return INDIA_STATES[code] ?? code;
}

export function countryName(code: string): string {
  if (code === "??") return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
