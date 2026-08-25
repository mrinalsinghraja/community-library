import { LibraryLogo } from "@/components/library/library-logo";

/**
 * The card a child is given, drawn at the top of the front page.
 *
 * A parent arriving here is being asked for their child's name, and "sign up"
 * is an abstraction. The card is not: it is the actual object the librarian
 * fills in and hands over, and drawing it turns membership into a thing you can
 * picture your child putting in their pocket.
 *
 * It is also aimed squarely at who is reading. Parents in this building grew up
 * with a ruled card in a paper pocket at the back of a library book, and the
 * form is doing that work — recognition, not nostalgia for its own sake.
 *
 * **Used once, on the home page.** The library's signature is the garden rule
 * (see docs/DESIGN_SYSTEM.md §4) and this does not compete with it: it is one
 * illustration on one page, not a device repeated across the application.
 *
 * The name line is deliberately blank. Every other way of drawing this needed a
 * placeholder name, and inventing a child to advertise a children's library is
 * exactly the note this page must not hit.
 */
export function MembershipCard({
  logoUrl,
  libraryName,
  rules,
}: {
  logoUrl: string | null;
  libraryName: string;
  /** From library settings. Absent on an unconfigured library; the card still draws. */
  rules: {
    ageMin: number;
    ageMax: number;
    borrowingPeriodDays: number;
    maxActiveLoans: number;
  } | null;
}) {
  return (
    <div className="relative">
      {/*
        Tipped a degree and a half. This is the one liberty the page takes, and
        it buys the whole idea: square to the grid it reads as another panel in
        a web page, and off-axis it reads as an object lying on a desk. Undone
        below `sm`, where a tilted card beside a straight column of text just
        looks like a mistake.
      */}
      <div className="rounded-[var(--radius-card)] bg-surface p-6 shadow-raise sm:rotate-[-1.5deg] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <LibraryLogo
            logoUrl={logoUrl}
            libraryName={libraryName}
            size={96}
            priority={false}
            className="w-14 shrink-0 sm:w-16"
          />
          <p className="text-right text-sm font-bold uppercase tracking-[0.18em] text-accent-ink">
            Library
            <br />
            card
          </p>
        </div>

        <div className="mt-7">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-ink-soft">Reader</p>
          {/*
            A rule, not an input. Nothing here is fillable and nothing is
            submitted — it is a drawing of a card, and a box a parent could
            click into would promise otherwise.
          */}
          <div className="mt-3 h-px w-full bg-control-border" />
          <p className="mt-2 text-base text-ink-soft">Your child&rsquo;s name goes here</p>
        </div>

        {rules ? (
          <dl className="mt-7 grid grid-cols-3 gap-3 border-t border-hairline pt-5">
            <div>
              <dt className="text-sm text-ink-soft">Ages</dt>
              <dd className="text-lg font-bold text-ink">
                {rules.ageMin}&ndash;{rules.ageMax}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">At a time</dt>
              <dd className="text-lg font-bold text-ink">
                {rules.maxActiveLoans} {rules.maxActiveLoans === 1 ? "book" : "books"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">To keep</dt>
              <dd className="text-lg font-bold text-ink">{rules.borrowingPeriodDays} days</dd>
            </div>
          </dl>
        ) : null}

        <p className="mt-6 rounded-[var(--radius-field)] bg-accent-wash px-4 py-3 text-base font-bold text-ink">
          Free. No fees, no fines, no catch.
        </p>
      </div>
    </div>
  );
}
