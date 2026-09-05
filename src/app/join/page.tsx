import type { Metadata } from "next";

import { JoinForm } from "@/app/join/join-form";
import { AuthRoom } from "@/components/layout/auth-room";
import { PublicShell } from "@/components/layout/site-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { eligibleBirthYears } from "@/lib/birth-year";
import { formatInTimezone } from "@/lib/dates";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "Join the library" };

/**
 * Rendered per request, never prerendered.
 *
 * This page reads library configuration, and an administrator changing the
 * loan period or the age range must see it here immediately. Static
 * generation would bake the values in at build time and quietly serve stale
 * rules until the next deploy.
 */
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const branding = await getBrandingSafe();

  let ages: { ageMin: number; ageMax: number; birthYears: number[] } | null = null;
  try {
    const { settings } = await getCurrentLibrary();
    // The library's own year, not the browser's — the same clock the server
    // checks the answer against.
    const thisYear = Number(formatInTimezone(new Date(), settings.timezone, "yyyy"));
    ages = {
      ageMin: settings.ageMin,
      ageMax: settings.ageMax,
      birthYears: eligibleBirthYears(settings.ageMin, settings.ageMax, thisYear),
    };
  } catch {
    ages = null;
  }

  return (
    <PublicShell branding={branding}>
      {/*
        The room, stacked: this form is too long to sit beside the panel, so
        the panel is a band across the top and the form has the width.
      */}
      <AuthRoom
        branding={branding}
        stacked
        title={`Join ${branding.libraryName}`}
        lede="Let’s create your library account! It takes a minute, and a parent or guardian needs to fill it in."
        panelHeading="Every child in the building can have a card."
        panelLede="It costs nothing, and nothing on this form is ever shown to another family."
      >
        {ages ? (
          <JoinForm
            ageMin={ages.ageMin}
            ageMax={ages.ageMax}
            birthYears={ages.birthYears}
            libraryName={branding.libraryName}
          />
        ) : (
          <Callout tone="warn" title="Not ready yet">
            The library has not been set up, so registrations cannot be accepted.
          </Callout>
        )}

        <Card tone="primary" className="mt-12">
          <CardTitle icon={<Icon name="handshake" />}>Our promises</CardTitle>
          <CardBody>
            <ul className="flex flex-col gap-2">
              <li>Joining is free. There is no membership fee and no borrowing fee.</li>
              <li>
                Donating books is completely voluntary. It is never a condition of joining or
                borrowing.
              </li>
              <li>
                We ask for as little as we can, and we never show one family&rsquo;s details to
                another.
              </li>
              <li>
                Nobody at the library can see your child&rsquo;s password — not even the librarian.
              </li>
            </ul>
          </CardBody>
        </Card>
      </AuthRoom>
    </PublicShell>
  );
}
