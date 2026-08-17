import { cn } from "@/lib/cn";

/**
 * A book's cover, or a drawn stand-in when it has none.
 *
 * Most of this library's books will never have a photographed cover — the
 * shelf is stocked by families, not by a supplier with a metadata feed. The
 * fallback is therefore the *normal* case, not an error state, and it is drawn
 * rather than left as a grey box: a spine, a couple of page edges, and the
 * book's own title in the middle. Nothing here ever renders a broken image
 * icon, because there is no `<img>` at all when there is no cover.
 *
 * The tint is derived from the title, so the same book always looks the same
 * and a shelf of coverless books does not look like one repeated tile. All four
 * tints are palette colours used as *shapes*, never behind text — the title
 * sits on the cream surface, at 14.9:1.
 */

const TINTS = [
  "bg-primary-wash",
  "bg-accent-wash",
  "bg-warn-wash",
  "bg-success-wash",
] as const;

/**
 * Stable small hash of the title. Not cryptographic and does not need to be —
 * its only job is to pick the same colour for the same book every time.
 */
function tintFor(title: string): string {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) % 9973;
  }
  return TINTS[hash % TINTS.length];
}

export function BookCover({
  coverMediaId,
  title,
  className,
  sizes = "(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw",
}: {
  coverMediaId: string | null;
  title: string;
  className?: string;
  sizes?: string;
}) {
  const shared = "relative aspect-[2/3] w-full overflow-hidden rounded-[var(--radius-field)]";

  if (coverMediaId) {
    return (
      <div className={cn(shared, "bg-surface-sunk", className)}>
        {/*
          Served through the authorised route like every other stored object —
          there is no public URL for a cover either, so that opening the
          catalogue to the public stays one setting rather than a migration.

          Plain <img>, not next/image: the bytes come from a dynamic route that
          decides authorization per request, which the image optimiser would
          cache in front of.
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
    <div
      className={cn(shared, tintFor(title), "flex items-stretch", className)}
      // Decorative: the title is already the heading next to it, and a screen
      // reader announcing it twice adds nothing.
      aria-hidden="true"
    >
      {/* The spine — the same motif as Card tone="shelf". */}
      <span className="w-3 shrink-0 bg-accent" />
      <span className="flex flex-1 items-center justify-center px-3 py-4">
        <span className="line-clamp-4 text-center font-display text-base font-bold text-ink">
          {title}
        </span>
      </span>
      {/* Page edges. */}
      <span className="w-1.5 shrink-0 border-s-2 border-s-hairline bg-surface" />
    </div>
  );
}
