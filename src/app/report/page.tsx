import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ReportView } from "@/app/report/report-view";
import { reportSignIn, reportSignOut } from "@/app/report/actions";
import {
  REPORT_COOKIE,
  reportIsConfigured,
  reportTokenIsValid,
} from "@/server/lib/report-auth";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getUsageReport } from "@/server/services/usage-service";
import { FEATURE_LABELS, countryName, indiaStateName, type UsageFeature } from "@/lib/usage";

/**
 * Usage report: what is used, from where, and how often (ADR-077).
 *
 * Behind a shared password, never indexed, never linked from anywhere. Every
 * figure is an anonymous count; there is nobody in it to look up.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Usage report",
  robots: { index: false, follow: false },
};

const NOTICES: Record<string, string> = {
  "1": "That password is not right.",
  wait: "Too many tries. Please wait fifteen minutes.",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const branding = await getBrandingSafe();
  const jar = await cookies();
  const signedIn = reportTokenIsValid(jar.get(REPORT_COOKIE)?.value);

  if (!signedIn) {
    const { e } = await searchParams;
    const configured = reportIsConfigured();
    return (
      <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-4 py-10">
        <h1 className="font-display text-3xl">Usage report</h1>
        {configured ? (
          <form action={reportSignIn} className="flex flex-col gap-3">
            <label htmlFor="password" className="text-sm font-semibold">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="min-h-11 rounded-xl border-2 border-black/30 bg-white px-3"
            />
            {e && NOTICES[e] ? (
              <p role="alert" className="text-sm font-semibold text-red-700">
                {NOTICES[e]}
              </p>
            ) : null}
            <button
              type="submit"
              className="min-h-11 rounded-xl px-4 font-semibold text-white"
              style={{ background: branding.primaryColor }}
            >
              Open the report
            </button>
          </form>
        ) : (
          <p>This page is switched off until a password is set.</p>
        )}
      </main>
    );
  }

  const { library, settings } = await getCurrentLibrary();
  const report = await getUsageReport(library.id, settings.timezone);

  // Names are put on here, on the server, so the browser never needs the tables.
  const label = (rows: typeof report.features, name: (k: string) => string) =>
    rows.map((r) => ({ ...r, name: name(r.key) }));

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Usage report</h1>
          <p className="text-sm opacity-75">
            {branding.libraryName} · last 90 days · all figures are anonymous counts
          </p>
        </div>
        <form action={reportSignOut}>
          <button type="submit" className="min-h-11 rounded-xl border-2 border-black/30 px-4 font-semibold">
            Sign out
          </button>
        </form>
      </header>
      <ReportView
        color={branding.primaryColor}
        report={{
          ...report,
          features: label(report.features, (k) => FEATURE_LABELS[k as UsageFeature] ?? k),
          countries: label(report.countries, countryName),
          states: label(report.states, indiaStateName),
          cities: label(report.cities, (k) => k || "Unknown city").map((c) => ({
            ...c,
            group: indiaStateName(c.group),
          })),
        }}
      />
    </main>
  );
}
