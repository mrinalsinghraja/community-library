import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BookCardTile } from "@/components/library/book-card";
import { Butterfly, LeafSprig } from "@/components/library/library-logo";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { AGE_BAND_NOTE, AGE_GROUPS, PAGE_SIZES, isAgeGroup } from "@/lib/catalogue";
import { isAppError } from "@/server/lib/errors";
import { getBrandingSafe } from "@/server/lib/settings";
import { browseCatalogue, listCategories } from "@/server/services/catalogue-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find a book" };

const FIELD =
  "min-h-14 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-4 text-lg " +
  "focus:border-accent";

/**
 * The shelf, as a child meets it.
 *
 * "Let's find your next book" rather than "Library Inventory". Big cards, big
 * pictures, three controls, and a grid that reflows from two columns on a phone
 * to five on a desktop — never a horizontal scroller, which on a tablet hides
 * half the library behind a gesture a seven-year-old will not discover.
 *
 * Search and filters live in the query string and run in PostgreSQL, so this
 * works with JavaScript off, can be bookmarked, and never ships the whole
 * catalogue to the browser to sift through.
 *
 * The shelf chips under the search card are the same query string by another
 * road: one tap instead of open-select-scroll-choose-submit. They add no
 * behaviour the form did not already have.
 */
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const branding = await getBrandingSafe();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const search = read("q");
  const categorySlug = read("shelf");
  const ageRaw = read("age");
  const page = Number.parseInt(read("page"), 10) || 1;
  /*
   * Three orderings, chosen from a fixed list. Anything else in the query
   * string falls back to newest rather than reaching the SQL — the sort is
   * interpolated into the query as raw SQL at the other end, so what a child
   * can type must never be what picks it.
   */
  const sortRaw = read("sort");
  const sort: "newest" | "loved" | "borrowed" =
    sortRaw === "loved" || sortRaw === "borrowed" ? sortRaw : "newest";

  const categories = await listCategories().catch(() => []);
  const category = categories.find((entry) => entry.slug === categorySlug);

  let result;
  try {
    result = await browseCatalogue({
      search,
      categoryId: category?.id,
      ageGroup: isAgeGroup(ageRaw) ? ageRaw : undefined,
      sort,
      page,
      pageSize: PAGE_SIZES.reader,
    });
  } catch (error) {
    /*
     * The catalogue is MEMBER_ONLY by default, so a signed-out visitor is
     * refused by the service. Sending them to sign in — rather than showing an
     * error — is the difference between a closed door and a broken one.
     */
    if (isAppError(error) && (error.code === "NOT_AUTHENTICATED" || error.code === "NOT_FOUND")) {
      redirect("/login?next=/books");
    }
    throw error;
  }

  const filtering = Boolean(search || category || ageRaw || sort !== "newest");

  /** Keeps the age filter when a shelf chip is tapped, drops the page number. */
  const shelfHref = (slug: string): string => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (ageRaw) query.set("age", ageRaw);
    if (sort !== "newest") query.set("sort", sort);
    if (slug) query.set("shelf", slug);
    const string = query.toString();
    return string ? `/books?${string}` : "/books";
  };

  const chip =
    "inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-base font-bold no-underline transition-colors";
  const chipOff = "border-hairline bg-surface text-ink-soft hover:border-accent hover:text-accent-ink";
  const chipOn = "border-accent bg-accent-wash text-accent-ink";

  return (
    <PublicShell branding={branding}>
      <div className="relative mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <Butterfly className="drift pointer-events-none absolute right-4 top-6 w-10 opacity-70 sm:w-14" />

        <h1 className="garden-rule inline-block text-4xl sm:text-5xl">
          Let&rsquo;s find your next book!
        </h1>
        <p className="mt-8 text-lg text-ink-soft">
          {result.total === 1 ? "1 book" : `${result.total} books`} on our shelves.
        </p>

        {/* ------------------------------------------------------------- */}
        {/* Finding                                                        */}
        {/* ------------------------------------------------------------- */}
        <form
          method="get"
          className="mt-8 rounded-[var(--radius-card)] bg-surface p-5 shadow-lift sm:p-6"
        >
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-base font-semibold text-ink">
                <Icon name="search" className="text-accent-ink" />
                Look for a book
              </span>
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder="A title, or who wrote it"
                className={`${FIELD} placeholder:text-ink-faint`}
              />
            </label>

            {/* Three controls, three columns. Two-up left "Show me" stranded
                on a row of its own at half width. */}
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Icon name="shelf" className="text-accent-ink" />
                  Shelf
                </span>
                <select name="shelf" defaultValue={category?.slug ?? ""} className={FIELD}>
                  <option value="">Every shelf</option>
                  {categories.map((entry) => (
                    <option key={entry.id} value={entry.slug}>
                      {entry.icon ? `${entry.icon} ` : ""}
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>

              {/*
                A filter, never a gate. The catalogue narrows to a band because
                a child asked it to; nothing here decides what anybody is
                allowed to borrow, and the note under the select says so in
                print rather than leaving it to be inferred.
              */}
              <label className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Icon name="age" className="text-accent-ink" />
                  Written for
                </span>
                <select
                  name="age"
                  defaultValue={ageRaw}
                  aria-describedby="age-note"
                  className={FIELD}
                >
                  <option value="">Any age</option>
                  {AGE_GROUPS.map((group) => (
                    <option key={group.value} value={group.value}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>

              {/*
                Three orderings and no more. "Best loved" is what the ratings
                earn their keep with and "Most borrowed" is what the loan
                history does; everything else a child might want is already a
                filter above. A dropdown of six sorts on a page a seven-year-old
                uses is six ways to get lost.

                The two are genuinely different questions and both get asked. A
                book can be adored by the four children who finished it and
                rarely leave the shelf; another goes home every fortnight and
                nobody has ever written a word about it.
              */}
              <label className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Icon name="star" className="text-accent-ink" />
                  Show me
                </span>
                <select name="sort" defaultValue={sort} className={FIELD}>
                  <option value="newest">Newest first</option>
                  <option value="loved">Best loved first</option>
                  <option value="borrowed">Most borrowed first</option>
                </select>
              </label>
            </div>

            <p id="age-note" className="text-base text-ink-faint">
              {AGE_BAND_NOTE}
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                className="inline-flex min-h-14 items-center gap-2.5 rounded-[var(--radius-button)] bg-primary px-8 text-base font-semibold text-white transition-colors hover:bg-primary-deep"
              >
                <Icon name="search" />
                Show me
              </button>
              {filtering ? (
                <Link href="/books" className="text-lg font-bold text-primary-deep">
                  Show everything
                </Link>
              ) : null}
            </div>
          </div>
        </form>

        {/* The shelves, as a row of doors. */}
        {categories.length > 0 ? (
          <nav aria-label="Shelves" className="mt-6 flex flex-wrap gap-2.5">
            <Link href={shelfHref("")} className={`${chip} ${category ? chipOff : chipOn}`}>
              Every shelf
            </Link>
            {categories.map((entry) => (
              <Link
                key={entry.id}
                href={shelfHref(entry.slug)}
                aria-current={category?.id === entry.id ? "page" : undefined}
                className={`${chip} ${category?.id === entry.id ? chipOn : chipOff}`}
              >
                {entry.icon ? <span aria-hidden="true">{entry.icon}</span> : null}
                {entry.name}
              </Link>
            ))}
          </nav>
        ) : null}

        {/* ------------------------------------------------------------- */}
        {/* The shelf itself                                               */}
        {/* ------------------------------------------------------------- */}
        <div className="mt-10">
          {result.items.length === 0 ? (
            search ? (
              <EmptyState illustration={<Icon name="search" />} title="Oops! We couldn't find that book.">
                Try a shorter word, or check the spelling. You can also ask your librarian —
                they know where everything is.
              </EmptyState>
            ) : filtering ? (
              <EmptyState
                illustration={<Icon name="shelf" />}
                title="Nothing here yet. Try another shelf!"
                action={
                  <ButtonLink href="/books" variant="secondary" size="lg" icon={<Icon name="shelf" />}>
                    Show every book
                  </ButtonLink>
                }
              >
                No books on this shelf for these ages — but there are plenty next door.
              </EmptyState>
            ) : (
              <EmptyState illustration={<Icon name="book" />} title="Our shelves are waiting for more adventures!">
                No books yet. As soon as our librarians add some, they will appear right here.
              </EmptyState>
            )
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
              {result.items.map((book) => (
                <BookCardTile key={book.code} book={book} />
              ))}
            </ul>
          )}
        </div>

        {result.pageCount > 1 ? (
          <nav aria-label="More books" className="mt-10 flex flex-wrap items-center gap-2">
            {Array.from({ length: result.pageCount }, (_, index) => index + 1).map((number) => {
              const query = new URLSearchParams();
              for (const [key, value] of Object.entries(params)) {
                const single = Array.isArray(value) ? value[0] : value;
                if (single && key !== "page") query.set(key, single);
              }
              query.set("page", String(number));

              return (
                <Link
                  key={number}
                  href={`/books?${query.toString()}`}
                  aria-current={number === result.page ? "page" : undefined}
                  className={
                    number === result.page
                      ? "min-h-12 rounded-[var(--radius-button)] bg-primary px-5 py-2.5 text-lg font-bold text-white no-underline"
                      : "min-h-12 rounded-[var(--radius-button)] border border-control-border px-5 py-2.5 text-lg font-bold text-ink-soft no-underline hover:bg-surface-sunk"
                  }
                >
                  {number}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <p className="relative mt-14 flex flex-wrap items-center gap-2 text-lg text-ink-soft">
          <LeafSprig className="pointer-events-none hidden w-10 opacity-50 sm:block" />
          Every book here was given by a family in our community.{" "}
          <Link href="/donors" className="inline-flex items-center gap-1.5 font-bold text-primary-deep">
            Say thank you
            <Icon name="arrowRight" />
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
