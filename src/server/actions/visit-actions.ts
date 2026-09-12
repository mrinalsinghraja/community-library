"use server";

import { revalidatePath } from "next/cache";

import type { BulkResult } from "@/lib/bulk";
import {
  VISIT_DESK_MESSAGES,
  formatDayLabel,
  formatSlotRange,
  fromIsoDate,
} from "@/lib/visits";
import { limitBulkSelection, runBulk } from "@/server/lib/bulk";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  cancelVisitSlot,
  createVisitSlots,
  listUpcomingVisitSlots,
} from "@/server/services/visit-service";

/**
 * Opening-times form actions.
 *
 * Thin, like every other action file here: **no authorization decision is made
 * in this file.** `visit.manage` and `visit.cancel` are required inside the
 * service, so a hand-written POST is refused exactly as a missing button is —
 * and in particular a Librarian cannot cancel a slot by submitting the form the
 * Super Admin sees.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one makes every action in it fail at module evaluation, and `next build`
 * compiles it happily — it shows up on the first real submit.
 */

export interface VisitFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function toErrorState(error: unknown): VisitFormState {
  if (error instanceof ValidationError) {
    return {
      status: "error",
      message: "Some answers need a small fix.",
      fieldErrors: error.fieldErrors,
    };
  }
  return { status: "error", message: toFriendlyMessage(error) };
}

/**
 * Every surface a visiting time is visible on.
 *
 * `/my-books` is here because that is where a reader reads it, and it is the
 * whole point of the feature that a cancellation reaches that page immediately
 * rather than whenever the page happens to be rebuilt.
 */
function revalidateVisits(): void {
  revalidatePath("/desk/visits");
  revalidatePath("/my-books");
  revalidatePath("/rules");
  revalidatePath("/desk");
}

function minute(formData: FormData, field: string): number {
  return Number.parseInt(String(formData.get(field) ?? ""), 10);
}

export async function createVisitSlotsAction(
  _previous: VisitFormState,
  formData: FormData,
): Promise<VisitFormState> {
  try {
    const repeat = formData.get("repeat") === "weekly" ? "weekly" : "once";
    const weekdayRaw = String(formData.get("weekday") ?? "");

    const { created } = await createVisitSlots({
      repeat,
      weekday: weekdayRaw === "" ? undefined : Number.parseInt(weekdayRaw, 10),
      fromDate: String(formData.get("fromDate") ?? ""),
      toDate: String(formData.get("toDate") ?? "") || undefined,
      startMinute: minute(formData, "startMinute"),
      endMinute: minute(formData, "endMinute"),
      note: String(formData.get("note") ?? ""),
    });

    revalidateVisits();
    return { status: "success", message: VISIT_DESK_MESSAGES.created(created) };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function cancelVisitSlotAction(
  _previous: VisitFormState,
  formData: FormData,
): Promise<VisitFormState> {
  try {
    await cancelVisitSlot(
      String(formData.get("slotId") ?? ""),
      String(formData.get("reason") ?? ""),
    );

    revalidateVisits();
    return { status: "success", message: VISIT_DESK_MESSAGES.cancelled };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * Calling off several visiting times at once.
 *
 * The shape of the mistake this exists for is a stretch of dates, not a date.
 * Times go up a term at a time — every Saturday until December is one press of
 * the form above — so when the room is lost for a fortnight, or the whole run
 * went up on the wrong weekday, what has to come down is a stretch too. Doing
 * that one row at a time is twelve confirmations and twelve chances to type a
 * slightly different reason.
 *
 * It is `cancelVisitSlot` run once per ticked row through `runBulk`, which is
 * the only way a bulk action is built here — the same permission check, the
 * same audit row per slot, the same silent no-op on a slot somebody else
 * already cancelled while this screen was open.
 *
 * The reason is asked for once and written onto every one of them. Unlike the
 * single-row form, where it is optional, the toolbar will not run without it:
 * a reader reads this sentence crossed out beside the time they were counting
 * on, and "No reason given" twelve times over is how a library loses a family's
 * Saturday without telling them why. One line covering the whole stretch is
 * also the truthful thing to write — the room being painted is one fact, not
 * twelve. A day that came down for its own reason is cancelled on its own row,
 * where it can have its own.
 */
export async function bulkCancelVisitSlotsAction(
  ids: string[],
  _action: string,
  note: string,
): Promise<BulkResult> {
  const chosen = limitBulkSelection(ids);

  /*
   * Names come from the same list the screen is showing, fetched here rather
   * than sent by the browser — a label that arrived from the client would be a
   * sentence the server repeats without knowing whether it is true.
   */
  const { slots } = await listUpcomingVisitSlots();
  const labels = new Map(
    slots.map((slot) => {
      const date = fromIsoDate(slot.date);
      const day = date ? formatDayLabel(date) : slot.date;
      return [slot.id, `${day}, ${formatSlotRange(slot.startMinute, slot.endMinute)}`];
    }),
  );

  const result = await runBulk(
    chosen,
    (id) => labels.get(id) ?? "That time",
    (id) => cancelVisitSlot(id, note),
  );

  revalidateVisits();
  return result;
}
