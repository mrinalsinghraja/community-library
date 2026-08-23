import { cn } from "@/lib/cn";
import type { CountdownTone, DueCountdown } from "@/lib/due-countdown";

/**
 * How long is left, at the size the answer deserves.
 *
 * The number is the largest thing on the card because it is the only thing
 * anybody opened the card to find out. Everything else — cover, title, author,
 * the date itself — is context for it.
 *
 * **The word is not optional.** Green and red are the two colours a red-green
 * colour-blind reader cannot separate, and about one boy in twelve is. So the
 * numeral never stands alone: "9" is always "9 days left", and the tone is
 * carried by the sentence as much as by the ink. Remove all colour from this
 * component and it still reads correctly, which is the test it was built to
 * pass.
 *
 * Red is not a telling-off. This library has no fines, and a book past its date
 * is a book that is ready to come home — the colour marks the end of an
 * interval, not the beginning of a punishment.
 */

const TONE_TEXT: Record<CountdownTone, string> = {
  ok: "text-success",
  soon: "text-warn",
  due: "text-danger",
  late: "text-danger",
};

const TONE_PANEL: Record<CountdownTone, string> = {
  ok: "bg-success-wash",
  soon: "bg-warn-wash",
  due: "bg-danger-wash",
  late: "bg-danger-wash",
};

/**
 * The full-size countdown, for a child's own shelf.
 *
 * A tinted panel rather than a bare number: the wash gives the colour somewhere
 * to live at a size that would otherwise shout, and it groups the numeral with
 * its word so the pair reads as one object.
 */
export function DueCountdownPanel({
  countdown,
  className,
}: {
  countdown: DueCountdown;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-card)] px-5 py-4 text-center",
        TONE_PANEL[countdown.tone],
        className,
      )}
    >
      {/*
        One announcement, not three. Left to itself a screen reader would read
        the numeral, then the unit, then the date as separate fragments; the
        label states the whole fact once and the pieces below are hidden.
      */}
      <span className="sr-only">{`${countdown.headline}, due ${countdown.on}`}</span>

      <span aria-hidden="true" className="flex flex-col items-center leading-none">
        <span
          className={cn(
            "font-display text-6xl font-bold leading-none tabular-nums sm:text-7xl",
            TONE_TEXT[countdown.tone],
          )}
        >
          {countdown.value}
        </span>
        <span
          className={cn(
            "mt-1.5 text-lg font-semibold leading-tight",
            TONE_TEXT[countdown.tone],
          )}
        >
          {countdown.unit}
        </span>
      </span>

      <span aria-hidden="true" className="mt-2 text-sm text-ink-soft">
        {countdown.on}
      </span>
    </div>
  );
}

/**
 * The same fact at desk scale, for a row in a list.
 *
 * Still bold, still coloured, still carrying its word — a librarian scanning
 * thirty rows for the late ones needs the same instant read a child needs, and
 * shrinking it into grey body text would remove the only reason it is here.
 */
export function DueCountdownInline({
  countdown,
  className,
}: {
  countdown: DueCountdown;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className="sr-only">{countdown.headline}</span>
      <span
        aria-hidden="true"
        className={cn("text-2xl font-bold tabular-nums", TONE_TEXT[countdown.tone])}
      >
        {countdown.value}
      </span>
      <span
        aria-hidden="true"
        className={cn("text-sm font-semibold", TONE_TEXT[countdown.tone])}
      >
        {countdown.unit}
      </span>
    </span>
  );
}
