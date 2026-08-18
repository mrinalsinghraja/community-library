"use server";

import { revalidatePath } from "next/cache";

import { isAppError, toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  removeLibraryLogo,
  setOverdueReminders,
  updateBranding,
  updateLibraryLogo,
  updateLibrarySettings,
  updateVerificationRequirement,
} from "@/server/services/settings-service";

/**
 * Configuration form actions.
 *
 * Thin, like every other action file here: read the form, call the service,
 * turn the answer into something a screen can show. **No authorization and no
 * validation decision is made in this file** — the services do both, so a
 * hand-written POST to one of these endpoints is refused exactly as a disabled
 * control is. The reminder switch in particular is refused by the service, not
 * by the `disabled` attribute a browser can be told to ignore.
 *
 * NOTE: a "use server" file may export only async functions.
 */

export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function toState(error: unknown): ActionState {
  if (error instanceof ValidationError) {
    return { status: "error", message: error.friendlyMessage, fieldErrors: error.fieldErrors };
  }
  if (isAppError(error)) {
    return { status: "error", message: error.friendlyMessage };
  }
  console.error("Settings action failed:", error);
  return { status: "error", message: toFriendlyMessage(error) };
}

/**
 * Branding and the library's name are read by every page, including the
 * children's ones, so a change has to reach the whole tree rather than the
 * screen that made it.
 */
function refreshEverything(): void {
  revalidatePath("/", "layout");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function updateSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { changed } = await updateLibrarySettings({
      libraryName: text(formData, "libraryName"),
      timezone: text(formData, "timezone"),
      dateFormat: text(formData, "dateFormat"),
      borrowingPeriodDays: text(formData, "borrowingPeriodDays"),
      maxActiveLoans: text(formData, "maxActiveLoans"),
      maxRenewals: text(formData, "maxRenewals"),
      renewalPeriodDays: text(formData, "renewalPeriodDays"),
      ageMin: text(formData, "ageMin"),
      ageMax: text(formData, "ageMax"),
      memberCodePrefix: text(formData, "memberCodePrefix"),
      copyCodePrefix: text(formData, "copyCodePrefix"),
      catalogueVisibility: text(formData, "catalogueVisibility"),
    });

    refreshEverything();

    return {
      status: "success",
      message: changed.length
        ? "Saved. New books going out will use these rules — books already borrowed keep the dates they were given."
        : "Nothing to change.",
    };
  } catch (error) {
    return toState(error);
  }
}

export async function updateVerificationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { changed } = await updateVerificationRequirement({
      strength: text(formData, "requiredGuardianVerification"),
      confirmed: formData.get("confirm") === "on",
    });

    revalidatePath("/admin/settings");
    revalidatePath("/desk/registrations");

    return {
      status: "success",
      message: changed ? "Saved. New registrations will be held to this." : "Nothing to change.",
    };
  } catch (error) {
    return toState(error);
  }
}

export async function setRemindersAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const enabled = text(formData, "enabled") === "true";
    await setOverdueReminders(enabled);
    revalidatePath("/admin/settings");

    return {
      status: "success",
      message: enabled ? "Reminders are on." : "Reminders are off. Nothing will be sent.",
    };
  } catch (error) {
    return toState(error);
  }
}

export async function updateBrandingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { changed } = await updateBranding({
      primaryColor: text(formData, "primaryColor"),
      welcomeMessage: text(formData, "welcomeMessage"),
      rulesMarkdown: text(formData, "rulesMarkdown"),
      donationPolicyMarkdown: text(formData, "donationPolicyMarkdown"),
      contactEmail: text(formData, "contactEmail"),
      contactPhone: text(formData, "contactPhone"),
    });

    refreshEverything();

    return {
      status: "success",
      message: changed.length ? "Saved. The children's pages look like this now." : "Nothing to change.",
    };
  } catch (error) {
    return toState(error);
  }
}

export async function uploadLogoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", message: "Choose a picture first.", fieldErrors: { logo: "No picture chosen." } };
    }

    await updateLibraryLogo({
      bytes: new Uint8Array(await file.arrayBuffer()),
      // Read, never trusted — the bytes themselves are what validation reads.
      declaredMimeType: file.type,
      originalFilename: file.name,
    });

    refreshEverything();
    return { status: "success", message: "That is the library's logo now." };
  } catch (error) {
    return toState(error);
  }
}

export async function removeLogoAction(previous: ActionState): Promise<ActionState> {
  void previous;

  try {
    await removeLibraryLogo();
    refreshEverything();
    return { status: "success", message: "Logo removed. The drawn one is back." };
  } catch (error) {
    return toState(error);
  }
}
