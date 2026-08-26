"use server";

import { revalidatePath } from "next/cache";

import { CHANGE_MESSAGES } from "@/lib/profile-changes";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import { closeMemberAccount, updateMemberDetails } from "@/server/services/account-service";
import {
  decideProfileChange,
  submitProfileChange,
  withdrawOwnProfileChange,
} from "@/server/services/profile-change-service";

/**
 * Account-details actions: what a reader asks for, and what the desk does.
 *
 * Thin, like every other action file here. **No authorization decision is made
 * in this file.** In particular:
 *
 *   * `submitProfileChange` resolves the member from the session and takes no
 *     id, so a forged post cannot propose a change to somebody else's account;
 *   * `decideProfileChange` requires `profile_change.review`, which only the
 *     Super Admin holds, so a librarian submitting this form changes nothing;
 *   * `closeMemberAccount` requires `member.deactivate`, also Super Admin only,
 *     and re-checks that the target is not a staff account.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one makes every action in it fail at module evaluation, and `next build`
 * compiles it happily — it shows up on the first real submit.
 */

export interface ProfileFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function toErrorState(error: unknown): ProfileFormState {
  if (error instanceof ValidationError) {
    return {
      status: "error",
      message: error.fieldErrors.form ?? "Some answers need a small fix.",
      fieldErrors: error.fieldErrors,
    };
  }
  return { status: "error", message: toFriendlyMessage(error) };
}

function revalidateProfile(): void {
  revalidatePath("/account");
  revalidatePath("/desk/changes");
  revalidatePath("/desk/members");
  revalidatePath("/desk");
}

/** A reader asking for their own details to be corrected. Writes a proposal. */
export async function submitProfileChangeAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  try {
    const submitted: Record<string, string | undefined> = {};
    for (const [key, value] of formData.entries()) {
      if (key !== "note" && typeof value === "string") submitted[key] = value;
    }

    await submitProfileChange(submitted, String(formData.get("note") ?? ""));

    revalidateProfile();
    return { status: "success", message: CHANGE_MESSAGES.submitted };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function withdrawProfileChangeAction(
  _previous: ProfileFormState,
): Promise<ProfileFormState> {
  try {
    await withdrawOwnProfileChange();
    revalidateProfile();
    return { status: "success", message: CHANGE_MESSAGES.withdrawn };
  } catch (error) {
    return toErrorState(error);
  }
}

/** The Super Admin answering one request. */
export async function decideProfileChangeAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  try {
    const approve = formData.get("approve") === "true";
    await decideProfileChange(
      String(formData.get("requestId") ?? ""),
      approve,
      String(formData.get("decisionNote") ?? ""),
    );

    revalidateProfile();
    return {
      status: "success",
      message: approve ? CHANGE_MESSAGES.approved : CHANGE_MESSAGES.rejected,
    };
  } catch (error) {
    return toErrorState(error);
  }
}

/** A librarian correcting a reader's record directly. */
export async function updateMemberDetailsAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  try {
    const birthYearRaw = String(formData.get("birthYear") ?? "").trim();

    const { changed } = await updateMemberDetails({
      memberUserId: String(formData.get("memberUserId") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      apartment: String(formData.get("apartment") ?? ""),
      birthYear: birthYearRaw === "" ? undefined : Number.parseInt(birthYearRaw, 10),
    });

    revalidateProfile();
    return {
      status: "success",
      message: changed.length === 0 ? "Nothing was different." : "Saved.",
    };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * Closing an account: grown up, or left the building.
 *
 * Nothing is deleted. The status stops the account working and the record stays
 * where it is — see `closeMemberAccount` for why that is not negotiable.
 */
export async function closeMemberAccountAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  try {
    const status = String(formData.get("status") ?? "");
    await closeMemberAccount(
      String(formData.get("memberUserId") ?? ""),
      status === "LEFT" ? "LEFT" : "GROWN_UP",
      String(formData.get("reason") ?? ""),
    );

    revalidateProfile();
    return {
      status: "success",
      message:
        status === "LEFT"
          ? "Marked as left. Their history stays with the library."
          : "Marked as grown up. Their history stays with the library.",
    };
  } catch (error) {
    return toErrorState(error);
  }
}
