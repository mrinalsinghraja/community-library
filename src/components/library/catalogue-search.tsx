import Link from "next/link";
import type { BookCategory } from "@prisma/client";

import { Icon } from "@/components/ui/icon";

/**
 * The search box on the front page.
 *
 * A plain GET form pointed at `/books`. No JavaScript, no autocomplete, no
 * fetch — the field is named `q` and the destination already reads `q`, so
 * pressing Enter lands on the same results page a visitor would have reached by
 * navigating there and typing. That also means it works on the oldest phone in
 * the building and can be bookmarked from the address bar.
 *
 * **It renders only when the catalogue is public.** Offering a stranger a search
 * box that answers every query with a sign-in screen is worse than offering no
 * box at all — the door looks open and then is not. When the shelf is
 * member-only this is simply absent, and the page keeps the sign-in call to
 * action it already had.
 *
 * The shelf chips underneath are the same query string by another road, and
 * they are the more important half for a child who has not thought of a title
 * yet: "Comics" is a question a seven-year-old can answer, "search" is not.
 */
export function CatalogueSearchBand({
  categories,
  totalBooks,
}: {
  categories: BookCategory[];
  /** So the invitation can say how much there is. Zero hides the number. */
  totalBooks: number;
}) {
  return (
    <section aria-labelledby="find-a-book" className="mx-auto max-w-5xl px-5 pb-6 sm:px-8">
      <div className="rounded-[var(--radius-card)] bg-surface p-6 shadow-raise sm:p-8">
        <h2 id="find-a-book" className="garden-rule inline-block text-2xl sm:text-3xl">
          Look inside our library
        </h2>

        <p className="mt-9 max-w-2xl text-lg text-ink-soft">
          {totalBooks > 0
            ? `Every one of our ${totalBooks} books, what our readers thought of them, and the stars they gave. `
            : "Every book on our shelves, what our readers thought of them, and the stars they gave. "}
          You do not need an account to look — only to borrow.
        </p>

        <form method="get" action="/books" className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">Search for a book by title or author</span>
            <input
              type="search"
              name="q"
              placeholder="A title, or who wrote it"
              className="min-h-14 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-4 text-lg placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-[var(--radius-button)] bg-primary px-8 text-base font-semibold text-white transition-colors hover:bg-primary-deep"
          >
            <Icon name="search" />
            Search the shelves
          </button>
        </form>

        {categories.length > 0 ? (
          <nav aria-label="Shelves" className="mt-5 flex flex-wrap gap-2.5">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/books?shelf=${encodeURIComponent(category.slug)}`}
                className="inline-flex items-center gap-2 rounded-full border-2 border-hairline bg-surface px-4 py-2 text-base font-bold text-ink-soft no-underline transition-colors hover:border-accent hover:text-accent-ink"
              >
                {category.icon ? <span aria-hidden="true">{category.icon}</span> : null}
                {category.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </section>
  );
}
