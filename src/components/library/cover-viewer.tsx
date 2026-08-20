"use client";

import { useCallback, useRef } from "react";

import { BookCover } from "@/components/library/book-cover";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * A cover thumbnail you can tap to see properly.
 *
 * The smallest possible answer to "I cannot read that title, it is two
 * centimetres tall". It is not a new workflow: nothing is fetched that the page
 * had not already fetched, nothing is written, and closing it leaves the reader
 * exactly where they were — no route change, so the browser's back button still
 * means "the page before this one" rather than "close the picture".
 *
 * Built on the platform's own `<dialog>` and `showModal()`, which is what makes
 * the accessibility correct rather than approximated:
 *
 *   * Escape closes it — the browser does that, not a key handler that has to
 *     be attached, remembered and torn down;
 *   * focus is trapped inside while it is open and returned to the thumbnail
 *     that opened it when it closes;
 *   * everything behind it is inert, so a screen reader cannot wander into the
 *     page underneath.
 *
 * A click on the backdrop closes it too, which is what a thumb reaches for on a
 * phone. The visible close button is the accessible route to the same thing and
 * is never the only way out.
 *
 * The larger picture comes from the same authorised route as the thumbnail,
 * `/api/media/[id]`. There is no second URL, no signed link and no storage path
 * anywhere in this component — enlarging a cover asks the server the same
 * question a second time and gets the same answer.
 *
 * When a book has no cover there is nothing to enlarge, so the drawn stand-in
 * renders as a plain picture with no control on it. A button that opens a
 * bigger drawing of a book would be a promise the library cannot keep.
 */
export function CoverThumbnail({
  coverMediaId,
  title,
  className,
  sizes,
  variant = "full",
}: {
  coverMediaId: string | null;
  title: string;
  className?: string;
  sizes?: string;
  variant?: "thumb" | "full";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const open = useCallback(() => dialogRef.current?.showModal(), []);
  const close = useCallback(() => dialogRef.current?.close(), []);

  /**
   * A click that landed on the dialog element itself rather than on anything
   * inside it is a click on the backdrop — the dialog's own box is the full
   * viewport, and the card is a child of it.
   */
  const onDialogClick = useCallback((event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) dialogRef.current?.close();
  }, []);

  if (!coverMediaId) {
    return <BookCover coverMediaId={null} title={title} className={className} variant={variant} />;
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`See the cover of ${title} bigger`}
        className="group block w-full cursor-zoom-in rounded-[var(--radius-field)] focus-visible:outline-3 focus-visible:outline-offset-3"
      >
        <BookCover
          coverMediaId={coverMediaId}
          title={title}
          className={cn("transition-transform group-hover:scale-[1.02]", className)}
          sizes={sizes}
          variant={variant}
        />
      </button>

      <dialog
        ref={dialogRef}
        onClick={onDialogClick}
        aria-label={`Cover of ${title}`}
        className="cover-dialog"
      >
        <div className="flex max-h-[90dvh] w-full max-w-[min(28rem,90vw)] flex-col gap-4">
          {/*
            An opaque ground behind the picture. A jacket photographed against a
            window, or a PNG with transparency, would otherwise show the dimmed
            page through itself.
          */}
          <div className="rounded-[var(--radius-card)] bg-surface p-3 shadow-raise">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/media/${coverMediaId}`}
              alt={`Cover of ${title}`}
              className="mx-auto max-h-[64dvh] w-auto max-w-full rounded-[var(--radius-field)] object-contain"
            />
          </div>
          <p className="text-center text-base font-semibold text-white">{title}</p>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={close}
              className="inline-flex min-h-14 items-center gap-2.5 rounded-[var(--radius-button)] bg-primary px-8 text-base font-semibold text-white transition-colors hover:bg-primary-deep"
            >
              <Icon name="cross" />
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
