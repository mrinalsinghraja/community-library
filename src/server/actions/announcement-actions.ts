"use server";

import { revalidatePath } from "next/cache";

import { BOARD_MESSAGES } from "@/lib/message-board";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import { postNotice, withdrawNotice } from "@/server/services/announcement-service";

/**
 * Notice board actions.
 *
 * `announcement.manage` is required inside the service, not here. It is held by
 * the Super Admin alone, so a librarian who forged this form still cannot say
 * anything to every family in the building.
 */

export interface NoticeFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function toErrorState(error: unknown): NoticeFormState {
  if (error instanceof ValidationError) {
    return {
      status: "error",
      message: "Some answers need a small fix.",
      fieldErrors: error.fieldErrors,
    };
  }
  return { status: "error", message: toFriendlyMessage(error) };
}

function revalidateBoard(): void {
  revalidatePath("/desk/board");
  revalidatePath("/my-books");
  revalidatePath("/desk");
}

export async function postNoticeAction(
  _previous: NoticeFormState,
  formData: FormData,
): Promise<NoticeFormState> {
  try {
    await postNotice({
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
    });

    revalidateBoard();
    return { status: "success", message: BOARD_MESSAGES.posted };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function withdrawNoticeAction(
  _previous: NoticeFormState,
  formData: FormData,
): Promise<NoticeFormState> {
  try {
    await withdrawNotice(String(formData.get("noticeId") ?? ""));

    revalidateBoard();
    return { status: "success", message: BOARD_MESSAGES.takenDown };
  } catch (error) {
    return toErrorState(error);
  }
}
