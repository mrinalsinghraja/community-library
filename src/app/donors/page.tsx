import type { Metadata } from "next";
import Link from "next/link";

import { Bookplate } from "@/components/library/bookplate";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/states";
import { getActor } from "@/server/authz";
import { getBrandingSafe } from "@/server/lib/settings";
import { listDonorRegister } from "@/server/services/donor-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thank you, book friends",
  description:
    "The neighbours who have given books to the library, and how to give one yourself.",
};

/**
 * Thank You, Book Friends.
 *
 * Open to everybody, signed in or not, and that is the point of it. The
 * catalogue sits behind the front door because the owner chose that; this page
 * is the front door. Somebody deciding whether to carry a box of outgrown books
 * downstairs is exactly who it is written for, and they do not have an account.
 *
 * WHAT CHANGED, AND WHAT DID NOT (see ADR-046).
 *
 * This page used to print one thank-you per family and nothing else -- no name,
 * no flat, no number. The owner asked for the register the community can
 * actually read: who gave, which flat, how many books, and a page per family
 * showing the books themselves. That is a product decision and it has been
 * made.
 *
 * What did not change is whose decision each line is:
 *
 *   * A family is named here only if they said they wanted to be named. A
 *     family who asked for the flat alone gets the flat alone. A family who
 *     asked to stay out of it is not a row at all, has no page, and is thanked
 *     in one closing line that identifies nobody. That is `displayConsent`, and
 *     it is the donor's field, not the library's.
 *   * The list is alphabetical. With a count on the page, the ordering is the
 *     only thing standing between a register and a league table, so the count
 *     is written with its unit attached ("3 books", never a bare "3"), it is
 *     never the sort key, and there is no total anywhere.
 *
 * And giving a book is still never a condition of joining. That sentence is on
 * this page, on the rules page and in the footer, because a family who cannot
 * give must be able to read this one without feeling counted out of it.
 */
