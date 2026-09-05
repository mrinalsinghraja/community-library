import type { Metadata } from "next";

import { ForgotForm } from "@/app/forgot/forgot-form";
import { AuthRoom } from "@/components/layout/auth-room";
import { PublicShell } from "@/components/layout/site-shell";
import { formatCode } from "@/server/lib/codes";
import { getActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getOwnMemberCard } from "@/server/services/account-service";

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
      <AuthRoom
        branding={branding}
        title="Forgotten your password?"
        lede="That happens to everyone. Tell us the number on your library card and we will email your parent or guardian a link to set a new one."
        panelHeading="It happens to everyone."
        panelLede="A new link goes to the grown-up's email we already have. Nothing about your account changes until they use it."
        footer={
          <p>
            The link goes to the guardian&rsquo;s email address we have on file — never to anyone
            else. If that address has changed, please ask the librarian to update it.
          </p>
        }
      >
        <ForgotForm cardExample={cardExample} defaultIdentifier={ownCard ?? undefined} />
      </AuthRoom>
    </PublicShell>
  );
}
