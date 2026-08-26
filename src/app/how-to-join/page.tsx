import type { Metadata } from "next";

import { PageHeading, PublicShell } from "@/components/layout/site-shell";
import { WhatsAppHelp } from "@/components/library/whatsapp-help";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Callout } from "@/components/ui/states";
import { visitVenueSentence } from "@/lib/visits";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

export const metadata: Metadata = { title: "How to join" };

/**
 * Rendered per request. Every number and every step below is read from library
 * settings — the ages accepted, whether a parent has to confirm their email —
 * so an administrator changing one changes this page rather than leaving a
 * second, stale copy of the instructions to be discovered by a family.
 */
export const dynamic = "force-dynamic";

/**
 * How a parent gets their child a library card.
 *
 * The page exists because the form does not explain itself. `/join` asks six
 * questions and then goes quiet: what happens next, how long it takes, why an
 * email has not arrived and whether a second child needs a second form are all
 * things a parent has had to guess at, and guessing wrong looks to them like
 * the library ignoring them.
 *
 * Written to the parent, in the order they will actually live it, and honest
 * about the waiting: two of these steps are somebody else's turn, and a page
 * that hides that makes a normal delay feel like a fault.
 *
 * The three questions this building actually asks are answered explicitly
 * rather than left to inference, because all three are about the flat number
 * and all three have the same answer: **register each child separately, and the
 * flat number is not an identity.** Siblings share a flat. Tenants change. A
 * flat that has had four families in it over the years is normal here, and none
 * of them is a duplicate of another.
 */
