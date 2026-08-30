/**
 * How big a child's photograph may be, in bytes.
 *
 * A band rather than a ceiling, and both ends earn their place:
 *
 *   * over the top, every reader waits for bytes that never reach their eyes.
 *     The picture is drawn as a round avatar a couple of centimetres wide, so
 *     anything past this is storage the library pays to keep and bandwidth a
 *     family pays to load, for a difference nobody can see.
 *   * under the floor is almost always a picture that was already small —
 *     lifted from a chat app, or screenshotted — and it goes soft the moment
 *     it is drawn at any size. A library card is kept for years.
 *
 * There are also three transport ceilings between a phone's camera roll and
 * this library's storage, and only the smallest ever applies: Vercel refuses a
 * request body over 4.5 MB before our code runs; Next.js refuses a Server
 * Action body over `serverActions.bodySizeLimit` in `next.config.ts`; and then
 * this rule runs on the bytes that arrive. This band sits far below all of
 * them, which is what keeps the failure a sentence rather than a broken page —
 * see the note in `next.config.ts` for what happened when it did not.
 *
 * Isomorphic and in one file, because three things have to agree about it and
 * two of them are on opposite sides of the network: the picker's own check, the
 * sentence a parent reads, and `validateUpload`, which is the rule that counts.
 */

/**
 * The floor is judged on the file the parent CHOSE. The ceiling is judged on
 * the file that is SENT, after the picker has shrunk it.
 *
 * That split is not a hedge, it is the only pair of questions that can both be
 * answered honestly, and it was learned the hard way.
 *
 * A byte count is a proxy for detail, and it stops being a proxy for anything
 * the moment this application picks the encoding. A 6.6 MB photograph of a
 * plain subject — a wall, a sky, a child against a blurred background —
 * re-encoded at 2000px and quality 0.92 comes out at 74 KB. It is an excellent
 * card picture. Measured against a 100 KB floor it is "too small", and the only
 * way to lift it over the line is to re-encode at quality 0.98, which costs
 * 219 KB for no difference any eye can see. A floor that can only be satisfied
 * by wasting storage is a floor working against the reason it was asked for.
 *
 * What the floor is genuinely for is the picture that was small before we
 * touched it: lifted from a chat app, screenshotted, 17 KB and soft at any
 * size. That is a property of the chosen file, so that is what it is measured
 * against — and it is measured before any shrinking runs, which also makes it
 * the fastest answer the picker can give.
 *
 * The ceiling has no such problem. It is about what the library stores and what
 * every reader downloads, so it belongs on the bytes that are actually sent,
 * and `validateUpload` enforces it on the bytes that actually arrive.
 */
export const CHILD_PHOTO_MIN_BYTES = 100 * 1024;
export const CHILD_PHOTO_MAX_BYTES = 500 * 1024;

/**
 * The largest edge a card picture is ever kept at.
 *
 * Not the size most photographs end up: the picker starts here and steps *down*
 * until the file fits under the ceiling, so a dense photograph is stored small
 * and a smooth one is stored large. That direction matters, and it is the fix
 * for a real failure — a 6.6 MB photograph of a plain subject re-encoded at
 * 1200px came out at 90 KB, under the floor, and the parent was told their
 * picture was too small about a file this application had just made from a
 * perfectly good one. Starting low and never climbing could not recover from
 * that; starting high and stepping down cannot cause it.
 *
 * The picture is drawn as a round avatar, so nothing here is about how it
 * looks at 2000px. It is about landing inside the band with the least damage.
 */
export const MAX_PHOTO_EDGE = 2000;

/**
 * Where a parent with a picture that is too big can shrink it.
 *
 * Named here rather than typed into the copy so it is one thing to change. It
 * runs entirely in the browser and has no upload path at all — which is the
 * only reason it can be suggested for a photograph of somebody's child.
 */
export const COMPRESS_TOOL_URL = "https://tools.msrx.co.in/image/compress-image";
