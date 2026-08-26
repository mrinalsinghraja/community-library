import Link from "next/link";

import { BookCover } from "@/components/library/book-cover";
import { RatingSummaryLine } from "@/components/ui/star-rating";
import { StatusBadge } from "@/components/ui/status-badge";
import { ageGroupSuggestion, statusDefinition } from "@/lib/catalogue";
import type { ReaderBookCard } from "@/server/services/catalogue-service";
import { Icon } from "@/components/ui/icon";

/**
 * A book, as a child sees it.
 *
 * Seven things and no more: the cover, the title, who wrote it, what readers
 * made of it, which shelf, who it is for, and whether it is here. A card with
 * ten pieces of metadata on it is an inventory row, and a shelf of inventory
 * rows is not somewhere a nine-year-old wants to spend a Saturday.
 *
 * The rating earned its place because it changes which book gets picked up, and
 * it is drawn in the `sm` size — stars, the figure, and the count in brackets —
 * because at card width the word "ratings" is what pushes the line to wrap. A
 * book nobody has rated shows nothing at all rather than five grey stars: an
 * empty row on twenty-four tiles reads as a shelf of bad books.
 *
 * Deliberately absent: the donor (that belongs on the book's own page, where
 * there is room to say thank you properly rather than stamp a name on every
 * tile), the condition, the internal ids, and anything about who has borrowed
 * it — no child's name appears anywhere in this catalogue.
 *
 * The cover is the card. It gets the whole top, edge to edge, because a child
 * scanning a shelf is reading pictures before words.
 */
export function BookCardTile({ book }: { book: ReaderBookCard }) {
  const status = statusDefinition(book.status);

  return (
    <li className="list-none">
      <Link
        href={`/books/${encodeURIComponent(book.code)}`}
        className="lift group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface no-underline shadow-lift"
      >
        {/* The cover, full-bleed to the card's edges. */}
        <div className="relative">
          <BookCover
            coverMediaId={book.coverMediaId}
            title={book.title}
            className="rounded-none"
          />
          {/*
            The status sits on the cover, where the eye already is. It keeps the
            badge's own colour, mark and word — nothing here is carried by
            colour alone.
          */}
          <span className="absolute bottom-2 left-2 right-2">
            <StatusBadge tone={status.tone} className="shadow-lift">
              <span aria-hidden="true">{status.mark}</span> {status.readerLabel}
            </StatusBadge>
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
          <h3 className="line-clamp-2 font-display text-lg leading-snug font-bold text-ink group-hover:text-accent-ink">
            {book.title}
          </h3>
          <p className="line-clamp-1 text-base text-ink-soft">{book.authors.join(", ")}</p>

          {/*
            `emptyLabel={null}` is the important argument: an unrated book is
            silent here. Elsewhere "no ratings yet" is worth saying; on a grid of
            two dozen tiles it would be the most repeated sentence on the page.
          */}
          <RatingSummaryLine summary={book.rating} size="sm" emptyLabel={null} />

          {/*
            Two facts, one per line. They used to share a line with a middle dot
            between them, which at card width put the dot at the start of the
            wrapped line — a separator separating nothing.
          */}
          <div className="mt-auto flex flex-col gap-1 pt-2 text-base text-ink-soft">
            <span className="flex items-center gap-1.5">
              {/*
                The shelf's own symbol is catalogue data, chosen by a librarian
                when the category was created. It stays as it is — the drawn
                icon set is for the interface's own furniture, not for
                overwriting somebody's content.
              */}
              <span aria-hidden="true" className="shrink-0">
                {book.categoryIcon ?? "📚"}
              </span>
              <span className="line-clamp-1">{book.categoryName}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="age" className="text-ink-faint" />
              {ageGroupSuggestion(book.ageGroup)}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