export default async function HowToJoinPage() {
  const branding = await getBrandingSafe();

  let settings: Awaited<ReturnType<typeof getCurrentLibrary>>["settings"] | null = null;
  try {
    settings = (await getCurrentLibrary()).settings;
  } catch {
    settings = null;
  }

  const ages = settings ? `${settings.ageMin} to ${settings.ageMax}` : null;
  const confirmsEmail = settings
    ? settings.requiredGuardianVerification !== "SELF_DECLARED"
    : false;

  /*
   * A real sequence, so it is numbered. The steps that are somebody else's turn
   * say so in their own words -- `waiting` is what separates "nothing is
   * happening" from "nothing is wrong".
   */
  const steps: { title: string; body: string; waiting?: boolean }[] = [
    {
      title: "Fill in the joining form",
      body: "It asks for your child's name and the year they were born — not their full birthday — your flat number, and your name, email and phone. It takes about two minutes, and you will need to agree on your child's behalf before we can create the account.",
    },
    ...(confirmsEmail
      ? [
          {
            title: "Confirm your email address",
            body: "We send you a message straight away with a link in it. Open the link to tell us the address really is yours. Nothing moves until you do, so if it has not arrived, look in your spam folder.",
          },
        ]
      : []),
    {
      title: "A librarian reads it",
      body: "One of your neighbours looks at the registration and approves it. They are volunteers with day jobs, so this is usually the same day but can take a little longer at a weekend.",
      waiting: true,
    },
    {
      title: "Choose a password",
      body: "Once it is approved we email you a link to set up the account. That link works once and expires, so use it when you have a minute rather than saving it for later. You choose the password — nobody at the library ever sees it.",
    },
    {
      title: "Come and borrow a book",
      body: settings
        ? `Sign in to see what is on the shelves, and the times the library room is open that week. Books are borrowed in person: find one you like, then ask the librarian in the room to issue it. ${visitVenueSentence(settings.venueAddress ?? settings.venueName)}`
        : "Sign in to see what is on the shelves. Books are borrowed in person: find one you like, then ask the librarian in the room to issue it. The shelf is real, and so is the librarian.",
    },
  ];

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <PageHeading title="How to join">
          Every child in the building can have a card, and it costs nothing. Here is exactly what
          happens, from the form to the first book.
        </PageHeading>

        {ages ? (
          <Callout tone="info" className="mt-8">
            {/*
              Who may join, before how to join. A family who is not eligible
              should find that out here rather than after filling in a form and
              waiting two days for somebody to tell them — and a renting family
              should not have to ask, which is why the answer names them.
            */}
            {settings?.eligibilityNote ? <>{settings.eligibilityNote} </> : null}
            It is for children aged {ages}. A parent or guardian fills the form in — not the child.
          </Callout>
        ) : null}

        <section className="mt-12" aria-labelledby="steps-heading">
          <h2 id="steps-heading" className="garden-rule inline-block text-3xl">
            Five minutes, then a short wait
          </h2>

          <ol className="mt-9 flex flex-col gap-5">
            {steps.map((step, index) => (
              <li key={step.title} className="list-none">
                <Card tone={step.waiting ? "sunk" : "plain"}>
                  <div className="flex gap-4 sm:gap-5">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-lg font-bold text-white"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-xl">{step.title}</h3>
                      <p className="mt-2 text-lg text-ink-soft">{step.body}</p>
                      {step.waiting ? (
                        <p className="mt-2.5 text-base font-bold text-accent-ink">
                          This one is our turn. Nothing is wrong if it takes a day.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>

          <p className="mt-9">
            <ButtonLink href="/join" size="lg" icon={<Icon name="sparkle" />}>
              Start the joining form
            </ButtonLink>
          </p>
        </section>

        <section className="mt-16" aria-labelledby="flats-heading">
          <h2 id="flats-heading" className="garden-rule inline-block text-3xl">
            About flats
          </h2>
          <p className="mt-9 max-w-2xl text-lg text-ink-soft">
            Flats here hold families, and families change. None of the following is a problem, and
            none of it needs a librarian to fix anything.
          </p>

          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <Card>
              <CardTitle icon={<Icon name="reader" />} as="h3">
                Two children, one flat
              </CardTitle>
              <CardBody>
                Fill the form in once for each child, using the same flat number and the same email
                both times. Each child gets their own card and their own books. They are not
                duplicates of one another, and the second one will not be rejected.
              </CardBody>
            </Card>

            <Card>
              <CardTitle icon={<Icon name="home" />} as="h3">
                New to the flat
              </CardTitle>
              <CardBody>
                Register exactly as anybody else would, even if the family who lived here before you
                used the library. A flat number is an address, not an account, and it is normal for
                the same one to appear more than once over the years.
              </CardBody>
            </Card>

            <Card>
              <CardTitle icon={<Icon name="info" />} as="h3">
                Write the flat the way you say it
              </CardTitle>
              <CardBody>
                Letters, numbers and dashes — P-15, A-102 or B12 are all fine. It is how the
                librarian finds you, so use the form your neighbours would recognise.
              </CardBody>
            </Card>

            <Card>
              <CardTitle icon={<Icon name="refresh" />} as="h3">
                Sent it twice by mistake
              </CardTitle>
              <CardBody>
                Nothing breaks. A second form for a child who is already in the queue is quietly
                ignored, so you will not end up with two cards and the librarian will not see the
                same child twice.
              </CardBody>
            </Card>
          </div>
        </section>

        <section className="mt-16" aria-labelledby="help-heading">
          <h2 id="help-heading" className="garden-rule inline-block text-3xl">
            If something goes wrong
          </h2>

          <div className="mt-9 flex flex-col gap-5">
            <Card tone="shelf">
              <CardTitle icon={<Icon name="mail" />} as="h3">
                The email has not arrived
              </CardTitle>
              <CardBody>
                Look in spam first — that is where it usually is. If it is genuinely not there,
                message us and we will send it again or hand you the link another way. Do not fill
                the form in a second time; it will not help.
              </CardBody>
            </Card>

            <WhatsAppHelp
              phone={branding.contactPhone}
              heading="Ask us on WhatsApp"
              lead="If any of this has gone wrong, or you would rather somebody just did it with you, send a message. Tell us your flat number and your child's name and we will take it from there."
            />

            {branding.contactEmail ? (
              <p className="text-lg text-ink-soft">
                You can also write to{" "}
                <a href={`mailto:${branding.contactEmail}`} className="font-bold text-primary-deep">
                  {branding.contactEmail}
                </a>
                .
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
