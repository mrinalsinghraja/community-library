import type { Metadata } from "next";
import { headers } from "next/headers";

import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { getBrandingSafe } from "@/server/lib/settings";
import { completeEmailChallenge } from "@/server/services/guardian-verification-service";

/**
 * Guardian confirmation landing page.
 *
 * Reached only from the emailed link, and only when the library requires an
 * emailed confirmation. Opening it *is* the confirmation — there is nothing to
 * fill in, because everything we are checking has already happened: whoever
 * clicked can read the inbox that was given as the guardian's.
 *
 * Consuming on GET is a considered choice. Email clients that prefetch links
 * would spend the token, but the consequence of that here is a verification
 * recorded slightly early for an address we chose to write to, not an account
 * taken over. Weighed against a parent on a phone being asked to press a second
 * button they will not understand, the simpler flow wins.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm registration",
  // The token is in the path; this stops it leaking through Referer.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const branding = await getBrandingSafe();
  const headerList = await headers();
  const requestIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");

  const outcome = await completeEmailChallenge({ rawToken: token, requestIp });

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        {outcome.ok ? (
          <Card tone="primary" className="text-center">
            <p className="text-6xl" aria-hidden="true">
              ✅
            </p>
            <h1 className="mt-4 text-3xl">Thank you — that is confirmed</h1>
            <p className="mt-3 text-lg text-ink-soft">
              We now know this registration for {outcome.childName} came from you. Our librarian
              will take it from here and email you when the account is ready.
            </p>
            <p className="mt-3 text-base text-ink-soft">
              There is nothing else to do. Joining is free, and always will be.
            </p>
          </Card>
        ) : (
          <EmptyState
            illustration="🔗"
            title="This link is no longer active"
            action={
              <ButtonLink href="/" size="lg">
                Back to the library
              </ButtonLink>
            }
          >
            {/* One message for expired, spent, cancelled and never-real alike.
                Telling them apart would confirm which links exist. */}
            Confirmation links work once and do not last forever. Please have a word with the
            librarian and they will send a fresh one.
          </EmptyState>
        )}
      </div>
    </PublicShell>
  );
}
