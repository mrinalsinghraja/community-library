import type { Metadata } from "next";

import { PublicShell } from "@/components/layout/site-shell";
import { LegalPage } from "@/components/library/legal-page";
import { termsDocument } from "@/lib/legal";
import { getBrandingSafe } from "@/server/lib/settings";

export const metadata: Metadata = { title: "Terms of use" };

/**
 * Rendered per request, because every name, room and contact address in the
 * text comes from library settings. An administrator changing the contact email
 * changes this page too, rather than leaving a second stale copy of it for a
 * family to find on the day they need it.
 */
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const branding = await getBrandingSafe();

  return (
    <PublicShell branding={branding}>
      <LegalPage
        document={termsDocument({
          libraryName: branding.libraryName,
          communityName: branding.communityName,
          venueAddress: branding.venueAddress,
          contactEmail: branding.contactEmail,
        })}
      />
    </PublicShell>
  );
}
