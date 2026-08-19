import { cn } from "@/lib/cn";

/**
 * A book's cover, or a drawn stand-in when it has none.
 *
 * Most of this library's books will never have a photographed cover — the
 * shelf is stocked by families, not by a supplier with a metadata feed. The
 * fallback is therefore the *normal* case, not an error state, and it is drawn
 * rather than left as a grey box. Nothing here ever renders a broken image
 * icon, because there is no `<img>` at all when there is no cover.
 *
 * **The fallback does not carry the title.** It used to, and on a book's own
 * page that put the same words twice within an inch of each other — once as
 * "art" and once as the heading. Every surface that shows a cover already shows
 * the title beside or beneath it, so the drawing says "a book" and lets the
 * heading say which one.
 *
 * Books still look different from each other: the tint and the cover motif are
 * derived from the title, so the same book is always the same colour and a
 * shelf of coverless books is not one tile repeated twelve times.
 *
 * All tints are palette colours used as *shapes*. No text sits on them.
 */

const TINTS = [
  { wash: "#E8F2EE", ink: "var(--color-primary)" }, // primary-wash
  { wash: "#FBEAF3", ink: "var(--color-accent)" }, // accent-wash
  { wash: "#FDF2DF", ink: "var(--color-sun-ink)" }, // warn-wash
  { wash: "#EAF4EA", ink: "var(--color-success)" }, // success-wash
  { wash: "#E7F0F7", ink: "var(--color-primary-deep)" }, // sky-wash
  { wash: "#EFEAF7", ink: "var(--color-accent-ink)" }, // lavender-wash
] as const;

/**
 * Stable small hash of the title. Not cryptographic and does not need to be —
 * its only job is to pick the same colour for the same book every time.
 */
function hashTitle(title: string): number {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) % 9973;
  }
  return hash;
}

/**
 * The one drawn stand-in, used at every size from a 48px row thumbnail to the
 * 240px cover on a book's own page.
 *
 * One SVG rather than a composition of absolutely-positioned pieces, so it
 * scales exactly: every element is proportional to the viewBox and there is no
 * size at which the drawing falls apart. Decorative throughout, so the whole
 * thing is `aria-hidden`.
 *
 * `variant="thumb"` drops the butterfly and the sprig. At 48px they are four
 * pixels of noise beside a book that still reads perfectly well on its own.
 */
export function BookCoverArt({
  title,
  variant = "full",
  className,
}: {
  title: string;
  variant?: "thumb" | "full";
  className?: string;
}) {
  const hash = hashTitle(title);
  const tint = TINTS[hash % TINTS.length];
  const decorated = variant === "full";

  /*
   * A shelf of coverless books must not look like one tile repeated twelve
   * times, so three things vary with the title and nothing varies at random:
   * the ground, the spine, and how much writing is on the page. A child
   * scanning the shelf still recognises "the green one with the short title".
   */
  const spine = tint.ink;
  const lines = [
    [56, 42, 50],
    [50, 58, 38],
    [44, 52, 56],
  ][hash % 3];
  const leafLeft = hash % 2 === 0;

  return (
    <svg
      viewBox="0 0 200 300"
      className={cn("h-full w-full", className)}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="200" height="300" fill={tint.wash} />

      {/* the shadow the book sits in */}
      <ellipse cx="102" cy="243" rx="56" ry="9" fill="var(--color-ink)" opacity="0.07" />

      {/* the volume behind, so the shape reads as an object and not a rectangle */}
      <rect x="56" y="70" width="100" height="168" rx="9" fill={tint.ink} opacity="0.16" />

      {/* the book itself */}
      <rect x="44" y="62" width="104" height="168" rx="9" fill="#FFFFFF" />
      <path d="M44 71a9 9 0 0 1 9-9h7v168h-7a9 9 0 0 1-9-9z" fill={spine} />
      {/* page edges */}
      <rect x="141" y="68" width="6" height="156" rx="3" fill="var(--color-hairline)" />

      {/* lines of writing, never words */}
      {lines.map((width, index) => (
        <rect
          key={index}
          x="74"
          y={102 + index * 18}
          width={width}
          height="8"
          rx="4"
          fill="var(--color-ink)"
          opacity="0.13"
        />
      ))}

      {/* one leaf growing out of the page, the same motif as the garden rule */}
      <g transform={leafLeft ? undefined : "translate(208 0) scale(-1 1)"}>
        <path
          d="M104 204c0-14 0-24 0-34"
          stroke="var(--color-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M104 188c-11 0-16-7-16-16 11 0 16 7 16 16Z" fill="var(--color-leaf)" />
        <path
          d="M104 176c11 0 16-7 16-16-11 0-16 7-16 16Z"
          fill="var(--color-primary)"
          opacity="0.85"
        />
      </g>

      {decorated ? (
        <>
          {/* a butterfly, in the same hand as every other one in the library */}
          <g opacity="0.85">
            <ellipse cx="160" cy="36" rx="12" ry="9" fill="var(--color-accent)" transform="rotate(-24 160 36)" />
            <ellipse cx="176" cy="36" rx="12" ry="9" fill="var(--color-accent)" transform="rotate(24 176 36)" />
            <rect x="166.6" y="31" width="2.8" height="19" rx="1.4" fill="var(--color-ink)" opacity="0.7" />
          </g>

          {/* grass at the foot of the shelf */}
          <path
            d="M22 258q6-16 12 0M40 258q5-12 10 0M162 258q6-16 12 0M180 258q5-12 10 0"
            stroke="var(--color-leaf)"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
        </>
      ) : null}
    </svg>
  );
}

export function BookCover({
  coverMediaId,
  title,
  className,
  variant = "full",
  sizes = "(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw",
}: {
  coverMediaId: string | null;
  title: string;
  className?: string;
  /** `thumb` simplifies the drawn stand-in for row-sized thumbnails. */
  variant?: "thumb" | "full";
  sizes?: string;
}) {
  /*
   * The 2:3 box is declared by the container, not by the image, so the space is
   * reserved before a single byte of the cover arrives. That is what keeps a
   * grid of twenty books from reflowing as they load — the layout never depends
   * on the picture's own proportions.
   */
  const shared = "relative aspect-[2/3] w-full overflow-hidden rounded-[var(--radius-field)]";

  if (coverMediaId) {
    return (
      <div className={cn(shared, "bg-surface-sunk", className)}>
        {/*
          Served through the authorised route like every other stored object —
          there is no public URL for a cover either, so that opening the
          catalogue to the public stays one setting rather than a migration.

          Plain <img>, not next/image, and that is a security decision rather
          than an oversight. Next's optimiser fetches the source once and then
          serves the resized result from /_next/image?url=… — a URL with no
          session on it. Putting a member-only cover behind that cache would
          hand out an unauthenticated way to read it. Covers are instead kept
          small at the point of upload (see the cover picker), so the bytes a
          thumbnail downloads are already thumbnail-sized.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/media/${coverMediaId}`}
          alt={`Cover of ${title}`}
          sizes={sizes}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className={cn(shared, className)}>
      <BookCoverArt title={title} variant={variant} />
    </div>
  );
}
