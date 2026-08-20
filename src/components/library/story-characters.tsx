import { cn } from "@/lib/cn";

/**
 * The garden, behind everything.
 *
 * A single fixed layer of drawings that sits under the whole reader-facing
 * application: a fox, a cat, a rabbit, a bird, a stack of books, some
 * sprigs, and the mark's own butterflies.
 *
 * Three rules keep it from becoming wallpaper in the bad sense:
 *
 *   1. **It is barely there.** Around 5% opacity in the leaf green and the
 *      berry — enough that the page reads as a place rather than a background
 *      colour, not enough to compete with a word on top of it. Every contrast
 *      ratio in this system was measured against the flat ground, and at this
 *      strength the drawings do not move any of them.
 *   2. **It never reaches the desk.** Staff screens keep their plain white:
 *      a librarian is working with a queue of children in front of them, and
 *      the reader app's visual language would slow them down. Same reason the
 *      desk has always been a different world.
 *   3. **It is decoration and says so.** `aria-hidden`, no pointer events, and
 *      the small drawings drop out below `sm` where there is no room for them.
 *
 * The drawings are ORIGINAL flat vector — the same hand as the butterflies in
 * `library-logo`, deliberately not the brush stroke of the library's real mark.
 */

/** Placement, in viewport units, so the layer composes at any window size. */
interface Spot {
  /** Tailwind positioning for this motif. */
  className: string;
  motif: Motif;
  tone: "leaf" | "berry" | "sun";
  size: number;
}

type Motif = "fox" | "rabbit" | "cat" | "bird" | "books" | "sprig" | "butterfly";

const TONE: Record<Spot["tone"], string> = {
  leaf: "var(--color-leaf)",
  berry: "var(--color-accent)",
  sun: "var(--color-sun-ink)",
};

const SPOTS: Spot[] = [
  /*
   * Placed along the edges, never behind the reading column. A drawing under a
   * paragraph is a drawing in the way, however faint it is.
   */
  { className: "left-[2%] top-[22%]", motif: "fox", tone: "berry", size: 150 },
  { className: "right-[3%] top-[10%] hidden sm:block", motif: "butterfly", tone: "berry", size: 64 },
  { className: "right-[2%] top-[44%]", motif: "cat", tone: "leaf", size: 158 },
  { className: "left-[4%] bottom-[8%] hidden sm:block", motif: "rabbit", tone: "leaf", size: 128 },
  { className: "right-[6%] bottom-[7%] hidden lg:block", motif: "books", tone: "sun", size: 112 },
  { className: "left-[15%] top-[5%] hidden xl:block", motif: "sprig", tone: "leaf", size: 92 },
  { className: "left-[19%] bottom-[38%] hidden xl:block", motif: "bird", tone: "berry", size: 74 },
];

export function StoryCharacters({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 select-none overflow-hidden",
        className,
      )}
    >
      {SPOTS.map((spot, index) => (
        <div key={index} className={cn("absolute opacity-[0.05]", spot.className)}>
          <Motif name={spot.motif} fill={TONE[spot.tone]} size={spot.size} />
        </div>
      ))}
    </div>
  );
}

/*
 * Every one of these is a SILHOUETTE, and that is a constraint rather than a
 * style. Interior detail — an eye, a page line, a whisker — disappears entirely
 * at five percent and leaves a smudge behind; a shape that is recognisable by
 * its outline alone still reads. So: one confident outline each, and nothing
 * inside it.
 */