export default async function DonorsPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

  /*
   * No try/catch and no redirect. Unlike the catalogue there is no gate to be
   * refused by, and an unseeded database throwing here is a real 500 rather
   * than something to paper over with a sign-in screen.
   */
  const { entries, anonymousDonors } = await listDonorRegister();
  const hasGifts = entries.length > 0 || anonymousDonors > 0;

  return (
    <PublicShell branding={branding} signedIn={Boolean(actor)}>
      <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-16">
        {/*
          THE PLATE, BLANK.

          The inscription every donated book in this library carries, with the
          name line empty -- the plate a book that has not been given yet would
          have. Following any name below fills the same plate in.
        */}
        <Bookplate caption="Every name on this page. And, one day, yours.">
          <p className="font-display text-3xl italic leading-tight text-ink sm:text-4xl">
            A book leaves one home and does not stop.
          </p>
          <p className="mx-auto mt-5 max-w-lg text-lg text-ink-soft">
            It goes to a child on the fourth floor, then to one who was waiting for it, then to a
            family who have not moved in yet.
          </p>
        </Bookplate>

        <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <p className="text-xl text-ink">
              Thank you. You did not give a book away — you gave it to everyone.
            </p>
            <p className="mt-4 text-lg text-ink-soft">
              Every book on our shelves was carried here from a neighbour&rsquo;s flat. Joining the
              library is free and always will be, and giving a book is never a condition of it.
            </p>
          </div>
          <ButtonLink href="#give" size="lg" icon={<Icon name="gift" />} className="shrink-0">
            Give a book
          </ButtonLink>
        </div>

        {/* --- The register ------------------------------------------------- */}

        <section className="mt-16" aria-labelledby="register-heading">
          <h2 id="register-heading" className="garden-rule inline-block text-2xl sm:text-3xl">
            The neighbours who gave
          </h2>

          {hasGifts ? (
            <p className="mt-8 max-w-2xl text-lg text-ink-soft">
              In alphabetical order, and never by how many. A family who gave one book and a family
              who gave thirty gave the same thing: a book to a child who did not have it.
            </p>
          ) : null}

          <div className="mt-8">
            {entries.length === 0 ? (
              <EmptyState
                illustration={<Icon name="gift" />}
                title="Our first gift is still to come"
                action={
                  <ButtonLink href="#give" variant="secondary" size="lg" icon={<Icon name="gift" />}>
                    Give the first book
                  </ButtonLink>
                }
              >
                When a family shares a book with the library, we will say thank you right here.
              </EmptyState>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-lift">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">
                    Every family who has given a book, in alphabetical order, with the flat they
                    live in and how many books they have given.
                  </caption>
                  <thead>
                    <tr className="border-b-2 border-hairline">
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-bold uppercase tracking-[0.14em] text-ink-soft sm:px-6"
                      >
                        Book friend
                      </th>
                      <th
                        scope="col"
                        className="hidden px-5 py-4 text-xs font-bold uppercase tracking-[0.14em] text-ink-soft sm:table-cell sm:px-6"
                      >
                        Flat
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-4 text-xs font-bold uppercase tracking-[0.14em] text-ink-soft sm:px-6"
                      >
                        Books given
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-hairline transition-colors last:border-b-0 hover:bg-accent-wash/50"
                      >
                        <th scope="row" className="px-5 py-1 text-left font-normal sm:px-6">
                          {/*
                            The link fills the cell and carries its own padding,
                            so the whole name is the tap target rather than the
                            few pixels the text happens to occupy.
                          */}
                          <Link
                            href={`/donors/${entry.id}`}
                            className="-mx-2 block rounded-[var(--radius-field)] px-2 py-3 text-lg font-semibold text-primary-deep no-underline hover:underline"
                          >
                            {entry.label}
                            {entry.name && entry.apartment ? (
                              /*
                                The flat column is not there on a phone, so it
                                rides under the name instead of pushing the
                                table into a horizontal scroll. Only under a
                                name: a family who chose the flat alone is
                                already called by it, and printing it twice on a
                                375px screen wastes the row.
                              */
                              <span className="block text-sm font-normal text-ink-soft sm:hidden">
                                {entry.apartment}
                              </span>
                            ) : null}
                          </Link>
                        </th>
                        <td className="hidden px-5 py-4 text-lg text-ink-soft sm:table-cell sm:px-6">
                          {entry.apartment ?? "—"}
                        </td>
                        {/*
                          Left-aligned, with the word attached. A bare number
                          right-aligned down a column is a chart with the bars
                          taken off, and the eye reads it as a score.
                        */}
                        <td className="whitespace-nowrap px-5 py-4 text-lg text-ink sm:px-6">
                          {entry.bookCount === 1 ? "1 book" : `${entry.bookCount} books`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {anonymousDonors > 0 ? (
            <p className="mt-6 text-lg text-ink-soft">
              And{" "}
              {anonymousDonors === 1
                ? "one family who asked us not to print their name"
                : `${anonymousDonors} families who asked us not to print their names`}
              . Thank you too.
            </p>
          ) : null}
        </section>

        {/* --- Giving -------------------------------------------------------- */}

        <section
          id="give"
          aria-labelledby="give-heading"
          className="mt-16 scroll-mt-8 rounded-[var(--radius-card)] border-l-4 border-l-accent bg-surface p-6 shadow-lift sm:p-9"
        >
          <h2 id="give-heading" className="text-2xl sm:text-3xl">
            Have a book your child has outgrown?
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">
            A book on your shelf is one child&rsquo;s afternoon. The same book here is a hundred.
            Story books, picture books, comics, atlases, anything a child between four and fourteen
            would open — as long as it is whole enough for the next reader.
          </p>

          {branding.contactEmail ? (
            <p className="mt-7">
              <ButtonLink
                href={`mailto:${branding.contactEmail}?subject=I%20would%20like%20to%20give%20a%20book`}
                size="lg"
                icon={<Icon name="mail" />}
              >
                Write to {branding.contactEmail}
              </ButtonLink>
            </p>
          ) : (
            <p className="mt-7 text-lg text-ink">
              Bring it to the library and the librarian will take it from there.
            </p>
          )}

          <ul className="mt-8 grid gap-5 sm:grid-cols-3">
            {[
              {
                title: "You bring the book",
                body: "Hand it in at the library, or write to us and we will come and collect it.",
              },
              {
                title: "We write the plate",
                body: "A thank-you goes inside the front cover, and the book goes on the shelf.",
              },
              {
                title: "You choose the credit",
                body: "Your name and flat, your flat alone, or nothing at all. It is your choice, and we keep to it.",
              },
            ].map((step) => (
              <li key={step.title}>
                <h3 className="text-lg">{step.title}</h3>
                <p className="mt-1.5 text-base text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicShell>
  );
}
