/**
 * The help link.
 *
 * A parent who cannot get their child registered has, until now, had exactly
 * one way to ask for help: an email address, answered whenever somebody next
 * opens that inbox. In this building the thing everyone already has open is
 * WhatsApp, so the fastest door out of a stuck form is a message to a neighbour
 * who runs the library.
 *
 * The number is **not** written in this file. It is the library's own
 * `contactPhone` setting, so it can change without a release and so a
 * volunteer's personal number never sits in a public repository. When the
 * setting is empty the whole block is simply not rendered — an affordance that
 * opens WhatsApp addressed to nobody is worse than no affordance.
 *
 * Isomorphic and pure: the same function builds the link on the home page, the
 * joining guide and anywhere later, so those cannot drift apart.
 */

/**
 * Assumed when a number is written the way people in this community write it —
 * ten digits, no prefix. `wa.me` will not accept that: it needs the full
 * international form with no `+` and no punctuation.
 */
export const DEFAULT_COUNTRY_CODE = "91";

/** The shortest and longest an E.164 subscriber number can be, digits only. */
const MIN_DIGITS = 10;
const MAX_DIGITS = 15;

/**
 * Turns whatever an administrator typed into the digits `wa.me` wants.
 *
 * Accepts `+91 96633 12707`, `+919663312707`, `0091-9663312707`, `9663312707`
 * and the same with dots or parentheses, because a phone number is one of the
 * few fields where everybody has their own punctuation and none of them are
 * wrong. Returns null when what is left cannot be a phone number, which is the
 * signal to render nothing at all.
 */
export function toWhatsAppNumber(raw: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  let digits = raw.replace(/\D/g, "");

  // International access prefix. `0091…` and `+91…` mean the same thing, and
  // only one of them survives stripping the punctuation.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // A bare local number. Ten digits with no country code is how this number is
  // written on a noticeboard, and it is what an administrator will paste.
  if (digits.length === MIN_DIGITS) digits = `${countryCode}${digits}`;

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return digits;
}

/**
 * A `wa.me` link that opens a chat with the message already typed.
 *
 * The prefilled text matters more than it looks: it means a parent who is
 * embarrassed to be stuck, or who is not confident writing in English, has
 * nothing to compose. They press the button and press send.
 */
export function whatsAppLink(
  raw: string | null | undefined,
  message: string,
  countryCode = DEFAULT_COUNTRY_CODE,
): string | null {
  if (!raw) return null;

  const number = toWhatsAppNumber(raw, countryCode);
  if (!number) return null;

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * What the parent's message says before they have typed anything.
 *
 * First person, and about the child rather than about the software: somebody
 * asking for help does not know whether their problem is the form, the email or
 * the flat number, and should not have to.
 */
export const JOIN_HELP_MESSAGE = "Hi, can you help me to create an account for my child?";

/**
 * What a neighbour offering books says before they have typed anything.
 *
 * The same door as `JOIN_HELP_MESSAGE` and a different sentence through it,
 * because the two people are not in the same situation. One is stuck; this one
 * has a carton in the hall and a question they are slightly shy about — is this
 * the sort of thing you want, and what do I do with it?
 *
 * So it asks that, and it asks it *before* committing: "would like to give"
 * rather than "am giving". Nobody should have to feel they have signed
 * something by pressing a button, least of all on the one page whose whole
 * argument is that giving is voluntary. The librarian answers, and the family
 * is still free to say never mind.
 *
 * No apostrophe in it, which is not fussiness: `encodeURIComponent` leaves `'`
 * alone, so it travels to the page as a literal character inside an `href`,
 * gets escaped to `&#x27;` on the way out, and the sentence is then depending on
 * two unrelated decoders agreeing. Writing around it costs one word.
 */
export const DONATE_BOOKS_MESSAGE =
  "Hi, I have some books for children that I would like to give to the library. What should I do?";