function Motif({ name, fill, size }: { name: Motif; fill: string; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    fill,
    focusable: "false" as const,
  };

  switch (name) {
    /*
     * A fox, in profile, with the snout and the tail doing all the work.
     *
     * Every part overlaps the mass it belongs to — an ear drawn beside a head
     * rather than into it reads as a floating triangle, which is what the first
     * attempt at these was. And the snout and the brush are exaggerated on
     * purpose: without them a pointy-eared animal with a curled tail is just
     * the cat again, and two of the same silhouette is worse than one.
     */
    case "fox":
      return (
        <svg {...common}>
          <path d="M34 34 27 8l20 16ZM62 32 70 8 50 24Z" />
          <ellipse cx="48" cy="38" rx="19" ry="16" />
          {/* the snout, well clear of the head */}
          <path d="M34 38 13 48l21 11Z" />
          <path d="M48 46c13 0 22 13 22 30v10H26V76c0-17 9-30 22-30Z" />
          {/* the brush: wide, and it comes back on itself */}
          <path d="M62 86c19 0 32-13 32-32 0-13-7-22-16-22-6 0-10 5-8 10 3 7 7 10 7 18 0 12-8 19-21 19Z" />
        </svg>
      );

    /* A cat in profile, sitting, tail curled round its feet. */
    case "cat":
      return (
        <svg {...common}>
          <path d="M27 32 23 8l16 14ZM53 30 59 8 43 20Z" />
          <circle cx="40" cy="34" r="17" />
          {/* back, sloping down and away from the head */}
          <path d="M46 30c14 2 24 18 24 38v18H30V52c0-11 6-19 16-22Z" />
          {/* tail, up and over */}
          <path d="M66 86c13 0 21-8 21-20 0-8-4-13-9-13-4 0-6 3-4 6 2 4 4 6 4 10 0 7-5 11-13 11Z" />
        </svg>
      );

    /*
     * A rabbit. Long ROUNDED ears, where the cat and the fox have points — the
     * one place these three could be confused for each other is the top of the
     * head, so that is where they are told apart.
     */
    case "rabbit":
      return (
        <svg {...common}>
          <ellipse cx="40" cy="26" rx="7" ry="22" transform="rotate(-12 40 26)" />
          <ellipse cx="58" cy="26" rx="7" ry="22" transform="rotate(12 58 26)" />
          <circle cx="49" cy="52" r="17" />
          <ellipse cx="52" cy="76" rx="24" ry="19" />
          {/* the cotton tail */}
          <circle cx="26" cy="72" r="8" />
        </svg>
      );

    /* A bird, mid-hop. */
    case "bird":
      return (
        <svg {...common}>
          <ellipse cx="46" cy="52" rx="22" ry="17" />
          <circle cx="67" cy="38" r="11" />
          <path d="M77 35l13 4-13 6Z" />
          <path d="M28 46c-9-6-17-6-23-2 6 1 11 4 13 9Z" />
          <path d="M42 68l-2 16M54 68l3 16" stroke={fill} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      );

    /* Three books, stacked the way a child leaves them. */
    case "books":
      return (
        <svg {...common}>
          <rect x="16" y="60" width="68" height="12" rx="3" />
          <rect x="22" y="46" width="58" height="12" rx="3" transform="rotate(-4 51 52)" />
          <rect x="28" y="32" width="46" height="12" rx="3" transform="rotate(3 51 38)" />
          <rect x="20" y="74" width="60" height="10" rx="3" />
        </svg>
      );

    /* A sprig from the rule beneath the wordmark. */
    case "sprig":
      return (
        <svg {...common}>
          <path d="M50 92V22" stroke={fill} strokeWidth="4" strokeLinecap="round" />
          <path d="M50 40c-12-2-19-9-20-20 12 1 19 8 20 20ZM50 40c12-2 19-9 20-20-12 1-19 8-20 20ZM50 64c-11-2-17-8-18-18 11 1 17 7 18 18ZM50 64c11-2 17-8 18-18-11 1-17 7-18 18Z" />
        </svg>
      );

    /* The mark's own motif, in the same flat hand as the logo file. */
    case "butterfly":
    default:
      return (
        <svg {...common}>
          <ellipse cx="28" cy="34" rx="20" ry="16" transform="rotate(-28 28 34)" />
          <ellipse cx="72" cy="34" rx="20" ry="16" transform="rotate(28 72 34)" />
          <ellipse cx="34" cy="68" rx="14" ry="11" transform="rotate(-16 34 68)" />
          <ellipse cx="66" cy="68" rx="14" ry="11" transform="rotate(16 66 68)" />
          <ellipse cx="50" cy="50" rx="4.5" ry="27" />
          <path d="M50 26 40 8M50 26 60 8" stroke={fill} strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
  }
}
