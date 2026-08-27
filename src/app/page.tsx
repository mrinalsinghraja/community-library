import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { Butterfly, LeafSprig, LibraryLogo } from "@/components/library/library-logo";
import { CatalogueSearchBand } from "@/components/library/catalogue-search";
import { HelperPreview } from "@/components/library/helper-preview";
import { LibraryCard } from "@/components/library/library-card";
import { PublicShell } from "@/components/layout/site-shell";
import { WhatsAppButton, WhatsAppHelp } from "@/components/library/whatsapp-help";
import { DONATE_BOOKS_MESSAGE } from "@/lib/whatsapp";
import { bookHelperEnabled } from "@/server/lib/ai/groq";
import { catalogueIsPubliclyVisible, getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listCategories } from "@/server/services/catalogue-service";
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
 * volume: it is downstairs, it is free to join, every book on it was
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
  /*
   * Where the room is and who may use it — both configuration, both read here
   * so the front page says exactly what the rules page says. A parent sent this
   * link asks two questions before any other: is my child allowed, and where do
   * I go. Neither answer is worth making them hunt for.
   */
  let venue: { name: string; address: string; eligibility: string | null } | null = null;
  // Only the specimen card needs it, and the specimen carries no dates — but
  // the card component asks for one, so it gets the library's rather than a
  // browser's.
  let timezone = "UTC";
  try {
    const { settings } = await getCurrentLibrary();
    timezone = settings.timezone;
    rules = {
      ageMin: settings.ageMin,
      ageMax: settings.ageMax,
      borrowingPeriodDays: settings.borrowingPeriodDays,
      maxActiveLoans: settings.maxActiveLoans,
    };
    venue = {
      name: settings.venueName,
      address: settings.venueAddress ?? settings.venueName,
      eligibility: settings.eligibilityNote,
    };
  } catch {
    rules = null;
    venue = null;
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
  const categories = cataloguePublic ? await listCategories().catch(() => []) : [];

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
              No fee to join, no test at the end, and no catch. Reading here is meant to be the
              good part of the day.
            </p>

            {/*
              The address, in the hero, in the display face.
              
              It is the shortest true argument this page has. Everything else
              here is a claim a parent has to take on trust; "it is in the room
              downstairs" is a thing they can check on their way past, and it is
              the whole reason a library in a building beats one across town.
            */}
            {venue ? (
              <p className="mt-5 flex items-start gap-2.5 text-lg text-ink">
                <Icon name="home" className="mt-1 shrink-0 text-primary-deep" />
                <span>
                  <strong className="font-display">{venue.address}</strong>
                  {venue.eligibility ? (
                    <span className="block text-base text-ink-soft">{venue.eligibility}</span>
                  ) : null}
                </span>
              </p>
            ) : null}

            <div className="mt-9 flex flex-wrap gap-4">
              <ButtonLink href="/join" size="lg" icon={<Icon name="sparkle" />}>
                Ask for a library card
              </ButtonLink>
              <ButtonLink href="/login" size="lg" variant="secondary" icon={<Icon name="key" />}>
                Sign in
              </ButtonLink>
            </div>

            <p className="mt-5 text-base text-ink-soft">
              One short form, filled in by a parent or guardian.{" "}
              <Link href="/how-to-join" className="font-bold text-primary-deep">
                See what happens next
              </Link>
              , or read the{" "}
              {/*
                Where a parent looks before filling anything in. These questions
                were being answered one at a time on WhatsApp, which meant the
                answer depended on who happened to reply.
              */}
              <Link href="/faq" className="font-bold text-primary-deep">
                questions families ask
              </Link>
              .
            </p>
          </div>

          {/*
            The specimen: the very same component a reader sees on `/my-card`,
            with the name line left blank. One card, drawn once — what a parent
            is shown before joining has to be the thing their child is given,
            and two components would have drifted apart within a month.
          */}
          <div className="sm:rotate-[-1.5deg]">
            <LibraryCard
              timezone={timezone}
              facts={{
                readerName: null,
                memberCode: null,
                apartment: null,
                birthYear: null,
                joinedAt: null,
                avatarKey: null,
                photoMediaId: null,
                libraryName: branding.libraryName,
                communityName: branding.communityName,
                logoUrl: branding.logoUrl,
                rules,
              }}
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Finding a book, without an account                                */}
      {/*                                                                   */}
      {/* Second, and before any argument about why libraries are good.     */}
      {/* Somebody who already knows what a library is came here to see      */}
      {/* whether it has anything worth walking down for.                    */}
      {/* ---------------------------------------------------------------- */}
      {/*
        The count is deliberately not passed. Same reason as the band further
        down: while the shelf is still being catalogued the number measures the
        import, not the library. `CatalogueSearchBand` already writes "every
        book on our shelves" when it has no figure to quote.
      */}
      {cataloguePublic ? <CatalogueSearchBand categories={categories} /> : null}

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 pb-6 sm:px-8">
        <h2 className="garden-rule inline-block text-3xl">How our library works</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card tone="shelf" className="lift">
            <CardTitle icon={<Icon name="reader" />}>Ask to join</CardTitle>
            <CardBody>
              A parent or guardian fills in one short form. Our librarian says hello and sets up a library
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
                ? `Keep it for ${rules.borrowingPeriodDays} days, then bring it back so the next reader can enjoy it. Need longer? Just ask the librarian.`
                : "Keep it for a while, then bring it back so the next reader can enjoy it. Need longer? Just ask the librarian."}
            </CardBody>
            {/*
              Where the exchange physically happens, on the card about the
              exchange. A signed-in reader gets the actual dates on their own
              page; this says the times exist and are published, which is what a
              parent deciding whether to join needs to know.
            */}
            {venue ? (
              <CardBody className="mt-2.5 text-base text-ink-soft">
                Collecting and returning happen at the {venue.name}, at the times shown on your
                child&rsquo;s own page each week.
              </CardBody>
            ) : null}
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

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card tone="sunk">
            <CardTitle icon={<Icon name="renew" />}>A habit, not a task</CardTitle>
            <CardBody>
              A book is a short walk away, so finishing one and starting the next is easy enough to
              keep doing. Nobody is graded and nobody is tested. Children who choose their own
              books keep reading for longer.
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

          <Card tone="sunk">
            <CardTitle icon={<Icon name="sparkle" />}>Curiosity, answered</CardTitle>
            <CardBody>
              A question about a book used to mean waiting until somebody had time. Now every book
              on our shelves has an AI Librarian on its page that answers what a child wants to know about
              it — free, and in words that suit their age.
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
          <div className="mt-10 grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-accent-ink">
                Something no shelf on its own can do
              </p>
              <h3 className="mt-2 text-2xl sm:text-3xl">Every book comes with someone to ask</h3>
              <p className="mt-4 text-lg text-ink-soft">
                Children are relentless about the questions a book leaves behind. Who wrote this,
                and what else did they write? Is it scary? Was any of it real? When was it first
                published, and what was the world like then? What should I read after this one?
              </p>
              <p className="mt-3 text-lg text-ink-soft">
                Every book on our shelves has an AI Librarian on its page that answers all of that —
                the story, the author, the history around it, where to go next — pitched at the age
                the book is shelved for. It is free, it needs no account, and it is awake at nine in
                the evening when the questions actually arrive.
              </p>
              <p className="mt-4 text-base text-ink-soft">
                It only talks about books, it says plainly when it is unsure, it never asks a child
                anything about themselves, and no conversation is kept.
              </p>
            </div>
            <HelperPreview />
          </div>
        ) : null}

        {/*
          What the AI Librarian does, in three, for the parent reading this
          before their child ever will.

          Written to answer the three questions a careful parent actually has
          about an AI aimed at their nine-year-old — what does it do, what does
          it know about my child, and what stops it going somewhere it should
          not — rather than to list features. The third card is the one that
          matters and it is deliberately not softened: the limits are the
          selling point.
        */}
        {bookHelperEnabled() ? (
          <div className="mt-16">
            <h3 className="garden-rule inline-block text-2xl sm:text-3xl">
              What the AI Librarian does
            </h3>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              <Card>
                <CardTitle icon={<Icon name="quote" />}>Answers, on the book&rsquo;s own page</CardTitle>
                <CardBody>
                  Tap a book and ask. What is it about, is it frightening, was any of it real, who
                  else did the author write for? Answers come back in two or three sentences, in
                  words that suit the age the book is shelved for — so a six-year-old and a
                  thirteen-year-old asking the same question get different answers.
                </CardBody>
              </Card>

              <Card>
                <CardTitle icon={<Icon name="sparkle" />}>Suggests what to read next</CardTitle>
                <CardBody>
                  Once a child has borrowed a few books, their own page can show three suggestions
                  drawn from what they have actually read and enjoyed, each with a line saying why.
                  Every one is a book this library physically holds — never a title we would have to
                  send a family away to buy.
                </CardBody>
              </Card>

              <Card>
                <CardTitle icon={<Icon name="key" />}>Knows books, not children</CardTitle>
                <CardBody>
                  It is told what a child has read. It is never told who they are — no name, no age,
                  no flat, no contact detail leaves this library. It talks about books and declines
                  everything else, says &ldquo;I am not sure&rdquo; rather than inventing an answer,
                  and never asks a child anything about themselves. Conversations are not kept.
                </CardBody>
              </Card>
            </div>

            {/*
              The honest caveat, in print, at the end of the section that sells
              the thing. A parent who finds the limitation themselves later
              trusts the rest of the page less; a parent who is told it here has
              been given the measure of how the whole site talks to them.
            */}
            <p className="mt-8 max-w-3xl text-base text-ink-soft">
              It is a computer, and computers get things wrong. The AI Librarian is there to help a
              child pick a book and satisfy a passing curiosity — not to do their homework, and not
              to replace the librarian in the room, who is the one who knows both the shelves and
              your child.
            </p>
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
              No number here, deliberately.

              An earlier draft printed the real shelf count on the grounds that
              a public catalogue would expose it anyway. That was wrong for a
              shelf still being catalogued: the figure on any given morning
              measures how far through the import somebody has got, not how big
              the library is, and a front page that says "4 books" the week
              before forty arrive is misleading in the direction that costs
              most. The invitation is the point, and it does not need a
              quantity to land.
            */}
            <h2 className="text-2xl sm:text-3xl">
              We have just started, and we are looking for your help
            </h2>

            <p className="mt-3 text-lg text-ink-soft">
              Every book on our shelves was given by a family here. The library grows the week
              somebody remembers the picture books their child has outgrown, and it grows again
              when the next family does the same — which is the whole plan.
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
                text: "We ask for as little as we can, and a parent or guardian fills it in — never the child.",
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
            — they are short, and written to be read by a child as well as a parent. The{" "}
            <Link href="/faq" className="font-bold text-primary-deep">
              questions and answers
            </Link>{" "}
            go further: what we hold about your child, who can see it, and for how long.
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
