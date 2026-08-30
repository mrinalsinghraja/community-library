/**
 * How big a child's photograph may be, in bytes — and why the number is what
 * it is rather than the largest a phone can produce.
 *
 * There are three ceilings between a parent's camera roll and this library's
 * storage, and only the smallest of them ever applies:
 *
 *   1. Vercel refuses a request body over 4.5 MB before any of our code runs;
 *   2. Next.js refuses a Server Action body over `serverActions.bodySizeLimit`
 *      in `next.config.ts`, which is set to 4 MB to sit under (1);
 *   3. this rule, which `validateUpload` enforces on the bytes that arrive.
 *
 * A limit above (2) is not a limit at all — it is a promise the transport
 * cannot keep, and the way it fails is the whole-page "something went wrong",
 * because a body rejected by the framework never reaches an action that could
 * have answered kindly. That is exactly what a 5 MB rule under a 1 MB default
 * did to a parent registering their child from a phone.
 *
 * So this sits a megabyte below the body limit, which leaves room for the rest
 * of the form, and the picker downscales before submitting anyway — a phone
 * photograph arrives at a couple of hundred kilobytes, and a parent should
 * never meet this number at all.
 */
export const CHILD_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * The longest edge worth keeping for a card picture.
 *
 * The photograph is shown as a round avatar: 72px in the picker, and largest on
 * the reader's own card. 800 covers that at 3× with room to spare, and no child
 * needs a 4000-pixel portrait stored for years to render one.
 */
export const MAX_PHOTO_EDGE = 800;
