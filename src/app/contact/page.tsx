import type { Metadata } from "next";
import Link from "next/link";

import { PageHeading, PublicShell } from "@/components/layout/site-shell";
import { WhatsAppHelp } from "@/components/library/whatsapp-help";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { visitVenueSentence } from "@/lib/visits";
import { getBrandingSafe } from "@/server/lib/settings";

export const metadata: Metadata = { title: "Contact us" };

/** Every address and phone number below is library configuration, never a literal. */
export const dynamic = "force-dynamic";

/**
 * How to reach a person.
 *
 * The library's contact details were reachable before this page existed, but
 * only from the foot of every page, in small type, next to a sentence about
 * donations. Somebody with a problem — a reset link that never arrived, a book
 * they cannot find, a child who has grown out of the library — was expected to
 * find them there.
 *
 * Ordered by how fast an answer comes back, not by how formal the channel is:
 * the room first, because a librarian standing in front of you settles most of
 * these in a sentence.
 */
export default async function ContactPage() {
  const branding = await getBrandingSafe();

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <PageHeading eyebrow="Ask a person" title="Contact us">
          Everyone here is a neighbour and a volunteer, so please allow a little time for a reply.
        </PageHeading>

        <div className="mt-10 flex flex-col gap-6">
          <Card tone="shelf">
            <CardTitle icon={<Icon name="home" />}>Come and find us</CardTitle>
            <CardBody>
              <p className="font-bold text-ink">{branding.venueAddress}</p>
              <p className="mt-3">{visitVenueSentence(branding.venueName)}</p>
              <p className="mt-3">
                The days and times the room is open are on{" "}
                <Link href="/my-books#visit-times" className="font-bold text-primary-deep">
                  your own page
                </Link>{" "}
                once you have signed in.
              </p>
            </CardBody>
          </Card>

          {branding.contactEmail ? (
            <Card tone="shelf">
              <CardTitle icon={<Icon name="mail" />}>Email</CardTitle>
              <CardBody>
                <p>
                  <a
                    href={`mailto:${branding.contactEmail}`}
                    className="font-bold text-primary-deep"
                  >
                    {branding.contactEmail}
                  </a>
                </p>
                <p className="mt-3">
                  Best for anything that needs a record: correcting a child&rsquo;s details, asking
                  what we hold about them, or telling us a family is leaving the building.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {/*
            The same prefilled message as the home page and the joining guide,
            from the same helper — a parent who lands here still stuck gets the
            identical door rather than a second, slightly different one.
          */}
          <WhatsAppHelp
            phone={branding.contactPhone}
            heading="Message us"
            lead="Quickest for a small question — where a book is, or how to sign up a second child."
          />

          <Card tone="shelf">
            <CardTitle icon={<Icon name="key" />}>About a child&rsquo;s information</CardTitle>
            <CardBody>
              <p>
                To see what the library holds about your child, to correct it, or to ask for an
                account to be closed, write to us or speak to a librarian. Our{" "}
                <Link href="/privacy" className="font-bold text-primary-deep">
                  privacy notice
                </Link>{" "}
                sets out exactly what is kept and for how long.
              </p>
              <p className="mt-3">
                A reader can also propose corrections to their own details from their own page — a
                librarian checks each one before anything changes.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
