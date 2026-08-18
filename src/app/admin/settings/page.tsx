import type { Metadata } from "next";

import {
  LibrarySettingsForm,
  ReminderSwitch,
  UnavailableFeatures,
  VerificationForm,
} from "@/app/admin/settings/settings-forms";
import { StaffShell } from "@/components/layout/staff-shell";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe } from "@/server/lib/settings";
import {
  getAdminSettings,
  SELECTABLE_VERIFICATION_STRENGTHS,
} from "@/server/services/settings-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

/**
 * How this library works.
 *
 * Everything on this page was, until now, a hand-written UPDATE against a
 * production database holding children's records. The page guard is politeness;
 * the service behind every form calls `requirePermission` itself.
 */
export default async function SettingsPage() {
  const actor = await requirePermissionForPage("settings.view", {
    signedOutTo: "/login?next=/admin/settings",
  });
  const branding = await getBrandingSafe();
  const view = await getAdminSettings();

  return (
    <StaffShell branding={branding} actor={actor} title="Settings">
      <div className="flex flex-col gap-6">
        <p className="max-w-2xl text-lg text-ink-soft">
          These are the library&rsquo;s own rules. Changing one decides what happens next — never
          what already happened.
        </p>

        <LibrarySettingsForm
          libraryName={view.libraryName}
          settings={{
            timezone: view.settings.timezone,
            dateFormat: view.settings.dateFormat,
            borrowingPeriodDays: view.settings.borrowingPeriodDays,
            maxActiveLoans: view.settings.maxActiveLoans,
            maxRenewals: view.settings.maxRenewals,
            renewalPeriodDays: view.settings.renewalPeriodDays,
            ageMin: view.settings.ageMin,
            ageMax: view.settings.ageMax,
            memberCodePrefix: view.settings.memberCodePrefix,
            copyCodePrefix: view.settings.copyCodePrefix,
            catalogueVisibility: view.settings.catalogueVisibility,
          }}
        />

        <VerificationForm
          current={view.settings.requiredGuardianVerification}
          selectable={SELECTABLE_VERIFICATION_STRENGTHS}
          version={view.consentVersion}
        />

        <ReminderSwitch enabled={view.reminders.enabled} canEnable={view.reminders.canEnable} />

        <UnavailableFeatures />
      </div>
    </StaffShell>
  );
}
