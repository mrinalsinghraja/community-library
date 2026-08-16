import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { LibraryLogo, ShelfIllustration } from "@/components/library/library-logo";
import { PublicShell } from "@/components/layout/site-shell";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

/**
 * The front door.
 *
 * Everything on this page — name, welcome message, age range, loan length,
 * colours — is read from library configuration. There is no literal
 * "Mana Jardin" anywhere in this file, and a lint rule enforces that.
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
            <code className="font-mono text-base">docs/SETUP.md</code> to create the community,
            library and settings rows.
          </Callout>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto grid max-w-5xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.15fr_1fr] md:py-20">
        <div>
          <p className="flex items-center gap-2 text-lg font-bold text-accent-ink">
            <span aria-hidden="true">📚</span>
            Free · Community owned · Run by our young readers
          </p>

          <h1 className="mt-4 text-4xl sm:text-5xl">{branding.welcomeMessage}</h1>

          <p className="mt-5 max-w-xl text-lg text-ink-soft">
            A little library of shared books, in a corner of our own community.
            {rules ? (
              <>
                {" "}
                Readers aged {rules.ageMin} to {rules.ageMax} can borrow{" "}
                {rules.maxActiveLoans === 1 ? "a book" : `${rules.maxActiveLoans} books`} at a time
                and keep {rules.maxActiveLoans === 1 ? "it" : "them"} for {rules.borrowingPeriodDays}{" "}
                days.
              </>
            ) : null}
          </p>

          <div className="mt-9 flex flex-wrap gap-4">
            <ButtonLink href="/join" size="lg" icon="✨">
              Join the library
            </ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary" icon="🔑">
              Sign in
            </ButtonLink>
          </div>

          <p className="mt-5 text-base text-ink-soft">
            Joining is free. It always will be.
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] bg-surface p-7 shadow-raise">
          <ShelfIllustration />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-5 pb-6 sm:px-8">
        <h2 className="shelf-edge inline-block text-3xl">How our library works</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Card tone="shelf">
            <CardTitle icon="🙋">Ask to join</CardTitle>
            <CardBody>
              A grown-up fills in one short form. Our librarian says hello and sets up a library
              card for you.
            </CardBody>
          </Card>

          <Card tone="shelf">
            <CardTitle icon="🔎">Find a book</CardTitle>
            <CardBody>
              Look through the shelves — stories, comics, space, animals, and plenty more waiting to
              be discovered.
            </CardBody>
          </Card>

          <Card tone="shelf">
            <CardTitle icon="🏠">Take it home</CardTitle>
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
        <Card tone="primary" className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <LibraryLogo
            logoUrl={branding.logoUrl}
            libraryName={branding.libraryName}
            size={72}
            className="shrink-0"
          />
          <div>
            <h2 className="text-2xl">Every book here is a gift</h2>
            <p className="mt-2 text-ink-soft">
              Our shelves are filled by families who wanted to share a story they loved. If you have
              a book to pass on, we would be delighted — and if you do not, you are just as welcome.
              Borrowing is never tied to giving.
            </p>
          </div>
        </Card>
      </section>
    </PublicShell>
  );
}
