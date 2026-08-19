import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The library mark, and the small family of drawings that keep it company.
 *
 * Order of preference for the mark:
 *   1. a logo an administrator uploaded on the branding screen — always wins;
 *   2. the mark packaged with this deployment at /brand/library-mark.png.
 *
 * The packaged file is a deployment asset, not a platform default: it lives in
 * public/, never in src/, so the branding lint rule stays true and another
 * community installing this software replaces one file (or uploads their own)
 * without touching a line of code.
 *
 * The drawings below are ORIGINAL and deliberately flat-vector. The mark's own
 * butterflies are brush-drawn; copying that stroke would be redrawing somebody
 * else's logo. These are plainly a different hand in the same berry — family,
 * not forgery.
 */

const PACKAGED_MARK = "/brand/library-mark.png";

/** The mark's true aspect (640 × 690), so nothing is ever squashed. */
const MARK_RATIO = 690 / 640;

export function LibraryLogo({
  logoUrl,
  libraryName,
  size = 56,
  className,
  priority = true,
}: {
  logoUrl: string | null;
  libraryName: string;
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  const src = logoUrl ?? PACKAGED_MARK;

  return (
    <Image
      src={src}
      alt={`${libraryName} logo`}
      width={size}
      height={Math.round(size * MARK_RATIO)}
      className={cn("object-contain", className)}
      priority={priority}
    />
  );
}

/**
 * A butterfly. Three sizes, one shape, always berry.
 *
 * Decorative everywhere it is used, so it is hidden from assistive technology —
 * a screen reader announcing "butterfly" four times on the way to the catalogue
 * would be a worse experience, not a richer one.
 */
export function Butterfly({
  className,
  tone = "berry",
}: {
  className?: string;
  tone?: "berry" | "soft" | "leaf";
}) {
  const fill =
    tone === "berry"
      ? "var(--color-accent)"
      : tone === "leaf"
        ? "var(--color-leaf)"
        : "var(--color-accent-wash)";

  return (
    <svg viewBox="0 0 48 40" className={cn("h-auto", className)} aria-hidden="true" focusable="false">
      {/* upper wings */}
      <ellipse cx="16" cy="14" rx="11" ry="9" fill={fill} transform="rotate(-24 16 14)" />
      <ellipse cx="32" cy="14" rx="11" ry="9" fill={fill} transform="rotate(24 32 14)" />
      {/* lower wings, a little smaller so the silhouette reads as a butterfly at 16px */}
      <ellipse cx="18" cy="27" rx="8" ry="7" fill={fill} opacity="0.82" transform="rotate(-12 18 27)" />
      <ellipse cx="30" cy="27" rx="8" ry="7" fill={fill} opacity="0.82" transform="rotate(12 30 27)" />
      {/* body and antennae */}
      <rect x="22.6" y="9" width="2.8" height="23" rx="1.4" fill="var(--color-ink)" opacity="0.72" />
      <path
        d="M23 9 C 21 5, 18 4, 16 4 M25 9 C 27 5, 30 4, 32 4"
        stroke="var(--color-ink)"
        strokeOpacity="0.6"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** A sprig of two leaves on a stem. Corner decoration and section punctuation. */
export function LeafSprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 48" className={cn("h-auto", className)} aria-hidden="true" focusable="false">
      <path
        d="M20 46 C 20 34, 20 20, 20 4"
        stroke="var(--color-primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M20 30 C 10 30, 5 24, 5 16 C 15 16, 20 22, 20 30 Z" fill="var(--color-leaf)" />
      <path
        d="M20 20 C 30 20, 35 14, 35 6 C 25 6, 20 12, 20 20 Z"
        fill="var(--color-primary)"
        opacity="0.85"
      />
    </svg>
  );
}

/**
 * The hero drawing: a shelf standing in a garden.
 *
 * Geometric rather than cartoon, because it has to still feel right to a
 * fourteen-year-old. The butterflies drift; everything else is still. Decorative,
 * so it is hidden from assistive technology.
 */
export function ShelfIllustration({ className }: { className?: string }) {
  const spines = [
    { w: 22, h: 118, fill: "var(--color-primary)", label: true },
    { w: 16, h: 96, fill: "var(--color-accent)" },
    { w: 26, h: 132, fill: "var(--color-primary-deep)", label: true },
    { w: 18, h: 104, fill: "var(--color-sun)" },
    { w: 20, h: 124, fill: "var(--color-accent-ink)", label: true },
    { w: 15, h: 90, fill: "var(--color-leaf)" },
    { w: 24, h: 112, fill: "var(--color-primary)", label: true },
  ];

  let x = 40;
  const baseline = 168;

  return (
    <svg
      viewBox="0 0 340 210"
      className={cn("h-auto w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* the garden behind the shelf — three soft hills, nothing more */}
      <circle cx="60" cy="150" r="52" fill="var(--color-primary-wash)" />
      <circle cx="250" cy="140" r="62" fill="var(--color-accent-wash)" />

      {spines.map((spine, index) => {
        const currentX = x;
        x += spine.w + 6;
        return (
          <g key={index}>
            <rect
              x={currentX}
              y={baseline - spine.h}
              width={spine.w}
              height={spine.h}
              rx={4}
              fill={spine.fill}
            />
            {spine.label ? (
              <>
                <rect
                  x={currentX + 4}
                  y={baseline - spine.h + 16}
                  width={spine.w - 8}
                  height={3}
                  rx={1.5}
                  fill="#FDF8F0"
                  opacity={0.75}
                />
                <rect
                  x={currentX + 4}
                  y={baseline - spine.h + 24}
                  width={spine.w - 12}
                  height={3}
                  rx={1.5}
                  fill="#FDF8F0"
                  opacity={0.5}
                />
              </>
            ) : null}
          </g>
        );
      })}

      {/* one book lying flat on top of the row, as they always end up */}
      <rect x={208} y={baseline - 60} width={62} height={16} rx={4} fill="var(--color-sun)" />
      <rect x={212} y={baseline - 56} width={40} height={3} rx={1.5} fill="var(--color-sun-ink)" opacity={0.55} />

      {/* the shelf plank */}
      <rect x={24} y={baseline} width={296} height={12} rx={6} fill="var(--color-control-border)" />
      <rect x={42} y={baseline + 12} width={12} height={22} rx={4} fill="var(--color-control-border)" opacity={0.6} />
      <rect x={290} y={baseline + 12} width={12} height={22} rx={4} fill="var(--color-control-border)" opacity={0.6} />

      {/* grass at the foot of it */}
      <path
        d="M12 194 q 6 -16 12 0 M32 194 q 5 -12 10 0 M300 194 q 6 -16 12 0 M282 194 q 5 -11 10 0"
        stroke="var(--color-leaf)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <rect x={0} y={192} width={340} height={5} rx={2.5} fill="var(--color-leaf)" opacity={0.4} />

      {/* two butterflies, drifting */}
      <g className="drift" style={{ transformOrigin: "26px 44px" }}>
        <ellipse cx="20" cy="42" rx="9" ry="7" fill="var(--color-accent)" transform="rotate(-24 20 42)" />
        <ellipse cx="32" cy="42" rx="9" ry="7" fill="var(--color-accent)" transform="rotate(24 32 42)" />
        <rect x="24.6" y="38" width="2.6" height="15" rx="1.3" fill="var(--color-ink)" opacity="0.7" />
      </g>
      <g className="drift-slow" style={{ transformOrigin: "300px 60px" }}>
        <ellipse cx="295" cy="58" rx="7" ry="5.5" fill="var(--color-accent)" opacity="0.85" transform="rotate(-24 295 58)" />
        <ellipse cx="305" cy="58" rx="7" ry="5.5" fill="var(--color-accent)" opacity="0.85" transform="rotate(24 305 58)" />
        <rect x="298.8" y="55" width="2.2" height="12" rx="1.1" fill="var(--color-ink)" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * A quiet field of garden marks for the top-right of a page. Sits behind
 * content at low opacity and never competes with it.
 */
export function GardenCorner({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none select-none", className)} aria-hidden="true">
      <Butterfly className="drift absolute right-4 top-6 w-10 opacity-70 sm:w-14" />
      <Butterfly tone="soft" className="drift-slow absolute right-20 top-16 w-8 sm:w-10" />
      <LeafSprig className="absolute right-10 top-28 w-8 opacity-50 sm:w-10" />
    </div>
  );
}
