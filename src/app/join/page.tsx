import type { Metadata } from "next";

import { JoinForm } from "@/app/join/join-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

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

  let ages: { ageMin: number; ageMax: number } | null = null;
  try {
    const { settings } = await getCurrentLibrary();
    ages = { ageMin: settings.ageMin, ageMax: settings.ageMax };
  } catch {
    ages = null;
  }

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
        <h1 className="text-4xl">Join {branding.libraryName}</h1>
        <p className="mt-4 text-lg text-ink-soft">
          Let&rsquo;s create your library account! It takes a minute, and a grown-up needs to fill
          it in.
        </p>

        {ages ? (
          <div className="mt-10">
            <JoinForm
              ageMin={ages.ageMin}
              ageMax={ages.ageMax}
              libraryName={branding.libraryName}
            />
          </div>
        ) : (
          <Callout tone="warn" title="Not ready yet" className="mt-8">
            The library has not been set up, so registrations cannot be accepted.
          </Callout>
        )}

        <Card tone="primary" className="mt-12">
          <CardTitle icon="🤝">Our promises</CardTitle>
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
