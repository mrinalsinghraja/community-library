/**
 * A small blocklist of passwords that are guessed first.
 *
 * This is deliberately short. It is not a substitute for rate limiting and
 * lockout — it exists so that the single most common choice a child (or a
 * hurried adult) makes is refused with a friendly nudge rather than accepted.
 *
 * Entries are lowercase; lookups lowercase the candidate first.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  // Universal favourites
  "password",
  "password1",
  "password123",
  "passw0rd",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "111111",
  "000000",
  "abc123",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "letmein",
  "welcome",
  "welcome1",
  "admin",
  "admin123",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "batman",
  "trustno1",
  "master",
  "shadow",
  "michael",
  "jennifer",
  "hello",
  "hello123",
  "changeme",
  "secret",
  "starwars",
  "pokemon",
  "minecraft",
  "roblox",
  "fortnite",
  "unicorn",
  "rainbow",

  // Things a reader of this particular library might reach for first
  "library",
  "library1",
  "library123",
  "books",
  "book123",
  "reading",
  "mylibrary",
]);

/**
 * Words a specific library should also refuse — its own name, its community's
 * name — are NOT listed here. They come from configuration and are passed to
 * checkPasswordPolicy() at call time, so this file stays community-agnostic.
 */
