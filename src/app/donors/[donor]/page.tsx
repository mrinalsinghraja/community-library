import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Bookplate } from "@/components/library/bookplate";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatInTimezone } from "@/lib/dates";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import { catalogueIsPubliclyVisible, getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getDonorGifts } from "@/server/services/donor-service";

export const dynamic = "force-dynamic";

/**
 * One family's shelf of gifts.
 *
 * The payoff for the blank plate on the register: here the same plate is filled
 * in with this family's credit, and under it are the books that carry it.
 *
 * Two things this page deliberately does not do.
 *
 * **It is not a way around the catalogue.** The shelf is member-only by
 * setting, and covers are refused to a signed-out request by the media route on
 * exactly that setting. So a gift is printed as a title, an author and the
 * month it arrived -- no cover, no copy code, no shelf, no condition, and no
 * "on loan to". That is a record of a gift rather than a second catalogue, it
 * looks the same to everybody, and nothing here had to be unlocked to build it.
 * The title becomes a link only for a visitor who could already open it.
 *
 * **It has no page for a family who asked to stay out of it.** An anonymous
 * donor is not in the register and their id is not derivable from it; asking
 * for one anyway gets the same 404 as an id that was never real.
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

  const credit = entry.label;
  const givenMonth = (givenAt: Date) => formatInTimezone(givenAt, settings.timezone, "MMM yyyy");

  return (
    <PublicShell branding={branding} signedIn={Boolean(actor)}>
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Link
          href="/donors"
          className="inline-flex items-center gap-1.5 text-base font-bold text-primary-deep"
        >
          <span aria-hidden="true">&larr;</span> All our book friends
        </Link>

        <Bookplate
          className="mt-6"
          credit={credit}
          caption={entry.name && entry.apartment ? entry.apartment : undefined}
        />

        <p className="mt-9 text-xl text-ink">
          {gifts.length === 1
            ? "One book on our shelves carries this plate."
            : `${gifts.length} books on our shelves carry this plate.`}{" "}
          Thank you.
        </p>

        <section className="mt-10" aria-labelledby="gifts-heading">
          <h2 id="gifts-heading" className="sr-only">
            Books given by {credit}
          </h2>

          <ul className="rounded-[var(--radius-card)] bg-surface shadow-lift">
            {gifts.map((gift) => (
              <li
                key={gift.code}
                className="flex flex-col gap-1 border-b border-hairline px-5 py-5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6 sm:px-7"
              >
                {/*
                  The month is the left rail, and it is the reason there is no
                  01 / 02 / 03 down the side: the list is already in the order
                  the books arrived, and the date says so with real information
                  instead of decoration.
                */}
                <span className="shrink-0 font-mono text-xs uppercase tracking-[0.16em] text-ink-faint sm:w-24 sm:pt-1">
                  {givenMonth(gift.givenAt)}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-xl leading-snug text-ink">
                    {canOpenBooks ? (
                      <Link href={`/books/${gift.code}`} className="text-primary-deep">
                        {gift.title}
                      </Link>
                    ) : (
                      gift.title
                    )}
                  </span>
                  {gift.authors.length > 0 ? (
                    <span className="mt-0.5 block text-base text-ink-soft">
                      {gift.authors.join(", ")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-12 text-lg text-ink-soft">
          Every one of these was carried here from a neighbour&rsquo;s flat, and is being read by
          someone who did not have it.
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
