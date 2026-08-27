import { MemberAvatar } from "@/components/library/avatar";
import { LibraryLogo } from "@/components/library/library-logo";
import { CARD_INK } from "@/lib/card-art";
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
 * A pass, not a panel. A deep field carrying everything that identifies the
 * reader, a foil rule, and a pale plinth along the bottom for the house rules —
 * the proportions and the order of a membership card, which is why it reads as
 * one before a word of it has been read.
 *
 * The field is the house green taken down far enough to carry white type at
 * 15:1, engraved with the faintest rings — the guilloche of a certificate,
 * reduced to the one thing it is for, which is stopping a large flat rectangle
 * of colour reading as a coloured box. The member code is set in the sun tone
 * and in the mono face, because it is a serial number and the librarian at the
 * desk has to read it off a phone screen at arm's length.
 *
 * Colours come from `@/lib/card-art` rather than from a class name here: the
 * canvas and the PDF draw the same card, and a hex typed in three files is a
 * hex that will be wrong in one of them. Layout does not — this one has to be
 * fluid from a phone to a desktop, and the other two are drawn on a fixed grid.
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
  const allowances = facts.rules ? cardAllowances(facts.rules) : [];

  const details: string[] = [];
  if (facts.apartment) details.push(`Home ${facts.apartment}`);
  if (facts.joinedAt) {
    details.push(`Reader since ${formatInTimezone(facts.joinedAt, timezone, "MMM yyyy")}`);
  }

  return (
    <div
      id="library-card"
      className={`@container overflow-hidden rounded-[1.1rem] shadow-raise ${className ?? ""}`}
    >
      {/* ---- The field -------------------------------------------------- */}
      <div
        className="relative isolate px-5 pb-6 pt-5 @[26rem]:px-7 @[26rem]:pb-7 @[26rem]:pt-6"
        style={{
          backgroundImage: `linear-gradient(to bottom, ${CARD_INK.fieldTop}, ${CARD_INK.fieldBase})`,
        }}
      >
        {/* The engraving. Decorative, and stretched with the card on purpose. */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 380 176"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
        >
          <g fill="none" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="0.7">
            {[46, 67, 88, 109, 130, 151, 172, 193, 214, 235].map((r) => (
              <circle key={`a${r}`} cx="330" cy="16" r={r} />
            ))}
            {[64, 88, 112, 136, 160].map((r) => (
              <circle key={`b${r}`} cx="40" cy="200" r={r} />
            ))}
          </g>
        </svg>

        {/* ---- Header --------------------------------------------------- */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/*
              A white tile, the size and shape of the chip on a bank card. The
              mark's own artwork is on white, so the tile is the frame it was
              drawn for — and any logo a community uploads gets the same one.
            */}
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-[0.6rem] p-1 @[26rem]:size-12"
              style={{ backgroundColor: CARD_INK.white }}
            >
              <LibraryLogo
                logoUrl={facts.logoUrl}
                libraryName={facts.libraryName}
                size={64}
                priority={false}
                className="w-full"
              />
            </span>

            <div className="min-w-0">
              {/* Two lines on a narrow card, one on a wide one: an ellipsis through a
                  library's own name is a worse answer than a second line. */}
              <p className="line-clamp-2 text-base leading-tight font-bold text-white @[32rem]:truncate @[32rem]:text-lg">
                {facts.libraryName}
              </p>
              <p className="truncate text-xs text-white/70">{facts.communityName}</p>
            </div>
          </div>

          <p className="shrink-0 pt-1 text-[0.5rem] font-bold uppercase tracking-[0.16em] text-white/60 @[26rem]:text-[0.6rem] @[26rem]:tracking-[0.22em]">
            Reader card
          </p>
        </div>

        <div className="mt-5 h-px w-full bg-white/15" />

        {/* ---- The person ----------------------------------------------- */}
        <div className="mt-6 flex items-center gap-4">
          {issued ? (
            <MemberAvatar
              avatarKey={facts.avatarKey}
              photoUrl={facts.photoMediaId ? `/api/media/${facts.photoMediaId}` : null}
              name={facts.readerName ?? "Reader"}
              size={60}
              className="shrink-0 ring-2 ring-white/25"
            />
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.22em] text-white/55">
              Reader
            </p>

            {issued ? (
              <>
                <p className="mt-1 truncate text-2xl leading-tight font-bold text-white @[26rem]:text-3xl">
                  {facts.readerName}
                </p>
                <p
                  className="code mt-1.5 text-base font-bold tracking-[0.18em]"
                  style={{ color: CARD_INK.sun }}
                >
                  {facts.memberCode}
                </p>
              </>
            ) : (
              <>
                {/*
                  A rule, not an input. Nothing here is fillable and nothing is
                  submitted — it is a drawing of a card, and a box a parent
                  could click into would promise otherwise.
                */}
                <div className="mt-3 h-px w-full bg-white/25" />
                <p className="mt-2 text-base text-white/60">{CARD_MESSAGES.specimenName}</p>
              </>
            )}
          </div>
        </div>

        {/* ---- Where they live, and the line the library is about --------- */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {details.length > 0 ? (
            <p className="text-sm text-white/75">{details.join("   ·   ")}</p>
          ) : (
            <span />
          )}

          <p
            className="rounded-full border border-white/30 px-3 py-1 text-xs font-bold"
            style={{ color: CARD_INK.sun }}
          >
            {CARD_MESSAGES.free}
          </p>
        </div>

        {/* ---- What the card allows -------------------------------------- */}
        {allowances.length > 0 ? (
          <dl className="mt-6 grid grid-cols-3">
            {allowances.map((item, index) => (
              <div
                key={item.label}
                className={index > 0 ? "border-l border-white/20 pl-4 @[26rem]:pl-6" : "pr-4"}
              >
                <dt className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-white/60">
                  {item.label}
                </dt>
                <dd className="mt-1 text-lg font-bold text-white @[26rem]:text-xl">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {/* The library's signature, doing duty as the rule that closes a field. */}
      <div
        aria-hidden="true"
        className="h-[3px] w-full"
        style={{
          backgroundImage: `linear-gradient(to right, ${CARD_INK.leaf}, ${CARD_INK.primary}, ${CARD_INK.accent})`,
        }}
      />

      {/* ---- House rules, along the bottom ------------------------------ */}
      <div className="px-5 py-5 @[26rem]:px-7" style={{ backgroundColor: CARD_INK.plinth }}>
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-ink-soft">
          Looking after a book
        </p>
        <ul className="mt-2.5 grid gap-x-8 gap-y-1.5 @[30rem]:grid-cols-2">
          {rules.map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-sm text-ink">
              <span
                aria-hidden="true"
                className="mt-[0.45rem] size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: CARD_INK.leaf }}
              />
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
