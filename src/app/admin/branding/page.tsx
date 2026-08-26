import type { Metadata } from "next";

import { BrandingForm, LogoForm } from "@/app/admin/branding/branding-forms";
import { StaffShell } from "@/components/layout/staff-shell";
import { LibraryLogo } from "@/components/library/library-logo";
import { Card } from "@/components/ui/card";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe } from "@/server/lib/settings";
import { getAdminSettings } from "@/server/services/settings-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Branding" };

/**
 * What the library is called and what it looks like.
 *
 * Guarded by `branding.edit` — the page needs `settings.view` too, because it
 * reads the configuration row, and in this version both belong to the same
 * person. The services behind the forms each check their own permission.
 */
export default async function BrandingPage() {
  const actor = await requirePermissionForPage("branding.edit", {
    signedOutTo: "/login?next=/admin/branding",
  });
  const branding = await getBrandingSafe();
  const view = await getAdminSettings();
  const settings = view.settings;

  return (
    <StaffShell branding={branding} actor={actor} title="Branding">
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <BrandingForm
            values={{
              primaryColor: settings.primaryColor,
              welcomeMessage: settings.welcomeMessage ?? "",
              rulesMarkdown: settings.rulesMarkdown ?? "",
              donationPolicyMarkdown: settings.donationPolicyMarkdown ?? "",
              contactEmail: settings.contactEmail ?? "",
              contactPhone: settings.contactPhone ?? "",
              venueName: settings.venueName,
              venueAddress: settings.venueAddress ?? "",
              eligibilityNote: settings.eligibilityNote ?? "",
            }}
          />

          <LogoForm hasLogo={Boolean(settings.logoUrl)} />
        </div>

        {/*
          The preview is the saved state, not a live one. A preview that updates
          as you type is a nice trick and a lie: what matters is what a child
          will see, which is what is in the row.
        */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <h2 className="text-2xl">How children will see it</h2>

            <div
              className="mt-5 rounded-2xl bg-ground p-6 text-center"
              style={{ ["--brand-primary" as string]: settings.primaryColor }}
            >
              <div className="flex justify-center">
                <LibraryLogo
                  logoUrl={settings.logoUrl}
                  libraryName={view.libraryName}
                  size={72}
                />
              </div>
              <p className="mt-4 font-display text-2xl font-semibold text-ink">
                {view.libraryName}
              </p>
              <p className="mt-2 text-lg text-ink-soft">
                {settings.welcomeMessage ?? `Welcome to ${view.libraryName} 📚`}
              </p>
            </div>

            <p className="mt-4 text-base text-ink-soft">
              The library&rsquo;s name is changed on the{" "}
              <a href="/admin/settings">Settings</a> page.
            </p>
          </Card>
        </aside>
      </div>
    </StaffShell>
  );
}
