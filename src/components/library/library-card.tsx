import { MemberAvatar } from "@/components/library/avatar";
import { LibraryLogo } from "@/components/library/library-logo";
import { formatInTimezone } from "@/lib/dates";
import { CARD_MESSAGES, cardAllowances, shortRules, type LibraryCardFacts } from "@/lib/library-card";

/**
 * The library card, drawn once and used twice.
 *
 * **Specimen** — a blank name line, on the front page, where its job is to make
 * "sign up" concrete for a parent who has never seen the library.
 * **Issued** — the same object with a child's own name, code and face on it.
 *
 * One component for both, because they must not drift: the card a parent is
 * shown before joining is a promise, and the card their child gets is the thing
 * that has to keep it.
 *
 * ## The shape
 *
 * A real card, not a panel: a coloured header band with the mark, a white body
 * for the person, and a footer of house rules along the bottom — the layout of
 * every membership card anybody has ever been handed, which is exactly why it
 * reads as one instantly.
 *
 * `id="library-card"` is how the PNG exporter finds it. Nothing else depends on
 * that id, and the download degrades to the PDF if it is ever missing.
 */
export function LibraryCard({
  facts,
  timezone,
  className,
}: {
  facts: LibraryCardFacts;
  /** For the joined date. The library's timezone, never the browser's. */
  timezone: string;
  className?: string;
}) {
  const issued = Boolean(facts.memberCode);
  const rules = shortRules(facts.rules);

  return (
    <div
      id="library-card"
      className={`overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-raise ${className ?? ""}`}
    >
      {/* ---- Header band ------------------------------------------------ */}
      <div className="flex items-center justify-between gap-4 bg-primary-deep px-6 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          {/*
            On white inside the band, so the mark keeps its own colours. The
            butterflies are berry and leaf; laid straight onto deep green they
            lose the leaf entirely.
          */}
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface p-1.5">
            <LibraryLogo
              logoUrl={facts.logoUrl}
              libraryName={facts.libraryName}
              size={64}
              priority={false}
              className="w-full"
            />
          </span>
          <p className="min-w-0 truncate text-base font-bold text-white">{facts.libraryName}</p>
        </div>

        <p className="shrink-0 text-right text-xs font-bold uppercase tracking-[0.2em] text-white/85">
          Reader
          <br />
          card
        </p>
      </div>

      {/* The library's signature, doing duty as the band that closes a card. */}
      <div
        aria-hidden="true"
        className="h-1 w-full bg-[linear-gradient(to_right,var(--color-leaf),var(--color-primary),var(--color-accent))]"
      />

      {/* ---- The person ------------------------------------------------- */}
      <div className="px-6 py-6 sm:px-7">
        <div className="flex items-start gap-4">
          {issued ? (
            <MemberAvatar
              avatarKey={facts.avatarKey}
              photoUrl={facts.photoMediaId ? `/api/media/${facts.photoMediaId}` : null}
              name={facts.readerName ?? "Reader"}
              size={64}
              className="shrink-0 ring-2 ring-hairline"
            />
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">Reader</p>

            {issued ? (
              <>
                <p className="mt-1 truncate text-2xl leading-tight font-bold text-ink">
                  {facts.readerName}
                </p>
                <p className="code mt-1 text-base text-primary-deep">{facts.memberCode}</p>
              </>
            ) : (
              <>
                {/*
                  A rule, not an input. Nothing here is fillable and nothing is
                  submitted — it is a drawing of a card, and a box a parent
                  could click into would promise otherwise.
                */}
                <div className="mt-3 h-px w-full bg-control-border" />
                <p className="mt-2 text-base text-ink-soft">{CARD_MESSAGES.specimenName}</p>
              </>
            )}
          </div>
        </div>

        {issued ? (
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-base">
            {facts.apartment ? (
              <div className="flex gap-2">
                <dt className="text-ink-soft">Home</dt>
                <dd className="font-bold text-ink">{facts.apartment}</dd>
              </div>
            ) : null}
            {facts.joinedAt ? (
              <div className="flex gap-2">
                <dt className="text-ink-soft">Reader since</dt>
                <dd className="font-bold text-ink">
                  {formatInTimezone(facts.joinedAt, timezone, "MMM yyyy")}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {/* ---- What the card allows ------------------------------------- */}
        {facts.rules ? (
          <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-hairline pt-5">
            {cardAllowances(facts.rules).map((item) => (
              <div key={item.label}>
                <dt className="text-sm text-ink-soft">{item.label}</dt>
                <dd className="text-lg font-bold text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="mt-5 rounded-[var(--radius-field)] bg-accent-wash px-4 py-3 text-base font-bold text-ink">
          Free. No fees, no catch.
        </p>
      </div>

      {/* ---- House rules, along the bottom ------------------------------ */}
      <div className="border-t border-hairline bg-surface-sunk px-6 py-4 sm:px-7">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">
          Looking after a book
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {rules.map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-base text-ink">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-leaf" />
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
