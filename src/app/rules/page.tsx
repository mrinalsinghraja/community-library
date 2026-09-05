import type { Metadata } from "next";

import { PageBody, PageHeading, PublicShell } from "@/components/layout/site-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { BORROW_REQUEST_MESSAGES } from "@/lib/circulation";
import { visitVenueSentence } from "@/lib/visits";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";

export const metadata: Metadata = { title: "Our simple rules" };

/**
 * Rendered per request, never prerendered.
 *
 * This page reads library configuration, and an administrator changing the loan
 * period or the borrowing limit must see it here immediately. Static generation
 * would bake the values in at build time and quietly serve stale rules until
 * the next deploy.
 */
export const dynamic = "force-dynamic";

/**
 * The library's rules, in a child's language.
 *
 * Short enough to read standing up. Not terms and conditions:
 * nobody has to agree to this page, there is nothing to accept, and a child who
 * breaks one of these is not in trouble — they are a child who has a book under
 * their bed.
 *
 * **Every number here is read from library_settings.** Changing the borrowing
 * limit in the admin screen changes this page, because there is no second copy
 * of the rules to fall out of step with the first. If a rule below cannot be
 * written without a number, it takes the number from `settings`; if it can, it
 * does not mention one.
 *
 * Rule 1 is the one a family checks first and the one a renting family used to
 * have to ask about: the library is for the children of this building, and
 * owning or renting the flat makes no difference to that. Leaving it to
 * inference made the asking itself the barrier.
 *
 * Rule 3 is the one this page exists for. The books are objects on shelves in a
 * room, and the catalogue is not a shop: finding a book here does not mean
 * taking it home. That sentence lives in `BORROW_REQUEST_MESSAGES` so that the
 * rules page, the book page and the child's own shelf all say it the same way.
 */
