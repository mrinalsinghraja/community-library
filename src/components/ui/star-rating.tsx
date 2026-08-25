import { cn } from "@/lib/cn";
import {
  RATING_MAX,
  formatAverage,
  ratingSentence,
  starFills,
  type RatingSummary,
  type StarFill,
} from "@/lib/reviews";

/**
 * A book's rating, drawn.
 *
 * **One star shape, filled by a clip rather than by two overlaid glyphs.** A
 * half star built by stacking a grey star under an orange one is a shape that
 * comes apart the moment a browser rounds a subpixel differently, and this row
 * appears twenty-four times on a shelf page. Here the outline and the fill are
 * the same path drawn twice, the fill clipped to a fraction of its own width,
 * so a half star is exactly half a star at every size and every zoom.
 *
 * **The row is one label, not five.** Read aloud, five stars is five identical
 * announcements that add up to nothing; the whole row carries a single sentence
 * ("4.3 out of 5 stars, from 12 readers") and the glyphs are hidden. That
 * sentence is also the only thing a screen reader gets, which is why it says
 * the count out loud rather than leaving it in brackets.
 *
 * **The count is never optional.** Every caller that renders an average renders
 * the number of readers beside it. 5.0 from one child and 5.0 from forty look
 * identical without it, and a child choosing a book deserves to know which one
 * they are looking at.
 *
 * Colour is decoration only. The average is written next to the stars in
 * figures everywhere it appears, so nothing here depends on telling amber from
 * grey.
 */

const STAR_PATH =
  "M12 2.6l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.02l-5.64 2.96 1.08-6.29L2.87 9.24l6.31-.92L12 2.6Z";

/** How wide the fill is, as a fraction of the star's box. */
const FILL_WIDTH: Record<StarFill, number> = { full: 24, half: 12, empty: 0 };

function Star({ fill, className }: { fill: StarFill; className?: string }) {
  // Unique per shape, not per instance: the three clip rectangles are the same
  // three rectangles on every star on the page, so three defs serve all of them
  // and the DOM does not grow a clipPath per rendered glyph.
  const clipId = `star-clip-${fill}`;

  return (
    <svg viewBox="0 0 24 24" className={cn("size-[1.1em] shrink-0", className)} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={FILL_WIDTH[fill]} height="24" />
        </clipPath>
      </defs>
      {/* The outline is always drawn, so an empty star still reads as a star. */}
      <path d={STAR_PATH} fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
      {fill !== "empty" ? (
        <path d={STAR_PATH} fill="currentColor" clipPath={`url(#${clipId})`} />
      ) : null}
    </svg>
  );
}

/**
 * Five stars and nothing else. For the rare place that supplies its own words.
 */
export function StarRow({
  average,
  className,
  label,
}: {
  average: number;
  className?: string;
  /** The sentence a screen reader gets in place of the glyphs. */
  label: string;
}) {
  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center gap-0.5", className)}>
      {starFills(average).map((fill, index) => (
        <Star key={index} fill={fill} />
      ))}
    </span>
  );
}

/**
 * The rating as it appears on a card, a search result and a book's own page.
 *
 * Three sizes, one shape: stars, the average in figures, the count in brackets.
 * `sm` drops the word "ratings" and keeps the bracketed number, because at card
 * width that word is what pushes the line to wrap.
 */
export function RatingSummaryLine({
  summary,
  size = "md",
  emptyLabel = "No ratings yet",
  className,
}: {
  summary: RatingSummary;
  size?: "sm" | "md" | "lg";
  /** What to say for a book nobody has rated. Null renders nothing at all. */
  emptyLabel?: string | null;
  className?: string;
}) {
  if (summary.count === 0) {
    if (emptyLabel === null) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-ink-faint",
          size === "sm" ? "text-sm" : size === "lg" ? "text-lg" : "text-base",
          className,
        )}
      >
        <StarRow average={0} label={emptyLabel} className="text-ink-faint" />
        {emptyLabel}
      </span>
    );
  }

  const sentence = ratingSentence(summary);

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
        size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-base",
        className,
      )}
    >
      {/*
        Amber, and it is the one place amber is used as a fill rather than as a
        warning. `--color-warn` is the token behind it: this palette has no
        gold, and inventing one for a single component is how a design system
        grows a sixth colour nobody chose.
      */}
      <StarRow average={summary.average} label={sentence} className="text-warn" />

      {/* Figures, always. The stars are the picture; this is the number. */}
      <span aria-hidden="true" className="font-semibold text-ink">
        {formatAverage(summary.average)}
      </span>

      <span aria-hidden="true" className="text-ink-soft">
        {size === "sm"
          ? `(${summary.count})`
          : `(${summary.count} ${summary.count === 1 ? "rating" : "ratings"})`}
      </span>
    </span>
  );
}

/**
 * One reader's own rating, stated rather than averaged.
 *
 * Used on a review and in a child's own history, where "4 out of 5" is a fact
 * about one person and the bracketed count would be meaningless.
 */
export function StarVerdict({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <StarRow
      average={rating}
      label={`${rating} out of ${RATING_MAX} stars`}
      className={cn("text-warn", className)}
    />
  );
}
