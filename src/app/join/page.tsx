import type { Metadata } from "next";

import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
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

/**
 * Phase 0 placeholder.
 *
 * The registration form and its approval queue are Phase 2 work. This page
 * exists so the front door is not a dead link, and so the promises the library
 * makes — free, voluntary, no conditions — are already stated in public.
 */
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
          {ages
            ? `Any child aged ${ages.ageMin} to ${ages.ageMax} living in ${branding.communityName} is welcome.`
            : `Every child in ${branding.communityName} is welcome.`}{" "}
          Membership is completely free, and it always will be.
        </p>

        <div className="mt-10">
          <EmptyState
            illustration="🚧"
            title="The sign-up form is being built"
            action={
              <ButtonLink href="/" size="lg">
                Back to the library
              </ButtonLink>
            }
          >
            Online registration opens with the next update. In the meantime, please have a word with
            the librarian at the library and they will set up a card for your child.
          </EmptyState>
        </div>

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
                We ask for as little information as we can: your child&rsquo;s name, their age, your
                flat, and one grown-up&rsquo;s contact details.
              </li>
              <li>
                A photo is optional — there are friendly avatars to choose from instead.
              </li>
              <li>
                We never show one child&rsquo;s details to another, and we never show what anyone
                has borrowed.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </PublicShell>
  );
}
