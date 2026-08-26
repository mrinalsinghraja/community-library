import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DORMANT_PERMISSIONS, PERMISSIONS, permissionsForRole } from "@/lib/permissions";
import { PERIOD_REPORT_KEYS, REPORT_KEYS } from "@/lib/reports";

/**
 * That every report is actually reachable, and offered to the two roles the
 * library runs on.
 *
 * Source-level assertions, because what is being checked is wiring: that a
 * screen was not left out, that the control is gated on the permission rather
 * than on a role name, and that nobody re-implemented authorization inside the
 * report registry instead of calling the service that already owns the data.
 * A rendering test would prove a component renders; it would not notice the
 * seventh screen quietly missing.
 *
 * There are two kinds of report and each has its own rule. A **listing** report
 * is exported from a screen somebody is already looking at, so it must carry the
 * tick-box toolbar. A **period** report is asked about a stretch of time and has
 * nothing to tick, so it lives on `/desk/reports` instead. Between them they
 * must account for every key in the catalogue — that is the assertion that
 * notices a report added to the catalogue and wired to nothing.
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
  it("accounts for every report the catalogue declares", () => {
    const wired = [...SCREENS.map((screen) => screen.report), ...PERIOD_REPORT_KEYS];

    expect(wired.sort()).toEqual([...REPORT_KEYS].sort());
  });

  it("keeps the two kinds apart, so neither rule is applied to the wrong report", () => {
    for (const screen of SCREENS) {
      expect(PERIOD_REPORT_KEYS).not.toContain(screen.report);
    }
  });

  it.each(SCREENS)("$report is wired into $path", ({ path, report }) => {
    const source = read(path);

    expect(source).toContain("@/components/desk/selection-toolbar");
    expect(source).toContain(`report="${report}"`);
    expect(source).toContain("<SelectionCheckbox");
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

/**
 * The period reports.
 *
 * They are held to a different rule than the listings — one screen, one date
 * range, no tick boxes — but to the same two guarantees: the control is gated on
 * the permission rather than a role name, and the dates are resolved in the
 * library's own timezone rather than in UTC.
 */
describe("the period reports", () => {
  const page = read("src/app/desk/reports/page.tsx");
  const registry = read("src/server/reports/registry.ts");
  const nav = read("src/lib/desk-nav.ts");

  it("all live on one screen", () => {
    for (const key of PERIOD_REPORT_KEYS) {
      expect(page).toContain("PERIOD_REPORT_KEYS");
    }
    expect(page).toContain("@/app/desk/reports/period-download");
  });

  it("gates the screen on the permission rather than a role name", () => {
    expect(page).toContain('requirePermissionForPage("report.view"');
    expect(page).not.toContain("SUPER_ADMIN");
    expect(page).not.toContain("LIBRARIAN");
  });

  it("is reachable from the desk by anybody holding the permission", () => {
    expect(nav).toContain('href: "/desk/reports"');
    expect(nav).toContain('permission: "report.view"');
  });

  it("resolves the period in the library's timezone, not UTC", () => {
    for (const source of [page, registry]) {
      expect(source).toContain("dateOnlyInTimezone");
      expect(source).toContain("settings.timezone");
    }
    expect(registry).not.toMatch(/new Date\(filter\.(from|to)/);
  });

  it("does not rank readers by how much they read", () => {
    const service = read("src/server/services/circulation-reports-service.ts");

    // The reader query orders by name. Ordering it by a count would turn a
    // children's library into a league table, which is the one thing this
    // report must never become.
    const readerQuery = service.slice(
      service.indexOf("listReaderActivity"),
      service.indexOf("listBookActivity"),
    );
    expect(readerQuery).toContain("ORDER BY lower(u.display_name) ASC");
    expect(readerQuery).not.toMatch(/ORDER BY[^;]*borrowed DESC/);
    expect(readerQuery).not.toMatch(/ORDER BY[^;]*count\(\*\) DESC/);
  });

  it("reads nothing without the desk permissions, and names nobody without member.view", () => {
    const service = read("src/server/services/circulation-reports-service.ts");

    expect(service).toContain("requireAnyPermission(CIRCULATION_DESK)");
    expect(service).toContain('requirePermission("member.view")');
  });

  it("never writes, because a report is a question", () => {
    const service = read("src/server/services/circulation-reports-service.ts");

    for (const forbidden of ["$executeRaw", "prisma.loan.update", "prisma.loan.create", "recordAudit"]) {
      expect(service).not.toContain(forbidden);
    }
  });
});
