import type { Metadata } from "next";

import { JoinForm } from "@/app/join/join-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { eligibleBirthYears } from "@/lib/birth-year";
import { formatInTimezone } from "@/lib/dates";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Icon } from "@/components/ui/icon";
import { Butterfly } from "@/components/library/library-logo";

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
      <div className="relative mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-10 opacity-60 sm:w-12" />

        <h1 className="garden-rule inline-block text-4xl">Join {branding.libraryName}</h1>
        <p className="mt-8 text-lg text-ink-soft">
          Let&rsquo;s create your library account! It takes a minute, and a grown-up needs to fill
          it in.
        </p>

        {ages ? (
          <div className="mt-10">
            <JoinForm
              ageMin={ages.ageMin}
              ageMax={ages.ageMax}
              birthYears={ages.birthYears}
              libraryName={branding.libraryName}
            />
          </div>
        ) : (
          <Callout tone="warn" title="Not ready yet" className="mt-8">
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
      </div>
    </PublicShell>
  );
}
