"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CURRENT_CONSENT_TYPES, REQUIRED_CONSENT_TYPES, type ConsentTypeKey } from "@/lib/consent";
import { isAvatarKey } from "@/lib/avatars";
import { toFriendlyMessage, ValidationError, isAppError } from "@/server/lib/errors";
import { getCurrentLibrary } from "@/server/lib/settings";
import { storeChildPhoto } from "@/server/services/media-service";
import { recordStaffVerification } from "@/server/services/guardian-verification-service";
import {
  approveRegistration,
  markUnderReview,
  rejectRegistration,
  submitRegistration,
} from "@/server/services/registration-service";

/**
 * Registration actions.
 *
 * Thin by design: parse, call the service, translate the outcome. Every rule and
 * every permission check lives in the service, where it is testable without a
 * form.
 */

const registrationSchema = z.object({
  childName: z.string().trim().min(1, "Please tell us your child's name.").max(80),
  childDateOfBirth: z
    .string()
    .min(1, "Please give your child's date of birth.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "That date does not look right.")
    .transform((value) => new Date(`${value}T00:00:00Z`)),
  apartment: z.string().trim().min(1, "Which flat do you live in?").max(20),
  guardianName: z.string().trim().min(1, "Please give your name.").max(80),
  guardianEmail: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "That does not look like an email address.")
    .max(160),
  guardianPhone: z.string().trim().min(6, "Please give a phone number.").max(24),
  avatarKey: z.string().optional(),
  /** Hidden field. A real person leaves it empty; a naive bot fills it in. */
  website: z.string().max(0).optional(),
});

/**
 * Reads the optional photograph off the form.
 *
 * Returns null for the two shapes "no photo" arrives in: no field at all, and an
 * empty `File` that browsers submit for an untouched file input. Neither is an
 * error — Option C in the brief is a first-class choice, and the most common one
 * this library expects.
 */
function photoFrom(formData: FormData): File | null {
  const entry = formData.get("childPhoto");
  if (!(entry instanceof File) || entry.size === 0) return null;
  return entry;
}

export interface RegistrationFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function submitRegistrationAction(
  _previous: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const parsed = registrationSchema.safeParse({
    childName: formData.get("childName"),
    childDateOfBirth: formData.get("childDateOfBirth"),
    apartment: formData.get("apartment"),
    guardianName: formData.get("guardianName"),
    guardianEmail: formData.get("guardianEmail"),
    guardianPhone: formData.get("guardianPhone"),
    avatarKey: formData.get("avatarKey") ?? undefined,
    website: formData.get("website") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", message: "Some answers need a small fix.", fieldErrors };
  }

  // Honeypot. Answer exactly as if it had worked, so a bot learns nothing.
  if (parsed.data.website) {
    return { status: "success" };
  }

  const consentTypes = CURRENT_CONSENT_TYPES.filter((type) =>
    formData.get(`consent.${type}`) === "on",
  ) as ConsentTypeKey[];

  for (const required of REQUIRED_CONSENT_TYPES) {
    if (!consentTypes.includes(required)) {
      return {
        status: "error",
        message: "A parent or guardian needs to agree before we can create an account.",
        fieldErrors: { consent: "Please tick both boxes to continue." },
      };
    }
  }

  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");

  // The photograph is stored before the registration, and is claimed inside the
  // registration's own transaction. If anything after this point fails, the
  // object is never claimed and the sweeper removes it — see media-service.
  let photoMediaId: string | null = null;
  const photo = photoFrom(formData);

  if (photo) {
    if (!consentTypes.includes("CHILD_PHOTO_STORAGE")) {
      return {
        status: "error",
        message: "Please agree to us storing the photo, or remove it and pick an avatar instead.",
        fieldErrors: { photo: "We need your permission before we can keep a photo of your child." },
      };
    }

    try {
      const { library } = await getCurrentLibrary();
      const stored = await storeChildPhoto({
        libraryId: library.id,
        bytes: new Uint8Array(await photo.arrayBuffer()),
        // Read but not trusted: validation is done on the actual bytes.
        declaredMimeType: photo.type,
        originalFilename: photo.name,
        uploadedById: null,
      });
      photoMediaId = stored.mediaId;
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          status: "error",
          message: error.friendlyMessage,
          fieldErrors: { photo: error.fieldErrors?.file ?? "That picture could not be used." },
        };
      }
      console.error("Child photo upload failed:", error);
      return {
        status: "error",
        message: "We could not save that picture. You can carry on with an avatar instead.",
        fieldErrors: { photo: "That picture could not be saved." },
      };
    }
  }

  try {
    await submitRegistration({
      childName: parsed.data.childName,
      childDateOfBirth: parsed.data.childDateOfBirth,
      apartment: parsed.data.apartment,
      guardianName: parsed.data.guardianName,
      guardianEmail: parsed.data.guardianEmail,
      guardianPhone: parsed.data.guardianPhone,
      avatarKey: isAvatarKey(parsed.data.avatarKey) ? parsed.data.avatarKey : null,
      photoMediaId,
      consentTypes,
      requestIp: forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip"),
      userAgent: headerList.get("user-agent"),
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: "error",
        message: error.friendlyMessage,
        fieldErrors: error.fieldErrors,
      };
    }
    if (isAppError(error)) {
      return { status: "error", message: error.friendlyMessage };
    }
    console.error("Registration submission failed:", error);
    return { status: "error", message: toFriendlyMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Librarian decisions
// ---------------------------------------------------------------------------

export interface DeskActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function markUnderReviewAction(
  _previous: DeskActionState,
  formData: FormData,
): Promise<DeskActionState> {
  const id = String(formData.get("registrationId") ?? "");
  try {
    await markUnderReview(id);
    revalidatePath("/desk/registrations");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: toFriendlyMessage(error) };
  }
}

export async function approveRegistrationAction(
  _previous: DeskActionState,
  formData: FormData,
): Promise<DeskActionState> {
  const id = String(formData.get("registrationId") ?? "");

  try {
    const result = await approveRegistration(id);
    revalidatePath("/desk/registrations");
    revalidatePath("/desk/members");

    return {
      status: "success",
      message: result.activationEmailSent
        ? `Approved. Card ${result.memberCode} created and the activation email is on its way.`
        : `Approved. Card ${result.memberCode} created, but the activation email did not send — use "Send link again".`,
    };
  } catch (error) {
    return { status: "error", message: toFriendlyMessage(error) };
  }
}

export async function rejectRegistrationAction(
  _previous: DeskActionState,
  formData: FormData,
): Promise<DeskActionState> {
  const id = String(formData.get("registrationId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    await rejectRegistration(id, reason);
    revalidatePath("/desk/registrations");
    return { status: "success", message: "Closed, and a gentle note has gone to the family." };
  } catch (error) {
    return { status: "error", message: toFriendlyMessage(error) };
  }
}

/**
 * A librarian records that they confirmed the guardian themselves.
 *
 * The path that lets a library require real verification without requiring
 * every parent to have a working email — which, for a community library run out
 * of a corner of a room, matters.
 */
export async function recordStaffVerificationAction(
  _previous: DeskActionState,
  formData: FormData,
): Promise<DeskActionState> {
  const id = String(formData.get("registrationId") ?? "");
  const note = String(formData.get("evidenceNote") ?? "");

  try {
    await recordStaffVerification({
      registrationRequestId: id,
      method: "STAFF_VERIFIED",
      evidenceNote: note,
    });
    revalidatePath("/desk/registrations");
    return { status: "success", message: "Recorded — guardian verification is now complete." };
  } catch (error) {
    return { status: "error", message: toFriendlyMessage(error) };
  }
}
