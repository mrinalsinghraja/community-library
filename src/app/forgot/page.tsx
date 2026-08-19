import type { Metadata } from "next";

import { ForgotForm } from "@/app/forgot/forgot-form";
import { PublicShell } from "@/components/layout/site-shell";
import { Card } from "@/components/ui/card";
import { formatCode } from "@/server/lib/codes";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { Butterfly } from "@/components/library/library-logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgotten secret word" };

export default async function ForgotPage() {
  const branding = await getBrandingSafe();

  let cardExample: string | undefined;
  try {
    const { settings } = await getCurrentLibrary();
    cardExample = formatCode(settings.memberCodePrefix, 42, settings.memberCodePadding);
  } catch {
    cardExample = undefined;
  }

  return (
    <PublicShell branding={branding}>
      <div className="relative mx-auto w-full max-w-xl px-5 py-14 sm:px-8">
        <Butterfly className="drift pointer-events-none absolute right-4 top-8 w-9 opacity-60 sm:w-12" />

        <h1 className="garden-rule inline-block text-4xl">Forgotten your secret word?</h1>
        <p className="mt-8 text-lg text-ink-soft">
          That happens to everyone. Tell us your library card number and we will email your parent
          or guardian a link to set a new one.
        </p>

        <Card className="mt-8">
          <ForgotForm cardExample={cardExample} />
        </Card>

        <p className="mt-6 text-base text-ink-soft">
          The link goes to the grown-up&rsquo;s email address we have on file — never to anyone
          else. If that address has changed, please ask the librarian to update it.
        </p>
      </div>
    </PublicShell>
  );
}
