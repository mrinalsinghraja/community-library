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
export const CHILD_PHOTO_MIN_BYTES = 100 * 1024;
export const CHILD_PHOTO_MAX_BYTES = 500 * 1024;

/**
 * The longest edge worth keeping for a card picture.
 *
 * Chosen against the band above, not in isolation. The photograph is shown as a
 * round avatar — 72px in the picker, largest on the reader's own card — so 800
 * would cover every screen. But a phone portrait re-encoded at 800px commonly
 * lands under 100 KB, and a floor that fires on files this application itself
 * produced is a floor that only ever annoys people. 1200 puts an ordinary phone
 * photograph in the middle of the band, and costs nothing anybody will notice.
 */
export const MAX_PHOTO_EDGE = 1200;

/**
 * Where a parent with a picture that is too big can shrink it.
 *
 * Named here rather than typed into the copy so it is one thing to change. It
 * runs entirely in the browser and has no upload path at all — which is the
 * only reason it can be suggested for a photograph of somebody's child.
 */
export const COMPRESS_TOOL_URL = "https://tools.msrx.co.in/image/compress-image";
