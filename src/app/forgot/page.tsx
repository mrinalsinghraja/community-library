import type { Metadata } from "next";

import { ForgotForm } from "@/app/forgot/forgot-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { formatCode } from "@/server/lib/codes";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnMemberCard } from "@/server/services/account-service";
import { Butterfly } from "@/components/library/library-logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgotten password" };

export default async function ForgotPage() {
  const branding = await getBrandingSafe();

  let cardExample: string | undefined;
  try {
    const { settings } = await getCurrentLibrary();
    cardExample = formatCode(settings.memberCodePrefix, 42, settings.memberCodePadding);
  } catch {
    cardExample = undefined;
  }

  /*
   * Somebody who is already signed in and pressed "Email me a reset link" on
   * their own account page. We know exactly whose card this is — asking them to
   * copy it back out of their pocket is how the original failure happened, and
   * it is their own number, so nothing is disclosed by filling it in.
   */
  const actor = await getActor();
  const ownCard = actor?.kind === "MEMBER" ? (await getOwnMemberCard())?.memberCode : undefined;

  return (
    <PublicShell branding={branding}>
      <div className="relative mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-9 opacity-60 sm:w-12" />

        <h1 className="garden-rule inline-block text-4xl">Forgotten your password?</h1>
        <p className="mt-8 text-lg text-ink-soft">
          That happens to everyone. Tell us the number on your library card and we will email your
          parent or guardian a link to set a new one.
        </p>

        <Card className="mt-8">
          <ForgotForm cardExample={cardExample} defaultIdentifier={ownCard ?? undefined} />
        </Card>

        <p className="mt-6 text-base text-ink-soft">
          The link goes to the guardian&rsquo;s email address we have on file — never to anyone
          else. If that address has changed, please ask the librarian to update it.
        </p>
      </div>
    </PublicShell>
  );
}