export default async function RulesPage() {
  const branding = await getBrandingSafe();

  let settings: Awaited<ReturnType<typeof getCurrentLibrary>>["settings"] | null = null;
  try {
    settings = (await getCurrentLibrary()).settings;
  } catch {
    settings = null;
  }

  const books = (count: number) => (count === 1 ? "one book" : `${count} books`);

  const rules: { icon: IconName; title: string; body: string }[] = settings
    ? [
        {
          icon: "home",
          title: "Who the library is for",
          body:
            settings.eligibilityNote ??
            "The library is for the children who live in this community.",
        },
        {
          icon: "book",
          title: "Books are for everyone",
          body: "Look after the books so the next reader can enjoy them too. Every book on our shelves is waiting for somebody else after you.",
        },
        /*
         * Said out loud, as a rule, because the absence of a rule is invisible.
         * The catalogue prints "Best for 8–10 years" on books, and a child who
         * reads ahead of or behind their years is exactly the one who would
         * quietly put a book back rather than ask. There has never been an age
         * check in the borrowing code and there is not one now — see
         * `AGE_BAND_NOTE` and `ageGroupSuggestion` in src/lib/catalogue.ts.
         */
        {
          icon: "age",
          title: "Any book, any reader",
          /*
           * No example band in this sentence, deliberately. Every other rule on
           * this page renders its numbers from library settings, and
           * `public-pages.test.ts` enforces that by refusing any digit here —
           * a rule that quotes "8–10" would be a second copy of the catalogue's
           * vocabulary, kept in prose, going stale the first time a band moves.
           */
          body: "Some books say what age they were written for. That is only a suggestion to help you choose. You may borrow any book in the library, whatever your age — read ahead, or go back to an old favourite. Nobody will stop you.",
        },
        {
          icon: "shelf",
          title: "Browse first, borrow through the librarian",
          body: `Come and look at the shelves whenever you like, and read here in the library room. ${BORROW_REQUEST_MESSAGES.collectionNote}`,
        },
        {
          icon: "card",
          title: `${books(settings.maxActiveLoans)} at a time`,
          body: `You can have ${books(settings.maxActiveLoans)} at home at once. Bring one back and you can choose another straight away.`,
        },
        {
          icon: "home",
          title: `Keep a book for ${settings.borrowingPeriodDays} days`,
          body: `That is how long a book is yours for. The date is on your own books page, so you never have to remember it.`,
        },
        {
          icon: "renew",
          title: "Need more time?",
          body:
            settings.maxRenewals > 0
              ? `Still reading? Ask the librarian to keep it longer — ${
                  settings.maxRenewals === 1 ? "once" : `up to ${settings.maxRenewals} times`
                }, for another ${settings.renewalPeriodDays} days. They will let you know.`
              : "Please bring books back on their date so the next reader can enjoy them.",
        },
        {
          icon: "heart",
          title: "Take care of the books",
          body: "Keep them clean, dry and safe. Please do not write in them, draw in them or tear the pages. If something happens to a book, just tell the librarian — accidents are part of reading, and nobody will be cross.",
        },
        {
          icon: "gift",
          title: "Sharing is a choice",
          body: "Giving a book to the library is completely up to you. Nobody needs to give anything to be a member, and joining is always free.",
        },
        {
          icon: "sparkle",
          title: "Be kind",
          body: "The library is a shared space. Please be gentle with the books, the room and everyone else reading in it.",
        },
        {
          icon: "returnBook",
          title: "Bring books back to the librarian",
          body: "Hand a book back to the librarian rather than putting it on a shelf yourself, so the library always knows where everything is.",
        },
      ]
    : [];

  return (
    <PublicShell branding={branding}>
      <PageBody width="wide">
        <PageHeading eyebrow="How we share" title="Our simple rules">
          Short, and none of them are complicated.
        </PageHeading>

        {!settings ? (
          <Callout tone="warn" title="Not configured yet" className="mt-8">
            The library settings have not been created, so the rules cannot be shown.
          </Callout>
        ) : (
          <>
            <div className="mt-10 grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
              {rules.map((rule, index) => (
                <Card key={rule.title} tone="shelf" className="lift">
                  <CardTitle icon={<Icon name={rule.icon} />}>
                    {/*
                      Numbered, because a rule you can point at is easier to
                      talk about than a rule you have to describe.
                    */}
                    {index + 1}. {rule.title}
                  </CardTitle>
                  <CardBody>{rule.body}</CardBody>
                </Card>
              ))}

              <Card tone="shelf" className="lift">
                <CardTitle icon={<Icon name="calendar" />}>
                  {rules.length + 1}. Where the library is, and when
                </CardTitle>
                <CardBody>
                  {/*
                    The address in full, because this is the line somebody reads
                    out to a neighbour, and then the instruction that makes it
                    useful. A room without an opening time is a locked door.
                  */}
                  Our shelves live at{" "}
                  <strong>{settings.venueAddress ?? settings.venueName}</strong>.{" "}
                  {visitVenueSentence(settings.venueName)} Please follow the usual house rules of
                  the building while you are there — it is everybody&rsquo;s room, and the library
                  is a guest in it.
                </CardBody>
              </Card>
            </div>

            {/*
              What happens when something goes wrong, said as a next step rather
              than as a policy.

              This paragraph used to promise "no fines here, ever". It was kindly
              meant, and it was still the library writing itself a rule it had
              not agreed on — published on the page families are pointed at, and
              covering a lost or wrecked book as much as a book that came back a
              day late. The library does not threaten anybody and does not need
              to promise it never will; it needs a child to come and say
              something early, which is what this now asks for.
            */}
            <p className="mt-10 text-lg text-ink-soft">
              If a book is late, we will send a friendly reminder to your family. If you need
              longer, or if something has happened to a book, please come and tell the librarian —
              it is always easier to sort out early, and nobody will be cross with you.
            </p>

            {/*
              Anything the library has written for itself, kept below the ten and
              in the administrator's own words. Whitespace preserved: it was
              typed as lines, and it is shown as lines.
            */}
            {settings.rulesMarkdown ? (
              <Card className="mt-10">
                <CardTitle icon={<Icon name="audit" />}>House rules</CardTitle>
                <CardBody>
                  <p className="whitespace-pre-line">{settings.rulesMarkdown}</p>
                </CardBody>
              </Card>
            ) : null}
          </>
        )}
      </PageBody>
    </PublicShell>
  );
}
