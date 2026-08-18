import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The library mark.
 *
 * When an administrator has uploaded a logo we show it. Until then we draw one —
 * three books and a shelf — so a fresh install looks like a real library rather
 * than a broken image. Nothing here is specific to any one community; the name
 * always comes from configuration.
 */

export function LibraryLogo({
  logoUrl,
  libraryName,
  size = 56,
  className,
}: {
  logoUrl: string | null;
  libraryName: string;
  size?: number;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={`${libraryName} logo`}
        width={size}
        height={size}
        className={cn("rounded-2xl object-contain", className)}
        priority
      />
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={`${libraryName} logo`}
    >
      <rect x="2" y="2" width="60" height="60" rx="16" fill="var(--brand-primary)" />

      {/* three books of different heights, leaning together on a shelf */}
      <rect x="15" y="20" width="9" height="26" rx="2.5" fill="#FDF8F0" />
      <rect x="26" y="15" width="9" height="31" rx="2.5" fill="var(--color-accent)" />
      <g transform="rotate(12 42 32)">
        <rect x="37" y="22" width="9" height="24" rx="2.5" fill="#FDF8F0" opacity="0.85" />
      </g>

      {/* the shelf they stand on */}
      <rect x="12" y="47" width="40" height="4.5" rx="2.25" fill="#FDF8F0" />
    </svg>
  );
}

/**
 * The hero illustration: a shelf seen straight on.
 *
 * Deliberately geometric rather than cartoon — it should still feel right to a
 * fourteen-year-old. Decorative, so it is hidden from assistive technology.
 */
export function ShelfIllustration({ className }: { className?: string }) {
  const spines = [
    { w: 22, h: 118, fill: "var(--color-primary)", label: true },
    { w: 16, h: 96, fill: "var(--color-accent)" },
    { w: 26, h: 132, fill: "var(--color-primary-deep)", label: true },
    { w: 18, h: 104, fill: "#F2C57C" },
    { w: 20, h: 124, fill: "var(--color-accent-ink)", label: true },
    { w: 15, h: 90, fill: "var(--color-primary)" },
    { w: 24, h: 112, fill: "#8FBFA8" },
  ];

  let x = 24;
  const baseline = 168;

  return (
    <svg
      viewBox="0 0 320 200"
      className={cn("h-auto w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
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
      <rect x={196} y={baseline - 60} width={62} height={16} rx={4} fill="#F2C57C" />
      <rect x={200} y={baseline - 56} width={40} height={3} rx={1.5} fill="#8A5A00" opacity={0.55} />

      {/* the shelf plank */}
      <rect x={8} y={baseline} width={304} height={12} rx={6} fill="var(--color-control-border)" />
      <rect x={26} y={baseline + 12} width={12} height={20} rx={4} fill="var(--color-control-border)" opacity={0.6} />
      <rect x={282} y={baseline + 12} width={12} height={20} rx={4} fill="var(--color-control-border)" opacity={0.6} />
    </svg>
  );
}
