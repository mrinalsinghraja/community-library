import type { Metadata } from "next";

import { PageHeading, PublicShell } from "@/components/layout/site-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "How it works" };

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
 * The library's rules, rendered from configuration.
 *
 * Every number on this page is read from library_settings. Changing the loan
 * period in the admin screen changes this page — there is no second copy of the
 * rules to fall out of step with the first.
 */
export default async function RulesPage() {
  const branding = await getBrandingSafe();

  let settings: Awaited<ReturnType<typeof getCurrentLibrary>>["settings"] | null = null;
  try {
    settings = (await getCurrentLibrary()).settings;
  } catch {
    settings = null;
  }

  return (
    <PublicShell branding={branding}>
      <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8">
        <PageHeading title="How our library works">
          Four things to know, and none of them are complicated.
        </PageHeading>

        {!settings ? (
          <Callout tone="warn" title="Not configured yet" className="mt-8">
            The library settings have not been created, so the rules cannot be shown.
          </Callout>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Card tone="shelf" className="lift">
              <CardTitle icon={<Icon name="reader" />}>Who can join</CardTitle>
              <CardBody>
                Readers aged {settings.ageMin} to {settings.ageMax} who live in{" "}
                {branding.communityName}. Joining is free, and no family ever has to donate a book
                to become a member.
              </CardBody>
            </Card>

            <Card tone="shelf" className="lift">
              <CardTitle icon={<Icon name="book" />}>Borrowing</CardTitle>
              <CardBody>
                You can have{" "}
                {settings.maxActiveLoans === 1
                  ? "one book"
                  : `${settings.maxActiveLoans} books`}{" "}
                at a time, for {settings.borrowingPeriodDays} days.{" "}
                {settings.maxRenewals > 0
                  ? `Still reading? You can ask to keep a book longer ${
                      settings.maxRenewals === 1 ? "once" : `${settings.maxRenewals} times`
                    }, for another ${settings.renewalPeriodDays} days each time.`
                  : "Please bring books back on time so the next reader can enjoy them."}
              </CardBody>
            </Card>

            <Card tone="shelf" className="lift">
              <CardTitle icon={<Icon name="home" />}>Bringing books back</CardTitle>
              <CardBody>
                There are no fines here, ever. If a book is late we will send a friendly reminder to
                your family — and if something happens to a book, just tell the librarian. Accidents
                are part of reading.
              </CardBody>
            </Card>

            <Card tone="shelf" className="lift">
              <CardTitle icon={<Icon name="gift" />}>Sharing books</CardTitle>
              <CardBody>
                Our shelves grow because families pass on books they have loved. If you would like to
                share one, the librarian will be glad to take it — and you can choose whether your
                name appears as the giver.
              </CardBody>
            </Card>

            {settings.rulesMarkdown ? (
              <Card className="md:col-span-2">
                <CardTitle icon={<Icon name="audit" />}>House rules</CardTitle>
                <CardBody>
                  <p className="whitespace-pre-line">{settings.rulesMarkdown}</p>
                </CardBody>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
