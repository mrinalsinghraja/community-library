import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import {
  VISIT_MESSAGES,
  formatDayLabel,
  formatSlotRange,
  fromIsoDate,
  weekWindow,
} from "@/lib/visits";
import type { VisitWeekView } from "@/server/services/visit-service";

/**
 * When to come to the library room, for the week a reader is looking at.
 *
 * Paged with links rather than a client component, and that is deliberate. The
 * week lives in the URL, so "next week" is a real page a child can bookmark,
 * send to a parent, go back from, and open with the keyboard — none of which a
 * `useState` counter gives them, and all of which a family arranging a Saturday
 * actually uses. It also means the card has no loading state to design.
 *
 * **A cancelled time is drawn, not deleted.** Struck through, badged, and
 * carrying whatever the desk said about it. A card that simply stopped showing
 * a cancelled Saturday would look exactly like a card that never had one, and a
 * family who had already read it would learn nothing and turn up anyway.
 */
export function VisitTimes({
  week,
  venueName,
  className,
}: {
  week: VisitWeekView;
  /** From library settings. The room's name is configuration, never a literal. */
  venueName: string;
  className?: string;
}) {
  const days = groupByDay(week);

  /*
   * The arrows are named after the week they lead to, not "next" and
   * "previous".
   *
   * They used to say "Next week →" on every view, which read fine on the
   * current week and absurdly on the one after it: the heading said "Next week"
   * and the button beside it said "Next week" meaning a different week
   * entirely. Naming the destination is both clearer and one fewer thing to
   * work out.
   */
  const today = fromIsoDate(week.today);
  const backLabel = today ? weekWindow(week.offset - 1, today).label : VISIT_MESSAGES.previous;
  const forwardLabel = today ? weekWindow(week.offset + 1, today).label : VISIT_MESSAGES.next;

  return (
    <Card tone="shelf" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col">
        <h2 className="garden-rule inline-block self-start text-xl">{VISIT_MESSAGES.heading}</h2>
        <p className="mt-4 text-base text-ink-soft">
          Come to the {venueName} at one of these times to collect a book or bring one back. A
          librarian will be there to help you.
        </p>
      </div>

      {/*
        The week being shown on its own line, the two ways out beneath it.
        
        All three side by side is what a wide screen wants and what a phone
        cannot have: three week names in one row at 375px wrapped every label
        onto two lines and left the reader working out which of three
        near-identical phrases was the heading. Stacking costs one line and
        makes the question — which week am I looking at — answerable at a
        glance on the screen most of them are actually using.
      */}
      <div className="border-y border-hairline py-2">
        <p className="text-center text-base font-bold text-ink">{week.label}</p>

        <div className="flex items-center justify-between gap-2">
          {week.offset > 0 ? (
            <Link
              href={weekHref(week.offset - 1)}
              className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-field)] px-2 text-base font-semibold text-primary-deep"
            >
              <span aria-hidden="true">←</span>
              {backLabel}
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}

          {week.hasNext ? (
            <Link
              href={weekHref(week.offset + 1)}
              className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-field)] px-2 text-base font-semibold text-primary-deep"
            >
              {forwardLabel}
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      </div>

      {days.length === 0 ? (
        <p className="text-base text-ink-soft">
          {week.everScheduled ? VISIT_MESSAGES.none : VISIT_MESSAGES.noneEver}
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {days.map((day) => (
            <li key={day.date} className="flex flex-col gap-1.5">
              <p className="text-base font-bold text-ink">
                {day.label}
                {day.date === week.today ? (
                  <span className="ms-2 text-sm font-semibold text-accent-ink">
                    {VISIT_MESSAGES.today}
                  </span>
                ) : null}
              </p>

              <ul className="flex list-none flex-col gap-1.5 p-0">
                {day.slots.map((slot) => {
                  const cancelled = slot.status === "CANCELLED";

                  return (
                    <li
                      key={slot.id}
                      className={cn(
                        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-field)] px-3 py-2",
                        cancelled ? "bg-surface-sunk" : "bg-primary-wash",
                      )}
                    >
                      <span
                        className={cn(
                          "text-base",
                          cancelled ? "text-ink-soft line-through" : "font-semibold text-ink",
                        )}
                      >
                        {formatSlotRange(slot.startMinute, slot.endMinute)}
                      </span>

                      {cancelled ? (
                        <StatusBadge tone="neutral">
                          <Icon name="cross" /> {VISIT_MESSAGES.cancelledBadge}
                        </StatusBadge>
                      ) : null}

                      {/*
                        The desk's own words, whichever kind they are — a note on
                        an open time ("returns only"), or the reason a cancelled
                        one is off. Shown as written: a librarian who typed
                        "the room is being painted" has said something more
                        useful than any wording this file could supply.
                      */}
                      {cancelled ? (
                        <span className="w-full text-sm text-ink-soft">
                          {slot.cancelledReason ?? VISIT_MESSAGES.cancelledNote}
                        </span>
                      ) : slot.note ? (
                        <span className="w-full text-sm text-ink-soft">{slot.note}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** `/my-books?week=2`, and plain `/my-books` for the week we are in. */
function weekHref(offset: number): string {
  return offset <= 0 ? "/my-books#visit-times" : `/my-books?week=${offset}#visit-times`;
}

function groupByDay(week: VisitWeekView) {
  const days: { date: string; label: string; slots: VisitWeekView["slots"] }[] = [];

  for (const slot of week.slots) {
    const existing = days.find((day) => day.date === slot.date);
    if (existing) {
      existing.slots.push(slot);
      continue;
    }

    const parsed = fromIsoDate(slot.date);
    days.push({
      date: slot.date,
      label: parsed ? formatDayLabel(parsed) : slot.date,
      slots: [slot],
    });
  }

  return days;
}
