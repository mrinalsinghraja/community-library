import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookCover } from "@/components/library/book-cover";
import { Butterfly } from "@/components/library/library-logo";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatInTimezone } from "@/lib/dates";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import {
  catalogueIsPubliclyVisible,
  getBrandingSafe,
  getCurrentLibrary,
} from "@/server/lib/settings";
import { getDonorGifts } from "@/server/services/donor-service";

export const dynamic = "force-dynamic";

/**
 * One family's shelf of gifts.
 *
 * A heading and a shelf, not a certificate. What somebody following a name off
 * the register wants to see is the books -- and a shelf of jackets is what
 * makes the next neighbour want to add to it, which a list of titles in a box
 * does not.
 *
 * Two things this page deliberately does not do.
 *
 * **It is not a way around the catalogue.** A gift is printed as a cover, a
 * title, an author and the month it arrived -- no copy code, no shelf, no
 * condition, no reading age, and no "on loan to". It is a record of what was
 * given rather than a live view of the collection, and a title becomes a link
 * only for a visitor who could already open it. The jackets are readable signed
 * out because `getAuthorizedMedia` allows a cover whose title carries a
 * credited donation, and refuses every other cover exactly as it did before.
 *
 * **It has no page for a family who asked to stay out of it.** An anonymous
 * donor is not in the register, their id resolves to nothing, and their books'
 * covers stay refused with everything else the catalogue is hiding.
 */

async function loadDonor(donorId: string) {
  try {
    return await getDonorGifts(donorId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ donor: string }>;
}): Promise<Metadata> {
  const { donor } = await params;
  const { entry } = await loadDonor(donor);

  // The same words the register calls this family, chosen in the service from
  // the consent they gave.
  return { title: `Books given by ${entry.label}` };
}

export default async function DonorGiftsPage({
  params,
}: {
  params: Promise<{ donor: string }>;
}) {
  const { donor } = await params;

  const branding = await getBrandingSafe();
  const actor = await getActor();
  const { entry, gifts } = await loadDonor(donor);
  const { settings } = await getCurrentLibrary();

  /*
   * Whether a title links into the catalogue, decided exactly as the catalogue
   * itself decides it. Offering a door that answers "sign in first" is worse
   * than not showing one, and nothing about this page changes who may open it.
   */
  const canOpenBooks =
    (await catalogueIsPubliclyVisible()) || (actor?.permissions.has("book.view") ?? false);

  const years =
    entry.firstYear === entry.lastYear
      ? String(entry.firstYear)
      : `${entry.firstYear}–${entry.lastYear}`;

  /*
   * Flats get rented, so the flat is shown as part of *this* family's line
   * rather than as their identity, with the years beside it. Two households at
   * B-208 four years apart are two entries that say so.
   */
  const line = [entry.name ? entry.apartment : null, years].filter(Boolean).join(" · ");

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <Link
          href="/donors"
          className="inline-flex items-center gap-1.5 text-base font-bold text-primary-deep"
        >
          <span aria-hidden="true">&larr;</span> All our book friends
        </Link>

        <header className="relative mt-7">
          <p className="text-base font-semibold uppercase tracking-[0.14em] text-accent-ink">
            Thank you
          </p>
          <h1 className="garden-rule mt-3 inline-block text-3xl sm:text-4xl">{entry.label}</h1>
          <Butterfly className="drift absolute -top-2 right-0 w-9 opacity-80 sm:w-12" />

          {line ? <p className="mt-9 text-lg text-ink-soft">{line}</p> : null}

          <p className="mt-3 max-w-2xl text-xl text-ink">
            {gifts.length === 1
              ? "One book on our shelves came from this family."
              : `${gifts.length} books on our shelves came from this family.`}{" "}
            Every one of them is being read by somebody who did not have it.
          </p>
        </header>

        <section className="mt-12" aria-labelledby="gifts-heading">
          <h2 id="gifts-heading" className="sr-only">
            Books given by {entry.label}
          </h2>

          {/*
            The same shelf the catalogue uses -- cover full-bleed to the card's
            edge, title, author -- with the catalogue's own furniture left off.
            No status pill, no shelf, no reading age: those describe where a book
            is now, and this page is about where it came from.
          */}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {gifts.map((gift) => {
              const card = (
                <>
                  <BookCover
                    coverMediaId={gift.coverMediaId}
                    title={gift.title}
                    className="rounded-none"
                  />
                  <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
                    <h3 className="line-clamp-2 font-display text-lg font-bold leading-snug text-ink group-hover:text-accent-ink">
                      {gift.title}
                    </h3>
                    {gift.authors.length > 0 ? (
                      <p className="line-clamp-1 text-base text-ink-soft">
                        {gift.authors.join(", ")}
                      </p>
                    ) : null}
                    <p className="mt-auto pt-2 font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
                      {formatInTimezone(gift.givenAt, settings.timezone, "MMM yyyy")}
                    </p>
                  </div>
                </>
              );

              const shell =
                "group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-lift";

              return (
                <li key={gift.code} className="list-none">
                  {canOpenBooks ? (
                    <Link
                      href={`/books/${encodeURIComponent(gift.code)}`}
                      className={`lift ${shell} no-underline`}
                    >
                      {card}
                    </Link>
                  ) : (
                    <div className={shell}>{card}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <p className="mt-14 max-w-2xl text-lg text-ink-soft">
          Every one of these was carried here from a neighbour&rsquo;s flat, and cost the family who
          reads it next nothing at all.
        </p>

        <p className="mt-6">
          <ButtonLink href="/donors#give" variant="secondary" size="lg" icon={<Icon name="gift" />}>
            Give a book yourself
          </ButtonLink>
        </p>
      </div>
    </PublicShell>
  );
}
