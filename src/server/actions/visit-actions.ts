"use server";

import { revalidatePath } from "next/cache";

import { VISIT_DESK_MESSAGES } from "@/lib/visits";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import { cancelVisitSlot, createVisitSlots } from "@/server/services/visit-service";

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
