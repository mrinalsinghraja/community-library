import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DORMANT_PERMISSIONS, PERMISSIONS, permissionsForRole } from "@/lib/permissions";
import { REPORT_KEYS } from "@/lib/reports";

/**
 * That every desk listing actually offers the export, and offers it to the two
 * roles the library runs on.
 *
 * Source-level assertions, because what is being checked is wiring: that a
 * screen was not left out, that the toolbar is gated on the permission rather
 * than on a role name, and that nobody re-implemented authorization inside the
 * report registry instead of calling the service that already owns the screen.
 * A rendering test would prove a component renders; it would not notice the
 * seventh screen quietly missing.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const SCREENS: Array<{ path: string; report: string }> = [
  { path: "src/app/admin/books/page.tsx", report: "books" },
  { path: "src/app/desk/members/page.tsx", report: "readers" },
  { path: "src/app/admin/staff/page.tsx", report: "staff" },
  { path: "src/app/desk/loans/page.tsx", report: "loans" },
  { path: "src/app/desk/requests/page.tsx", report: "borrow-requests" },
  { path: "src/app/desk/renewals/page.tsx", report: "renewal-requests" },
  { path: "src/app/desk/registrations/page.tsx", report: "registrations" },
  { path: "src/app/admin/audit/page.tsx", report: "audit" },
];

describe("every listing offers an export", () => {
  it("covers every report the catalogue declares", () => {
    expect(SCREENS.map((screen) => screen.report).sort()).toEqual([...REPORT_KEYS].sort());
  });

  it.each(SCREENS)("$report is wired into $path", ({ path, report }) => {
    const source = read(path);

    expect(source).toContain("@/components/reports/export-panel");
    expect(source).toContain(`report="${report}"`);
    expect(source).toContain("<ReportRowCheckbox");
  });

  it.each(SCREENS)("$report hides its toolbar on the permission, not a role name", ({ path }) => {
    const source = read(path);

    expect(source).toContain('canExport={actor.permissions.has("report.view")}');
    expect(source).not.toMatch(/canExport=\{[^}]*SUPER_ADMIN/);
  });
});

describe("the permission behind it", () => {
  it("is no longer dormant, because it now guards something", () => {
    expect(DORMANT_PERMISSIONS).not.toContain("report.view");
    expect(PERMISSIONS["report.view"].description).not.toContain("Not yet implemented");
  });

  it("is held by both roles that run the library", () => {
    expect(permissionsForRole("SUPER_ADMIN")).toContain("report.view");
    expect(permissionsForRole("LIBRARIAN")).toContain("report.view");
  });

  it("is not held by a reader", () => {
    expect(permissionsForRole("MEMBER")).not.toContain("report.view");
  });

  it("is not held by the child volunteer role", () => {
    expect(permissionsForRole("JUNIOR_LIBRARIAN")).not.toContain("report.view");
  });
});

describe("the registry does not reinvent authorization", () => {
  const registry = read("src/server/reports/registry.ts");

  it("loads every report through an existing list service", () => {
    // If a report ever reaches for the database directly, the permission and
    // the redaction that live in the service are silently bypassed.
    expect(registry).not.toContain("@/server/db");
    expect(registry).not.toContain("prisma.");
  });

  it("checks no permission of its own beyond narrowing columns", () => {
    expect(registry).not.toContain("requirePermission");
    expect(registry).not.toContain("requireAnyPermission");
  });

  it("reads the library's name from settings rather than writing one down", () => {
    const service = read("src/server/services/report-service.ts");
    expect(service).toContain("getCurrentLibrary");
    expect(service).toContain("library.name");
  });
});

describe("the download route", () => {
  const route = read("src/app/api/reports/[report]/route.ts");

  it("delegates authorization rather than deciding it", () => {
    expect(route).toContain("exportReport");
    expect(route).not.toContain("requirePermission");
  });

  it("refuses a cross-origin post, which an action would have refused for free", () => {
    expect(route).toContain("sec-fetch-site");
    expect(route).toContain("isSameOrigin");
  });

  it("sends the file as an attachment, never inline", () => {
    expect(route).toContain("attachment; filename=");
    expect(route).toContain("no-store");
  });

  it("is excluded from the page policy the proxy would otherwise impose", () => {
    expect(read("src/proxy.ts")).toContain("api/reports");
  });
});
