/**
 * How big a book cover may be, in bytes.
 *
 * Isomorphic and in one file, because three things have to agree about it and
 * two of them are on opposite sides of the network: the browser's downscaler
 * (which must never *produce* a file the server would refuse), the field's own
 * hint, and `validateUpload`, which is the rule that actually counts.
 *
 * Both ends are about the same thing — a cover is looked at on a phone, on a
 * catalogue card the size of a matchbox and on a book page half a screen wide,
 * and it is kept for as long as the library holds the book.
 *
 * Under the floor is almost always a thumbnail lifted from a search result:
 * sharp at 80 pixels, mush at 300. Over the ceiling is a photograph straight
 * off a camera, which costs every reader on a phone the whole file every time
 * the shelf is drawn.
 *
 * A floor in bytes is a proxy for "big enough to look like something", not a
 * measure of quality — a well-compressed picture can be small and sharp, and
 * this will refuse it. That trade is deliberate: the failure it prevents is a
 * thumbnail becoming the picture on the shelf for years.
 */
export const COVER_MIN_BYTES = 100 * 1024;
export const COVER_MAX_BYTES = 1024 * 1024;
