import type { Metadata } from "next";
import Link from "next/link";

import { PageHeading, PublicShell } from "@/components/layout/site-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { Icon, type IconName } from "@/components/ui/icon";
import { AGE_BAND_NOTE, AGE_GROUPS } from "@/lib/catalogue";
import { BORROW_REQUEST_MESSAGES } from "@/lib/circulation";
import { JOIN_HELP_MESSAGE, whatsAppLink } from "@/lib/whatsapp";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

export const metadata: Metadata = {
  title: "Questions and answers",
  description:
    "Who can join, what it costs, how borrowing works, what the library holds about your child, and how to reach a person.",
};

/**
 * Rendered per request, never prerendered — the same rule as the rules page.
 *
 * Every number on this page comes from `library_settings`. An administrator who
 * widens the age range or changes the borrowing limit must see it here at once,
 * and a page that baked the old numbers in at build time would keep telling
 * families something that stopped being true.
 */
export const dynamic = "force-dynamic";

/**
 * The questions a parent asks before they fill in a form.
 *
 * It exists because they were being answered one at a time on WhatsApp. The
 * rules page is for a child standing up; this is for an adult sitting down with
 * a phone, deciding whether to sign their nine-year-old up to something, and
 * the honest answers to "what do you keep about my child" and "what is this AI
 * thing" are the ones that decide it.
 *
 * Three rules for anything added here:
 *
 *   1. **No number is typed.** Ages, loan periods and limits are read from
 *      settings, so this page cannot drift from the software.
 *   2. **No promise the code does not keep.** Every answer below is checked
 *      against the behaviour it describes, and `tests/unit/faq.test.ts` holds
 *      the ones that would be embarrassing to get wrong.
 *   3. **No reassurance without the mechanism.** "We keep your child's data
 *      safe" is worth nothing; "the photograph is served only to you and the
 *      librarian, checked on every request" is worth something.
 */
