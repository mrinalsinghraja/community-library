import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { Butterfly, LeafSprig, LibraryLogo } from "@/components/library/library-logo";
import { CatalogueSearchBand } from "@/components/library/catalogue-search";
import { HelperPreview } from "@/components/library/helper-preview";
import { MembershipCard } from "@/components/library/membership-card";
import { PublicShell } from "@/components/layout/site-shell";
import { WhatsAppButton, WhatsAppHelp } from "@/components/library/whatsapp-help";
import { DONATE_BOOKS_MESSAGE } from "@/lib/whatsapp";
import { bookHelperEnabled } from "@/server/lib/ai/groq";
import { catalogueIsPubliclyVisible, getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { browseCatalogue, listCategories } from "@/server/services/catalogue-service";
import { Icon } from "@/components/ui/icon";

/**
 * The front door.
 *
 * Everything on this page — name, welcome message, age range, loan length,
 * colours — is read from library configuration. There is no literal
 * "Mana Jardin" anywhere in this file, and a lint rule enforces that.
 *
 * ## Who this page is written for
 *
 * Not a child. A **parent**, on a phone, who has just been sent a link in the
 * residents' group and is deciding whether this is real. The children arrive
 * later and arrive already signed in; this page is the only one on the site
 * whose job is to persuade rather than to serve.
 *
 * ## Why it does not boast
 *
 * The shelf has a handful of books on it. A front page with "500 BOOKS · 200
 * HAPPY READERS" would be a lie that the catalogue disproves in one click, and
 * a stat block reading "4" is worse than no stat block at all.
 *
 * So the page argues from the things that are true and are *better* than
 * volume: it is downstairs, it is free with no fines, every book on it was
 * carried down by a neighbour, and it is at the beginning — which is an
 * invitation rather than an apology. A library of four books that admits it
 * has four books is trustworthy. That is the whole marketing strategy, and it
 * is also the community-building one: the honest number is the reason somebody
 * brings a book down.
 *
 * The order of the bands is the order a sceptical parent asks the questions:
 * what is this and what does it cost → what is on the shelf → what do I do →
 * why does it matter → what do you do with my child's details → who do I ask.
 */

export default async function HomePage() {
  const branding = await getBrandingSafe();

  // Rules come from settings; if the library is not configured yet the page
  // still renders and says so plainly rather than crashing.
  let rules: { ageMin: number; ageMax: number; borrowingPeriodDays: number; maxActiveLoans: number } | null =
    null;
  try {
    const { settings } = await getCurrentLibrary();
    rules = {
      ageMin: settings.ageMin,
      ageMax: settings.ageMax,
      borrowingPeriodDays: settings.borrowingPeriodDays,
      maxActiveLoans: settings.maxActiveLoans,
    };
  } catch {
    rules = null;
  }

  /*
   * The shelf, if a stranger is allowed to see it.
   *
   * Both reads are guarded and both are allowed to fail quietly: an unseeded
   * database, or a library that keeps its catalogue behind the front door,
   * simply means the front page has no search band and keeps the sign-in call
   * to action it already had. A home page must render.
   */
  const cataloguePublic = await catalogueIsPubliclyVisible().catch(() => false);
  const [categories, shelf] = cataloguePublic
    ? await Promise.all([
        listCategories().catch(() => []),
        browseCatalogue({ pageSize: 1 }).catch(() => null),
      ])
    : [[], null];

  const bookCount = shelf?.total ?? 0;

  return (
    <PublicShell branding={branding}>
      {!branding.configured ? (
        <div className="mx-auto max-w-5xl px-5 pt-6 sm:px-8">
          <Callout tone="warn" title="This library is not set up yet">
            No library configuration was found. Run the seed described in{" "}
            <code className="code text-base">docs/SETUP.md</code> to create the community,
            library and settings rows.
          </Callout>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Hero — what this is, what it costs, and the card                  */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <Butterfly className="drift absolute right-[12%] top-10 w-10 opacity-80 sm:w-14" />
          <LeafSprig className="absolute bottom-6 left-[4%] hidden w-12 opacity-50 md:block" />
        </div>

        <div className="relative mx-auto grid max-w-5xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.1fr_1fr] md:py-20">
          <div>
            <LibraryLogo
              logoUrl={branding.logoUrl}
              libraryName={branding.libraryName}
              size={200}
              className="mb-7 w-32 sm:w-44"
            />

            {/*
              The greeting is the eyebrow and the claim is the headline, which
              is the opposite of how this page used to be set.

              `welcomeMessage` is the administrator's own words and belongs on
              the page, but "Welcome to our library" is a greeting, and setting
              a greeting at 42px meant the largest thing on a page whose whole
              job is persuasion said nothing at all. The sentence a parent
              actually needs — a library, here, free — is now the h1.
            */}
            <p className="flex items-start gap-2.5 text-lg font-bold text-accent-ink">
              {/* Ours, not the device's — an Apple butterfly and an Android one
                  are two different drawings, and neither is this library's. */}
              <Butterfly className="mt-0.5 w-6 shrink-0" />
              <span>{branding.welcomeMessage}</span>
            </p>

            <h1 className="mt-4 text-4xl sm:text-5xl">
              A free library, right here in {branding.communityName}.
            </h1>

            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Children choose their own book, take it home, and bring it back when they are done.
              No fee to join, nothing to pay if a book comes back late, and no test at the end.
              Reading here is meant to be the good part of the day.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <ButtonLink href="/join" size="lg" icon={<Icon name="sparkle" />}>
                Ask for a library card
              </ButtonLink>
              <ButtonLink href="/login" size="lg" variant="secondary" icon={<Icon name="key" />}>
                Sign in
              </ButtonLink>
            </div>

            <p className="mt-5 text-base text-ink-soft">
              One short form, filled in by a grown-up.{" "}
              <Link href="/how-to-join" className="font-bold text-primary-deep">
                See what happens next
              </Link>
              .
            </p>
          </div>

          <MembershipCard
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            rules={rules}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Finding a book, without an account                                */}
      {/*                                                                   */}
      {/* Second, and before any argument about why libraries are good.     */}
      {/* Somebody who already knows what a library is came here to see      */}
      {/* whether it has anything worth walking down for.                    */}
      {/* ---------------------------------------------------------------- */}
      {cataloguePublic ? (
        <CatalogueSearchBand categories={categories} totalBooks={bookCount} />
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 pb-6 sm:px-8">
        <h2 className="garden-rule inline-block text-3xl">How our library works</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card tone="shelf" className="lift">
            <CardTitle icon={<Icon name="reader" />}>Ask to join</CardTitle>
            <CardBody>
              A grown-up fills in one short form. Our librarian says hello and sets up a library
              card in your child&rsquo;s name.
            </CardBody>
          </Card>

          <Card tone="shelf" className="lift">
            <CardTitle icon={<Icon name="search" />}>Choose a book</CardTitle>
            <CardBody>
              Your child picks it — not us, and not a reading level. Choosing is the part that
              turns a reader into a regular one.
            </CardBody>
          </Card>

          <Card tone="shelf" className="lift">
            <CardTitle icon={<Icon name="home" />}>Take it home</CardTitle>
            <CardBody>
              {rules
                ? `Keep it for ${rules.borrowingPeriodDays} days, then bring it back so the next reader can enjoy it. Late? Just bring it down — nothing happens.`
                : "Keep it for a while, then bring it back so the next reader can enjoy it. Late? Just bring it down — nothing happens."}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Why it is worth walking down for                                  */}
      {/*                                                                   */}
      {/* The three arguments that are true here and are not true of a       */}
      {/* bookshop or a reading app: it is a habit rather than a task, it is */}
      {/* the neighbours, and there is a helper for the questions a child    */}
      {/* would otherwise have to stop reading to go and ask.                */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        <h2 className="garden-rule inline-block text-3xl">Why it is worth walking down for</h2>

        {/*
          Two, not three. There were three, and the third described the helper —
          immediately above a panel that shows the helper working. Two rows of
          three cards also made the two sections above and below read as the
          same component twice, which is how a page stops being looked at.
        */}
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <Card tone="sunk">
            <CardTitle icon={<Icon name="renew" />}>A habit, not a task</CardTitle>
            <CardBody>
              A book is a short walk away, so finishing one and starting the next is easy enough to
              keep doing. Nobody is graded, nobody is tested, and nobody is fined. Children who
              choose their own books keep reading for longer.
            </CardBody>
          </Card>

          <Card tone="sunk">
            <CardTitle icon={<Icon name="handshake" />}>Built by the neighbours</CardTitle>
            <CardBody>
              Every book on the shelf was carried down by a family who lives here, and the library
              is run by volunteers from the same corridors. Children end up reading the same books
              as the friends they already play with.
            </CardBody>
          </Card>

        </div>

        {/*
          The helper, drawn rather than described, because "AI assistant" is a
          phrase every parent has learned to distrust and a two-line exchange is
          not. Hidden entirely when the helper is switched off, so the page
          never advertises something the site is not currently doing.
        */}
        {bookHelperEnabled() ? (
          <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-center">
            <div>
              <h3 className="text-2xl">Questions do not have to wait</h3>
              <p className="mt-3 text-lg text-ink-soft">
                Children ask things at nine in the evening — who wrote this, is it scary, what
                should I read after. The helper answers on the spot, about the book they are
                actually holding, and tells them to ask a librarian when it matters.
              </p>
              <p className="mt-4 text-base text-ink-soft">
                It only talks about books, it never asks a child anything about themselves, and no
                conversation is kept.
              </p>
            </div>
            <HelperPreview />
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* An honest beginning — the number, and what to do about it          */}
      {/*                                                                   */}
      {/* This band replaces the old "every book here is a gift" card. It    */}
      {/* does the same job — thank the neighbours, ask for nothing — but it */}
      {/* leads with the real size of the shelf, because that number is the  */}
      {/* single most persuasive thing on the page for the one reader who    */}
      {/* has a box of outgrown books in a cupboard.                          */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
        <Card tone="primary" className="relative overflow-hidden">
          <LeafSprig className="pointer-events-none absolute -bottom-3 right-5 w-24 opacity-25" />

          <div className="relative max-w-2xl">
            {/*
              Two headings, because the true sentence changes as the shelf
              fills. "We are just beginning" is the honest and persuasive line
              at four books and an odd one at two hundred, and a front page that
              still says it next year is a front page nobody has read.
            */}
            <h2 className="text-2xl sm:text-3xl">
              {bookCount === 0
                ? "We are just beginning"
                : bookCount < 25
                  ? `We are just beginning — ${bookCount} ${bookCount === 1 ? "book" : "books"} so far`
                  : `${bookCount} books on our shelf`}
            </h2>

            <p className="mt-3 text-lg text-ink-soft">
              Every one of them was given by a family here. The shelf grows the week somebody
              remembers the picture books their child has outgrown, and it grows again when the
              next family does the same.
            </p>

            <p className="mt-3 text-lg text-ink-soft">
              Giving a book is never a condition of borrowing one. If you have nothing to pass on,
              your child is exactly as welcome, and nobody will know the difference.
            </p>

            <div className="mt-6 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center">
              <WhatsAppButton
                phone={branding.contactPhone}
                message={DONATE_BOOKS_MESSAGE}
                variant="secondary"
                size="sm"
              >
                Offer a book on WhatsApp
              </WhatsAppButton>

              <ButtonLink href="/donors" variant="quiet" size="sm" icon={<Icon name="heart" />}>
                Meet our book friends
              </ButtonLink>
            </div>
          </div>
        </Card>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* What we do with your child's details                              */}
      {/*                                                                   */}
      {/* The question a parent asks last and decides on first. Every line   */}
      {/* below is a property the application actually has — none of it is   */}
      {/* a promise about the future — and each one links to the page that   */}
      {/* states it in full.                                                 */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
        <div className="rounded-[var(--radius-card)] bg-lavender-wash p-6 sm:p-8">
          <h2 className="garden-rule inline-block text-2xl sm:text-3xl">
            What we do with your child&rsquo;s details
          </h2>

          <ul className="mt-14 grid gap-4 sm:grid-cols-2">
            {[
              {
                icon: "hide" as const,
                text: "We ask for as little as we can, and a grown-up fills it in — never the child.",
              },
              {
                icon: "camera" as const,
                text: "A photograph stays private unless you tell us otherwise, and you can change your mind.",
              },
              {
                icon: "quote" as const,
                text: "If your child writes about a book, a librarian reads it before anyone else does, and it is signed with a first name only — or with no name, if they prefer.",
              },
              {
                icon: "shelf" as const,
                text: "No advertising, and nothing on the pages children use is tracking them. Even the lettering is served from here rather than fetched from another company.",
              },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-3">
                <Icon name={item.icon} className="mt-1 shrink-0 text-primary-deep" />
                <span className="text-base text-ink">{item.text}</span>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-base text-ink-soft">
            <Link href="/rules" className="font-bold text-primary-deep">
              Read our rules in full
            </Link>{" "}
            — they are short, and written to be read by a child as well as a grown-up.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Help — a person, reachable where people already are               */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
        <WhatsAppHelp phone={branding.contactPhone} />
      </section>
    </PublicShell>
  );
}
