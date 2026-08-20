import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { Butterfly, LeafSprig, LibraryLogo, ShelfIllustration } from "@/components/library/library-logo";
import { PublicShell } from "@/components/layout/site-shell";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Icon } from "@/components/ui/icon";

/**
 * The front door.
 *
 * Everything on this page — name, welcome message, age range, loan length,
 * colours — is read from library configuration. There is no literal
 * "Mana Jardin" anywhere in this file, and a lint rule enforces that.
 *
 * The hero leads with the library's own mark rather than a headline, because
 * the mark *is* the headline: three butterflies over a green rule, which is the
 * whole visual argument of the place. The shelf drawing sits opposite it.
 */

export default async function HomePage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

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

  return (
    <PublicShell branding={branding} signedIn={Boolean(actor)}>
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
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        {/*
          The two big wash circles that used to sit here are gone. The garden is
          drawn once now, behind the whole reader app (`StoryCharacters`), and
          two ambient systems on one page is one too many — the blobs were
          reading as smudges under the drawings rather than as anything.
        */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <Butterfly className="drift absolute right-[12%] top-10 w-10 opacity-80 sm:w-14" />
          <LeafSprig className="absolute bottom-6 left-[4%] hidden w-12 opacity-50 md:block" />
        </div>

        <div className="relative mx-auto grid max-w-5xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.15fr_1fr] md:py-20">
          <div>
            {/* The mark leads. On a phone it sits above the words; on a desktop
                it is the first thing at the top-left of the whole page. */}
            <LibraryLogo
              logoUrl={branding.logoUrl}
              libraryName={branding.libraryName}
              size={200}
              className="mb-7 w-32 sm:w-44"
            />

            <p className="flex items-start gap-2.5 text-lg font-bold text-accent-ink">
              {/* Ours, not the device's — an Apple butterfly and an Android one
                  are two different drawings, and neither is this library's. */}
              <Butterfly className="mt-0.5 w-6 shrink-0" />
              <span>Free · Community owned · Run by our young readers</span>
            </p>

            <h1 className="mt-4 text-4xl sm:text-5xl">{branding.welcomeMessage}</h1>

            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Find a new story. Discover something amazing. Take a book home.
              {rules ? (
                <>
                  {" "}
                  Readers aged {rules.ageMin} to {rules.ageMax} can borrow{" "}
                  {rules.maxActiveLoans === 1 ? "a book" : `${rules.maxActiveLoans} books`} at a time
                  and keep {rules.maxActiveLoans === 1 ? "it" : "them"} for{" "}
                  {rules.borrowingPeriodDays} days.
                </>
              ) : null}
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <ButtonLink href="/join" size="lg" icon={<Icon name="sparkle" />}>
                Join the library
              </ButtonLink>
              <ButtonLink href="/login" size="lg" variant="secondary" icon={<Icon name="key" />}>
                Sign in
              </ButtonLink>
            </div>

            <p className="mt-5 text-base text-ink-soft">Joining is free. It always will be.</p>
          </div>

          <div className="rounded-[var(--radius-card)] bg-surface p-7 shadow-raise">
            <ShelfIllustration />
          </div>
        </div>
      </section>

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
              card for you.
            </CardBody>
          </Card>

          <Card tone="shelf" className="lift">
            <CardTitle icon={<Icon name="search" />}>Find a book</CardTitle>
            <CardBody>
              Look through the shelves — stories, comics, space, animals, and plenty more waiting to
              be discovered.
            </CardBody>
          </Card>

          <Card tone="shelf" className="lift">
            <CardTitle icon={<Icon name="home" />}>Take it home</CardTitle>
            <CardBody>
              {rules
                ? `Keep it for ${rules.borrowingPeriodDays} days, then bring it back so the next reader can enjoy it.`
                : "Keep it for a while, then bring it back so the next reader can enjoy it."}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Donations — gratitude, never a requirement                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        <Card tone="primary" className="relative flex flex-col gap-5 overflow-hidden sm:flex-row sm:items-center">
          <LeafSprig className="pointer-events-none absolute -bottom-2 right-4 w-20 opacity-25" />
          <LibraryLogo
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            size={96}
            priority={false}
            className="w-16 shrink-0 sm:w-20"
          />
          <div className="relative">
            <h2 className="text-2xl">Every book here is a gift</h2>
            <p className="mt-2 text-ink-soft">
              Our shelves are filled by families who wanted to share a story they loved. If you have
              a book to pass on, we would be delighted — and if you do not, you are just as welcome.
              Borrowing is never tied to giving.
            </p>
            <p className="mt-4">
              <ButtonLink href="/donors" variant="secondary" size="sm" icon={<Icon name="heart" />}>
                Meet our book friends
              </ButtonLink>
            </p>
          </div>
        </Card>
      </section>
    </PublicShell>
  );
}
