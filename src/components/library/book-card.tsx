import Link from "next/link";

import { BookCover } from "@/components/library/book-cover";
import { StatusBadge } from "@/components/ui/status-badge";
import { ageGroupLabel, statusDefinition } from "@/lib/catalogue";
import type { ReaderBookCard } from "@/server/services/catalogue-service";

/**
 * A book, as a child sees it.
 *
 * Six things and no more: the cover, the title, who wrote it, which shelf, who
 * it is for, and whether it is here. A card with ten pieces of metadata on it
 * is an inventory row, and a shelf of inventory rows is not somewhere a
 * nine-year-old wants to spend a Saturday.
 *
 * Deliberately absent: the donor (that belongs on the book's own page, where
 * there is room to say thank you properly rather than stamp a name on every
 * tile), the condition, the internal ids, and anything about who has borrowed
 * it — no child's name appears anywhere in this catalogue.
 */
export function BookCardTile({ book }: { book: ReaderBookCard }) {
  const status = statusDefinition(book.status);

  return (
    <li className="list-none">
      <Link
        href={`/books/${encodeURIComponent(book.code)}`}
        className="group flex h-full flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-3 no-underline shadow-lift transition-transform duration-150 hover:-translate-y-0.5 sm:p-4"
      >
        <BookCover coverMediaId={book.coverMediaId} title={book.title} />

        <div className="flex flex-1 flex-col gap-1.5">
          <h3 className="font-display text-lg leading-snug font-bold text-ink group-hover:text-primary-deep">
            {book.title}
          </h3>
          <p className="text-base text-ink-soft">{book.authors.join(", ")}</p>

          <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-base text-ink-soft">
            <span>
              <span aria-hidden="true">{book.categoryIcon ?? "📚"}</span> {book.categoryName}
            </span>
            <span aria-hidden="true">·</span>
            <span>{ageGroupLabel(book.ageGroup)}</span>
          </p>

          <p className="pt-1">
            {/*
              Status carries a colour, a shape mark inside the badge, an emoji
              and a word. Any one of those alone would fail somebody: colour
              fails a child with a colour vision deficiency, and the emoji fails
              a screen reader, which is why it is hidden from one and the word
              never is.
            */}
            <StatusBadge tone={status.tone}>
              <span aria-hidden="true">{status.mark}</span> {status.readerLabel}
            </StatusBadge>
          </p>
        </div>
      </Link>
    </li>
  );
}
