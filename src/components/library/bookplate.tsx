import type { ReactNode } from "react";

import { Butterfly } from "@/components/library/library-logo";
import { cn } from "@/lib/cn";

/**
 * The bookplate.
 *
 * Every donated book in this library has a thank-you pasted inside its front
 * cover: the printed plate with the line "this book was given to the library
 * by", and a family's name written on it in the librarian's hand. That plate is
 * the physical object a donation actually produces, and it is the one thing in
 * this library's world that belongs to the donor rather than to the reader --
 * which is why the thank-you page is built out of it rather than out of a hero
 * banner that could belong to any charity.
 *
 * It is drawn once and used twice, and the difference between the two is the
 * whole idea:
 *
 *   * On the register, the name line is **blank**. A blank plate is an
 *     invitation -- it is the one a book you have not given yet would carry.
 *   * On a family's own page, the same plate is **filled in** with their
 *     credit. Following a link from the list is watching your name appear on
 *     it.
 *
 * The frame is a double rule in the library's berry, at the low opacities a
 * printed plate has. Nothing here animates except the butterflies that already
 * drift everywhere else in the application.
 */
export function Bookplate({
  credit,
  caption,
  children,
  className,
}: {
  /** The family's credit. Left out on the register, where the line stays blank. */
  credit?: ReactNode;
  /** Small print under the name rule. */
  caption?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[var(--radius-card)] border-2 border-accent/30 bg-surface-sunk p-1.5 shadow-lift",
        className,
      )}
    >
      {/* The second rule. A printed plate has two, set close. */}
      <div className="rounded-[calc(var(--radius-card)-0.3rem)] border border-accent/25 px-5 py-7 sm:px-12 sm:py-11">
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <Butterfly className="drift w-8 opacity-80 sm:w-11" />

          {/*
            Set in the system mono at wide tracking, because this line is the
            one part of a bookplate that was printed rather than written. It is
            the only place in the application that uses that face for words.
          */}
          <p className="mt-4 font-mono text-[0.65rem] uppercase leading-relaxed tracking-[0.16em] text-ink-faint sm:mt-5 sm:text-xs sm:tracking-[0.26em]">
            This book was given to the library by
          </p>

          {/*
            The writing line. It keeps its height whether or not there is a name
            on it, so the blank plate on the register and the filled one on a
            family's page are the same object rather than two layouts.
          */}
          <p
            className={cn(
              "mt-3 flex min-h-12 w-full max-w-lg items-end justify-center border-b-2 border-ink-faint/45 pb-1.5 sm:min-h-14",
              "font-display text-2xl leading-snug text-ink sm:text-3xl",
            )}
          >
            {credit}
          </p>

          {caption ? <p className="mt-3 text-sm text-ink-soft">{caption}</p> : null}

          {children ? <div className="mt-7 sm:mt-9">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