export default async function FaqPage() {
  const branding = await getBrandingSafe();

  let settings: Awaited<ReturnType<typeof getCurrentLibrary>>["settings"] | null = null;
  try {
    settings = (await getCurrentLibrary()).settings;
  } catch {
    settings = null;
  }

  const whatsapp = whatsAppLink(branding.contactPhone, JOIN_HELP_MESSAGE);
  const books = (count: number) => (count === 1 ? "one book" : `${count} books`);
  const times = (count: number) => (count === 1 ? "once" : `up to ${count} times`);

  /*
   * The bands, written out from the catalogue's own list rather than typed.
   * When a band moves, this sentence moves with it — which is the whole reason
   * `AGE_GROUPS` is a single isomorphic list.
   */
  /*
   * Built here rather than inline, so the answer stays one sentence with the
   * numbers read out of settings. Written inline it needed a template inside a
   * template, which is unreadable and which `tests/unit/faq.test.ts` cannot see
   * past when it checks that no number was typed into the prose.
   */
  const renewalAnswer = settings
    ? settings.maxRenewals > 0
      ? `Ask the librarian to keep it longer — ${times(settings.maxRenewals)}, for another ${
          settings.renewalPeriodDays
        } days${settings.maxRenewals === 1 ? "" : " each time"}. Your child can ask from their own books page and the librarian answers.`
      : "Books are kept for their period so the next reader gets a turn. If something has come up, talk to the librarian."
    : "";

  const bandList = AGE_GROUPS.filter((group) => group.minYears !== null)
    .map((group) => group.label)
    .join(", ");

  const sections: { title: string; icon: IconName; items: { q: string; a: string }[] }[] = settings
    ? [
        {
          title: "Joining",
          icon: "reader",
          items: [
            {
              q: "Who can join?",
              a: `${
                settings.eligibilityNote ??
                "The library is for the children who live in this community."
              } Readers are aged ${settings.ageMin} to ${settings.ageMax}.`,
            },
            {
              q: `Why ${settings.ageMin} to ${settings.ageMax}?`,
              a: `The shelves are stocked for that range — from first picture books to novels a teenager will not feel talked down to by. A child a little outside it is still welcome to come and read in the library room with a grown-up; please talk to the librarian rather than assuming the answer is no.`,
            },
            {
              q: "What does it cost?",
              a: "Nothing, ever. There is no joining fee, no yearly fee and no deposit. The library is run by neighbours and the books were given by families in this community.",
            },
            {
              q: "Do we have to donate a book to join?",
              a: "No. Giving a book is completely voluntary and is never a condition of membership. A family that has never given a book has exactly the same card, the same shelf and the same welcome as one that has given twenty.",
            },
            {
              q: "How do we join?",
              a: "A parent or guardian fills in one short form — the child's name, the year they were born, your flat, and your name, email and phone. A librarian reads it, says hello, and sets up the card. You will get an email with a link so your child can choose their own password.",
            },
            {
              q: "Why do you ask for the year of birth and not the birthday?",
              a: "Because the year is enough to know a child is the right age for the library, and a full date of birth is one of the two or three facts that identify a person for life. We would rather not hold it at all than hold it because a form asked for it.",
            },
            {
              q: "Does it matter whether we own our flat or rent it?",
              a: "Not at all. The library is for the children who live here, and how a family came to live here is not the library's business.",
            },
            {
              q: "My child is nearly the oldest age. Is it worth joining?",
              a: `Yes. Nothing is taken away on a birthday, and the top of the range is not a cliff — a reader keeps their books, their history and their reviews. When somebody grows past the range the account is closed to borrowing, nothing is deleted, and a librarian will have talked to you first.`,
            },
          ],
        },
        {
          title: "Borrowing",
          icon: "shelf",
          items: [
            {
              q: "How many books at a time?",
              a: `${books(settings.maxActiveLoans)} at home at once. Bring one back and your child can choose another straight away.`,
            },
            {
              q: "How long can we keep a book?",
              a: `${settings.borrowingPeriodDays} days. The date is on your child's own books page, so nobody has to remember it.`,
            },
            {
              q: "What if we need longer?",
              a: renewalAnswer,
            },
            {
              q: "Can we take a book straight off the shelf?",
              a: BORROW_REQUEST_MESSAGES.collectionNote,
            },
            {
              q: "What happens if a book is lost or damaged?",
              a: "Tell the librarian, and tell them early. Accidents are part of a book being read, and what happens next is a conversation between a family and a person — not something this page decides in advance. What matters is that the library knows the copy is gone.",
            },
            {
              q: "How does my child give a book back?",
              a: "They tell the library from their own books page that they want to return it, then hand it to the librarian, who takes it back at the desk. A book is never put on a shelf by a reader — that is how a library loses track of what it has.",
            },
          ],
        },
        {
          title: "Reading ages on books",
          icon: "age",
          items: [
            {
              q: "What do the ages on a book mean?",
              a: `Books are grouped into three: ${bandList}, plus books that suit any age. The grouping is about how a book is written — the shortest sentences and the biggest pictures at one end, and books that argue with you at the other.`,
            },
            {
              q: "Can my child only borrow books in their own band?",
              a: `${AGE_BAND_NOTE} There is no age check anywhere in the borrowing process. A seven-year-old who reads ahead of their years may take a book from the oldest band, and a thirteen-year-old may take a picture book, and neither has to explain themselves.`,
            },
            {
              q: "Why band them at all, then?",
              a: "To help a child find something they will enjoy without reading the first page of forty books. It is a signpost, not a gate.",
            },
          ],
        },
        {
          title: "Your child's details",
          icon: "key",
          items: [
            {
              q: "What do you hold about my child?",
              a: "Their name, the year they were born, your flat, a picture if you chose to add one, and your name, email and phone. Then what they have borrowed, and any reviews they have written. That is the whole list, and the privacy notice sets it out field by field.",
            },
            {
              q: "Who can see my child's photograph?",
              a: "You, your child, and a librarian. It is not on the public catalogue and it is not on any page another family can open — every request for it is checked against who is asking. It can be removed at any time by asking the librarian.",
            },
            {
              q: "Can other families see my child's name?",
              a: "Only if your child writes a review of a book and chooses to sign it, and then it shows a first name and nothing else. Nothing else about a reader is public — not their flat, not what they have borrowed, not their card number.",
            },
            {
              q: "My child forgot their password. What happens?",
              a: "The reset link is emailed to the guardian's address on the account, never to the child, and never to anyone else. Nobody at the library can see or choose a child's password — not even the administrator.",
            },
            {
              q: "Something on the record is wrong. How do we fix it?",
              a: "Your child can propose a correction from their own account page, and an administrator approves it before anything changes. Or tell the librarian and they will sort it out.",
            },
            {
              q: "What happens to the record when we leave?",
              a: "Nothing is deleted the moment an account closes — the lending history is the library's record of its own books. If the library has set an erasure schedule, the personal details are erased after it and the loan rows stay with the borrower's card number in place of their name. The privacy notice states the current schedule.",
            },
          ],
        },
        {
          title: "The AI book helper",
          icon: "sparkle",
          items: [
            {
              q: "What is the helper on each book page?",
              a: "It is an AI. It answers questions about that one book — what it is about, whether it is scary, what to read next — in language pitched at the book's own reading age.",
            },
            {
              q: "Does it know anything about my child?",
              a: "No. It is told about the book and nothing about the reader — not their name, not their age, not what they have borrowed. Nothing typed into it is stored, and it is never asked a question on its own.",
            },
            {
              q: "Can it give my child advice?",
              a: "It is instructed to refuse anything medical, legal, financial or about their safety and to tell them to ask an adult they trust. It is a machine and it can be wrong, which is exactly why it is labelled as one rather than dressed up as a librarian.",
            },
          ],
        },
        {
          title: "Coming to the library",
          icon: "home",
          items: [
            {
              q: "Where is it?",
              a: branding.venueAddress,
            },
            {
              q: "When is it open?",
              a: "The visiting times are on your child's own books page, and the librarian posts each week's times there. If nothing is listed yet, ask.",
            },
            {
              q: "Who runs it?",
              a: `Neighbours, unpaid. ${branding.libraryName} is run by volunteers from ${branding.communityName}, and a person answers your message rather than a robot — please allow a little time.`,
            },
          ],
        },
      ]
    : [];

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
        <PageHeading title="Questions and answers">
          Everything a family usually asks before joining — and the things worth knowing
          afterwards. If your question is not here, ask a person.
        </PageHeading>

        {sections.length === 0 ? (
          <Callout tone="info" title="Not set up yet" className="mt-10">
            The library has not finished setting up. Please ask the librarian.
          </Callout>
        ) : (
          <div className="mt-12 flex flex-col gap-10">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="flex items-center gap-2.5 text-2xl">
                  <span className="flex size-9 items-center justify-center rounded-full bg-accent-wash text-accent-ink">
                    <Icon name={section.icon} />
                  </span>
                  {section.title}
                </h2>

                <div className="mt-5 flex flex-col gap-4">
                  {section.items.map((item) => (
                    <Card key={item.q} tone="shelf">
                      <CardBody>
                        {/*
                          A real heading per question, not a styled paragraph:
                          this page is read by somebody scanning for one answer,
                          and a screen reader should be able to jump between them.
                        */}
                        <h3 className="text-lg font-bold text-ink">{item.q}</h3>
                        <p className="mt-2 text-ink-soft">{item.a}</p>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <Card className="mt-12">
          <CardBody>
            <h2 className="text-2xl">Still wondering?</h2>
            <p className="mt-3 text-ink-soft">
              Ask a person — a neighbour replies, not a robot, so please allow a little time.
            </p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {whatsapp ? (
                <li className="list-none">
                  {/*
                    The same prefilled message as the home page and the joining
                    guide, from the same helper, so a family gets one door.
                  */}
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-primary-deep no-underline"
                  >
                    Message us on WhatsApp
                  </a>
                </li>
              ) : null}
              {branding.contactEmail ? (
                <li className="list-none">
                  <a
                    href={`mailto:${branding.contactEmail}`}
                    className="font-bold text-primary-deep no-underline"
                  >
                    {branding.contactEmail}
                  </a>
                </li>
              ) : null}
              <li className="list-none pt-1">
                <Link href="/how-to-join" className="font-bold text-primary-deep no-underline">
                  How to join, step by step
                </Link>
              </li>
              <li className="list-none">
                <Link href="/rules" className="font-bold text-primary-deep no-underline">
                  Our simple rules
                </Link>
              </li>
              <li className="list-none">
                <Link href="/privacy" className="font-bold text-primary-deep no-underline">
                  What we hold, and for how long
                </Link>
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </PublicShell>
  );
}
