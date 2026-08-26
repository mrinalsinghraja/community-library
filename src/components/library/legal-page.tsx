import { PageHeading } from "@/components/layout/site-shell";
import { LEGAL_LAST_UPDATED, type LegalDocument } from "@/lib/legal";

/**
 * One policy page, rendered the same way every time.
 *
 * A policy is read differently from the rest of this site: somebody is here to
 * find one answer, not to browse. So it is a single measured column with real
 * headings, no cards, no illustration and nothing that moves — the layout a
 * person can skim with a browser's find-in-page, or with a screen reader's list
 * of headings.
 *
 * The prose is set narrower than the page allows on purpose. A line of body
 * text that runs the full width of a laptop is where the eye loses its place,
 * and these are the pages most likely to be read by a parent on a laptop.
 */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <PageHeading title={document.title}>{document.standfirst}</PageHeading>

      <p className="mt-6 text-base text-ink-faint">Last updated {LEGAL_LAST_UPDATED}</p>

      <div className="mt-10 flex flex-col gap-10">
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="garden-rule inline-block text-2xl">{section.heading}</h2>

            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-5 text-lg leading-relaxed text-ink-soft">
                {paragraph}
              </p>
            ))}

            {section.bullets ? (
              <ul className="mt-5 flex flex-col gap-3">
                {section.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="ml-5 list-disc pl-1 text-lg leading-relaxed text-ink-soft marker:text-accent"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
