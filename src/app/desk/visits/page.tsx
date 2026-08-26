import type { Metadata } from "next";

import { CancelSlot } from "@/app/desk/visits/cancel-slot";
import { VisitForm } from "@/app/desk/visits/visit-form";
import { DataTable, StaffShell } from "@/components/layout/staff-shell";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Callout, EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  VISIT_HORIZON_DAYS,
  addDays,
  formatDayLabel,
  formatSlotRange,
  fromIsoDate,
  schedulableDates,
  toIsoDate,
} from "@/lib/visits";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listUpcomingVisitSlots } from "@/server/services/visit-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visiting times" };

/**
 * When the library room is open.
 *
 * Guarded by `visit.manage` — Librarian and Super Admin both, because the
 * person who will be standing behind the desk is the person who should be able
 * to say when. **Cancelling is a different key.** `visit.cancel` is the Super
 * Admin's alone and the button is not rendered without it; the service checks
 * again regardless, so a forged form changes nothing.
 *
 * Only what is still ahead is listed. A librarian setting up next month does
 * not need a scroll of every Saturday since the library opened, and "what did
 * we say in September" is a question for the audit log.
 */
export default async function DeskVisitsPage() {
  const actor = await requirePermissionForPage("visit.manage", {
    signedOutTo: "/login?next=/desk/visits",
  });
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  const { slots, today } = await listUpcomingVisitSlots();
  const canCancel = actor.permissions.has("visit.cancel");

  const todayDate = fromIsoDate(today) ?? new Date();
  const dates = schedulableDates(todayDate).map((date) => ({
    value: toIsoDate(date),
    label: formatDayLabel(date),
  }));

  const open = slots.filter((slot) => slot.status === "OPEN");

  return (
    <StaffShell branding={branding} actor={actor} title="Visiting times">
      <p className="text-base text-ink-soft">
        {open.length === 0
          ? "No visiting times are up. Readers are told the librarian has not set any yet."
          : open.length === 1
            ? "One visiting time is up for readers."
            : `${open.length} visiting times are up for readers.`}
      </p>

      <Callout tone="info" title="What readers see" className="mt-5">
        Every time you put up appears on each reader&rsquo;s own page, a week at a time, with a
        button to look at the weeks after it. They are told to come to{" "}
        <strong>{settings.venueAddress ?? settings.venueName}</strong> at one of these times to
        collect a book or bring one back.
        {canCancel ? (
          <> A cancelled time stays on their page, crossed out, so nobody arrives to a locked door.</>
        ) : null}
      </Callout>

      <Card className="mt-6">
        <CardTitle icon={<Icon name="calendar" />}>Put up a time</CardTitle>
        <CardBody>
          <p className="mb-5 text-base text-ink-soft">
            Up to {formatDayLabel(addDays(todayDate, VISIT_HORIZON_DAYS - 1))} — about three months
            ahead. Putting the same day up twice adds nothing, so it is safe to correct a stretch of
            dates by entering it again.
          </p>
          <VisitForm dates={dates} />
        </CardBody>
      </Card>

      <h2 className="mt-10 text-2xl">What is up</h2>

      <div className="mt-4">
        {slots.length === 0 ? (
          <EmptyState illustration={<Icon name="calendar" />} title="Nothing up yet">
            Set a time above and readers will see it on their own page straight away.
          </EmptyState>
        ) : (
          <DataTable headers={["Day", "Time", "Note", "", ""]}>
            {slots.map((slot) => {
              const date = fromIsoDate(slot.date);
              const dayLabel = date ? formatDayLabel(date) : slot.date;
              const timeLabel = formatSlotRange(slot.startMinute, slot.endMinute);

              return (
                <tr key={slot.id} className="border-t-2 border-hairline align-top">
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-bold text-ink">
                    {dayLabel}
                    {slot.date === today ? (
                      <span className="ms-2 text-sm font-semibold text-accent-ink">Today</span>
                    ) : null}
                  </td>

                  <td className="whitespace-nowrap px-3.5 py-2.5 text-base text-ink">
                    {timeLabel}
                  </td>

                  <td className="max-w-xs px-3.5 py-2.5 text-base text-ink-soft">
                    {slot.status === "CANCELLED"
                      ? (slot.cancelledReason ?? "No reason given")
                      : (slot.note ?? "—")}
                  </td>

                  <td className="px-3.5 py-2.5">
                    {slot.status === "CANCELLED" ? (
                      <StatusBadge tone="neutral">
                        <Icon name="cross" /> Cancelled
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="available">
                        <Icon name="check" /> Up
                      </StatusBadge>
                    )}
                  </td>

                  <td className="px-3.5 py-2.5">
                    {slot.status === "OPEN" && canCancel ? (
                      <CancelSlot slotId={slot.id} label={`${dayLabel}, ${timeLabel}`} />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </div>
    </StaffShell>
  );
}
