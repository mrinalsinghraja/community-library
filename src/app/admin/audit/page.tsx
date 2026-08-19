import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { formatInTimezone } from "@/lib/dates";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listAuditEvents } from "@/server/services/audit-service";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit" };

/**
 * The library's own record of what was done, and by whom.
 *
 * Read-only in the strongest sense available: this page renders, and there is
 * no form, no action and no service anywhere in the application that edits or
 * deletes an audit row. The filters are a GET form, so a link to a filtered
 * view is shareable and nothing here needs client-side JavaScript.
 *
 * Details are shown for configuration changes only — those carry policy numbers.
 * Every other row's metadata belongs to a child, a family or a book, and an
 * operations screen is not the place to read it. See ADR-035.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermissionForPage("audit.view", {
    signedOutTo: "/login?next=/admin/audit",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const params = await searchParams;

  const single = (key: string): string | undefined => {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    return first && first.length > 0 ? first : undefined;
  };

  const filter = {
    from: single("from"),
    to: single("to"),
    action: single("action"),
    actor: single("actor"),
    entityType: single("entityType"),
    page: Number.parseInt(single("page") ?? "1", 10) || 1,
  };

  const result = await listAuditEvents(filter);

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filter, page })) {
      if (value !== undefined && value !== "" && key !== "page") query.set(key, String(value));
    }
    if (page > 1) query.set("page", String(page));
    const suffix = query.toString();
    return suffix ? `/admin/audit?${suffix}` : "/admin/audit";
  };

  return (
    <StaffShell branding={branding} actor={actor} title="Audit">
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="text-2xl">Find something</h2>

          <form method="get" className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="from" label="From">
              <TextInput id="from" name="from" type="date" defaultValue={filter.from ?? ""} />
            </Field>

            <Field id="to" label="To">
              <TextInput id="to" name="to" type="date" defaultValue={filter.to ?? ""} />
            </Field>

            <Field id="actor" label="Who">
              <TextInput id="actor" name="actor" defaultValue={filter.actor ?? ""} />
            </Field>

            <Field id="action" label="What happened">
              <Select id="action" name="action" defaultValue={filter.action ?? ""}>
                <option value="">Everything</option>
                {result.availableActions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="entityType" label="Kind of record">
              <Select id="entityType" name="entityType" defaultValue={filter.entityType ?? ""}>
                <option value="">Everything</option>
                {result.availableEntityTypes.map((entityType) => (
                  <option key={entityType} value={entityType}>
                    {entityType}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex items-end gap-3">
              <Button type="submit" size="md" icon={<Icon name="search" />}>
                Search
              </Button>
              <Link href="/admin/audit" className="text-base font-bold text-ink-soft">
                Clear
              </Link>
            </div>
          </form>
        </Card>

        <p className="text-base text-ink-soft">
          {result.total === 0
            ? "Nothing matches that."
            : `${result.total} record${result.total === 1 ? "" : "s"} · page ${result.page} of ${result.pageCount}`}
        </p>

        {result.entries.length > 0 ? (
          <DataTable headers={["When", "Who", "What happened", "Record", "Details"]}>
            {result.entries.map((entry) => (
              <tr key={entry.id} className="border-t-2 border-hairline align-top">
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatInTimezone(entry.occurredAt, settings.timezone, "d MMM yyyy HH:mm")}
                </td>
                <td className="px-4 py-3">{entry.actorLabel}</td>
                <td className="px-4 py-3 font-mono text-sm">{entry.action}</td>
                <td className="px-4 py-3 text-ink-soft">{entry.entityType}</td>
                <td className="px-4 py-3">
                  {entry.details ? (
                    <pre className="max-w-md overflow-x-auto text-sm text-ink-soft">
                      {JSON.stringify(entry.details, null, 1)}
                    </pre>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        ) : null}

        {result.pageCount > 1 ? (
          <nav aria-label="Pages" className="flex items-center gap-4">
            {result.page > 1 ? (
              <Link href={pageHref(result.page - 1)} className="font-bold">
                ← Newer
              </Link>
            ) : null}
            {result.page < result.pageCount ? (
              <Link href={pageHref(result.page + 1)} className="font-bold">
                Older →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </StaffShell>
  );
}
