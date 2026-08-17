"use server";

import { revalidatePath } from "next/cache";

import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import { removeMemberPhoto, replaceMemberPhoto } from "@/server/services/media-service";

/**
 * Staff actions on a child's photograph.
 *
 * Thin, like every action file here: parse, call the service, translate. The
 * `member.manage_photo` permission is checked inside the service, not here, so
 * hiding these buttons is a courtesy and never the control.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one of these makes every action in the file fail at module evaluation,
 * and `next build` compiles it happily — it only shows up on the first real
 * submit.
 */

export interface MediaActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function replaceMemberPhotoAction(
  _previous: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  const memberId = String(formData.get("memberId") ?? "");
  const file = formData.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Please choose a picture first." };
  }

  try {
    await replaceMemberPhoto({
      memberUserId: memberId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      // Read, never trusted: validation reads the actual bytes.
      declaredMimeType: file.type,
      originalFilename: file.name,
    });

    revalidatePath("/desk/members");
    return { status: "success", message: "Photo updated." };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: "error",
        message: error.fieldErrors?.file ?? error.friendlyMessage,
      };
    }
    return { status: "error", message: toFriendlyMessage(error) };
  }
}

export async function removeMemberPhotoAction(
  _previous: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  const memberId = String(formData.get("memberId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    await removeMemberPhoto(memberId, reason);
    revalidatePath("/desk/members");
    // The avatar returns on its own — a card without a picture would make the
    // removal feel like a punishment.
    return { status: "success", message: "Photo removed. Their avatar is back." };
  } catch (error) {
    return { status: "error", message: toFriendlyMessage(error) };
  }
}
