import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BookCardTile } from "@/components/library/book-card";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { AGE_GROUPS, PAGE_SIZES, isAgeGroup } from "@/lib/catalogue";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import { getBrandingSafe } from "@/server/lib/settings";
import { browseCatalogue, listCategories } from "@/server/services/catalogue-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find a book" };

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
 */
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const branding = await getBrandingSafe();
  const actor = await getActor();
  const params = await searchParams;

  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const search = read("q");
  const categorySlug = read("shelf");
  const ageRaw = read("age");
  const page = Number.parseInt(read("page"), 10) || 1;

  const categories = await listCategories().catch(() => []);
  const category = categories.find((entry) => entry.slug === categorySlug);

  let result;
  try {
    result = await browseCatalogue({
      search,
      categoryId: category?.id,
      ageGroup: isAgeGroup(ageRaw) ? ageRaw : undefined,
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

  const filtering = Boolean(search || category || ageRaw);

  return (
    <PublicShell branding={branding} signedIn={Boolean(actor)}>
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-4xl sm:text-5xl">Let&rsquo;s find your next book! 📚</h1>
        <p className="mt-3 text-lg text-ink-soft">
          {result.total === 1 ? "1 book" : `${result.total} books`} on our shelves.
        </p>

        <form method="get" className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="font-display text-lg font-bold text-ink">
              Look for a book
            </span>
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="A title, or who wrote it"
              className="min-h-14 w-full rounded-[var(--radius-field)] border-2 border-control-border bg-surface px-5 text-lg placeholder:text-ink-faint"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-display text-lg font-bold text-ink">Shelf</span>
              <select
                name="shelf"
                defaultValue={category?.slug ?? ""}
                className="min-h-14 w-full rounded-[var(--radius-field)] border-2 border-control-border bg-surface px-4 text-lg"
              >
                <option value="">Every shelf</option>
                {categories.map((entry) => (
                  <option key={entry.id} value={entry.slug}>
                    {entry.icon ? `${entry.icon} ` : ""}
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-display text-lg font-bold text-ink">Ages</span>
              <select
                name="age"
                defaultValue={ageRaw}
                className="min-h-14 w-full rounded-[var(--radius-field)] border-2 border-control-border bg-surface px-4 text-lg"
              >
                <option value="">Any age</option>
                {AGE_GROUPS.map((group) => (
                  <option key={group.value} value={group.value}>
                    {group.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              className="min-h-14 rounded-full bg-primary px-8 text-lg font-bold text-white hover:bg-primary-deep"
            >
              <span aria-hidden="true">🔍</span> Show me
            </button>
            {filtering ? (
              <Link href="/books" className="text-lg font-bold text-primary-deep">
                Show everything
              </Link>
            ) : null}
          </div>
        </form>

        <div className="mt-10">
          {result.items.length === 0 ? (
            search ? (
              <EmptyState illustration="🔍" title="Oops! We couldn't find that book.">
                Try a shorter word, or check the spelling. You can also ask your librarian —
                they know where everything is.
              </EmptyState>
            ) : filtering ? (
              <EmptyState
                illustration="🧭"
                title="Nothing here yet. Try another shelf!"
                action={
                  <ButtonLink href="/books" variant="secondary" size="lg" icon="📚">
                    Show every book
                  </ButtonLink>
                }
              >
                No books on this shelf for these ages — but there are plenty next door.
              </EmptyState>
            ) : (
              <EmptyState illustration="📚" title="Our shelves are waiting for more adventures!">
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
                      ? "min-h-12 rounded-full bg-primary px-5 py-2.5 text-lg font-bold text-white no-underline"
                      : "min-h-12 rounded-full border-2 border-control-border px-5 py-2.5 text-lg font-bold text-ink-soft no-underline hover:bg-surface-sunk"
                  }
                >
                  {number}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <p className="mt-14 text-lg text-ink-soft">
          Every book here was given by a family in our community.{" "}
          <Link href="/donors" className="font-bold text-primary-deep">
            Say thank you →
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
