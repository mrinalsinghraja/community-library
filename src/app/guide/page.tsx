import type { Metadata } from "next";
import Link from "@/components/ui/app-link";

import { PageBody, PageHeading, PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/states";
import { Icon } from "@/components/ui/icon";
import { formatCode } from "@/lib/codes";
import { numberSteps, readerGuide, type GuideFacts, type GuideStep } from "@/lib/reader-guide";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

export const metadata: Metadata = {
  title: "How to use the library",
  description:
    "A step-by-step guide with pictures: joining, signing in, finding and asking for a book, keeping it longer, bringing it back, stars, the AI Librarian and your card.",
};

/**
 * The reader's guide (ADR-075).
 *
 * Public, like the rules and questions pages: a parent reads it before joining,
 * and a child reads it before they have a password. It asks nobody for a
 * session and reads no data about anyone — only the library's own settings, so
 * that every number and name on it is the library's real one.
 *
 * Per request rather than prerendered for the same reason as /rules: a setting
 * changed at the desk must be true here at once.
 */
export const dynamic = "force-dynamic";

/** What the guide says when settings cannot be read. Plain, and still true. */
const FALLBACK_FACTS: GuideFacts = {
  venueName: "the library room",
  borrowingPeriodDays: 14,
  maxActiveLoans: 2,
  cardExample: "your card number",
};

async function guideFacts(): Promise<GuideFacts> {
  try {
    const { settings } = await getCurrentLibrary();
    return {
      venueName: `the ${settings.venueName}`,
      borrowingPeriodDays: settings.borrowingPeriodDays,
      maxActiveLoans: settings.maxActiveLoans,
      cardExample: formatCode(settings.memberCodePrefix, 42, settings.memberCodePadding),
    };
  } catch {
    return FALLBACK_FACTS;
  }
}

export default async function GuidePage() {
  const [branding, facts] = await Promise.all([getBrandingSafe(), guideFacts()]);
  const sections = readerGuide(facts);
  const numbers = numberSteps(sections);

  return (
    <PublicShell branding={branding}>
      <PageBody>
        <PageHeading eyebrow="Reader's guide" title="How to use the library">
          Step by step, with a picture of every screen — for readers, and for the grown-ups
          helping them.
        </PageHeading>

        <Callout tone="info" className="mt-8">
          The pictures show a practice library, with made-up books and a made-up reader called
          Demo Reader. Your own screens will show your own name and your library&rsquo;s books.
        </Callout>

        {/* ------------------------------------------------------------- */}
        {/* Contents                                                        */}
        {/* ------------------------------------------------------------- */}
        <nav id="contents" aria-labelledby="contents-heading" className="mt-12 scroll-mt-28">
          <h2 id="contents-heading" className="garden-rule inline-block text-2xl sm:text-3xl">
            What is in this guide
          </h2>
          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section, index) => (
              <li key={section.id} className="list-none">
                <a
                  href={`#${section.id}`}
                  className="lift group flex h-full items-center gap-3.5 rounded-[var(--radius-card)] bg-surface px-4 py-3.5 no-underline shadow-lift"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent-ink"
                  >
                    <Icon name={section.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                      Part {index + 1}
                    </span>
                    <span className="block text-lg font-semibold leading-snug text-ink group-hover:text-accent-ink">
                      {section.title}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* ------------------------------------------------------------- */}
        {/* The parts                                                       */}
        {/* ------------------------------------------------------------- */}
        {sections.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="mt-20 scroll-mt-28"
          >
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-accent-ink">
              <Icon name={section.icon} />
              Part {index + 1}
            </p>
            <h2 id={`${section.id}-heading`} className="garden-rule mt-3 inline-block text-3xl">
              {section.title}
            </h2>
            <p className="mt-8 max-w-2xl text-lg text-ink-soft">{section.lead}</p>

            <ol className="mt-8 flex flex-col gap-6">
              {section.steps.map((step) => (
                <GuideStepCard key={step.title} step={step} number={numbers.get(step) ?? 0} />
              ))}
            </ol>

            <p className="mt-6 text-base">
              <a href="#contents" className="font-bold text-primary-deep">
                Back to the list of parts
              </a>
            </p>
          </section>
        ))}

        {/* ------------------------------------------------------------- */}
        {/* Still stuck                                                     */}
        {/* ------------------------------------------------------------- */}
        <section
          aria-labelledby="stuck-heading"
          className="theme-band relative isolate mt-20 overflow-hidden rounded-[var(--radius-card)] px-6 py-8 shadow-card sm:px-9"
        >
          <h2 id="stuck-heading" className="relative text-2xl sm:text-3xl">
            Still stuck?
          </h2>
          <p className="relative mt-4 max-w-2xl text-lg text-ink-soft">
            Ask the librarian at the next visiting time, or read the{" "}
            <Link href="/faq" className="font-bold text-primary-deep">
              questions families ask
            </Link>
            {branding.contactEmail ? (
              <>
                {" "}— or write to{" "}
                <a href={`mailto:${branding.contactEmail}`} className="font-bold text-primary-deep">
                  {branding.contactEmail}
                </a>
              </>
            ) : null}
            .
          </p>
          <div className="relative mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/login" icon={<Icon name="key" />}>
              Sign in
            </ButtonLink>
            <ButtonLink href="/join" variant="secondary" icon={<Icon name="sparkle" />}>
              Ask for a library card
            </ButtonLink>
          </div>
        </section>
      </PageBody>
    </PublicShell>
  );
}

/**
 * One step: what to do on the left, the screen on the right — stacked on a
 * phone, where the picture sits under the words that explain it.
 */
function GuideStepCard({ step, number }: { step: GuideStep; number: number }) {
  return (
    <li className="list-none rounded-[var(--radius-card)] bg-surface p-5 shadow-lift sm:p-7">
      <div className="grid gap-7 md:grid-cols-[minmax(0,1fr)_17.5rem] md:gap-10">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-lg font-bold text-white"
            >
              {number}
            </span>
            <h3 className="pt-1 text-xl leading-snug sm:text-2xl">
              <span className="sr-only">Step {number}: </span>
              {step.title}
            </h3>
          </div>

          <div className="mt-4 flex flex-col gap-3 text-lg text-ink-soft sm:ps-14">
            {(step.body ?? []).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}

            {step.doThis ? (
              <ol className="flex flex-col gap-2.5">
                {step.doThis.map((line) => (
                  <li key={line} className="flex list-none items-start gap-3 text-ink">
                    <Icon name="check" className="mt-1 shrink-0 text-success" />
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            {step.parentNote ? (
              <p className="mt-1 rounded-[var(--radius-field)] border-l-4 border-l-accent bg-accent-wash px-4 py-3 text-base text-ink">
                <span className="font-bold text-accent-ink">For grown-ups: </span>
                {step.parentNote}
              </p>
            ) : null}
          </div>
        </div>

        {step.image ? (
          <figure className="mx-auto w-full max-w-[17.5rem] md:mx-0">
            <div className="overflow-hidden rounded-[1.6rem] border-[6px] border-ink/85 bg-ground shadow-raise">
              {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot, already sized and compressed */}
              <img
                src={`/guide/${step.image.file}.webp`}
                width={step.image.width / 2}
                height={step.image.height / 2}
                alt={step.image.alt}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full"
              />
            </div>
          </figure>
        ) : null}
      </div>
    </li>
  );
}
