"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isAppError, toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  activateAccount,
  changeOwnPassword,
  completePasswordReset,
  requestPasswordReset,
} from "@/server/services/password-service";
import {
  deactivateMember,
  deleteMemberAccount,
  issueMemberActivationLink,
  reactivateMember,
  reissueActivation,
  suspendMember,
} from "@/server/services/account-service";
import {
  createStaffAccount,
  deleteStaffAccount,
  issueStaffActivationLink,
  deactivateStaff,
  reactivateStaff,
  reissueStaffActivation,
  suspendStaff,
} from "@/server/services/staff-service";

export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * A one-time activation link, returned to the Super Admin who asked for it
   * and to nobody else.
   *
   * Only the two `issue…ActivationLinkAction` calls ever set this — one for a
   * librarian, one for a reader. It is not stored, not logged and not
   * persisted anywhere: it lives in one server-action response, is copied to a
   * clipboard, and is gone.
   */
  activationUrl?: string;
}

async function clientIp(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");
}

function toState(error: unknown): ActionState {
  if (error instanceof ValidationError) {
    return { status: "error", message: error.friendlyMessage, fieldErrors: error.fieldErrors };
  }
  if (isAppError(error)) {
    return { status: "error", message: error.friendlyMessage };
  }
  console.error("Account action failed:", error);
  return { status: "error", message: toFriendlyMessage(error) };
}

// ---------------------------------------------------------------------------
// Activation and password
// ---------------------------------------------------------------------------

const setPasswordSchema = z
  .object({
    token: z.string().min(16),
    password: z.string().min(1, "Please choose a password."),
    confirmPassword: z.string().min(1, "Please type it a second time."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Those two do not match. Try typing them again.",
    path: ["confirmPassword"],
  });

export async function activateAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", fieldErrors };
  }

  try {
    await activateAccount({
      rawToken: parsed.data.token,
      newPassword: parsed.data.password,
      requestIp: await clientIp(),
    });
  } catch (error) {
    return toState(error);
  }

  // Deliberately not signed in automatically: the guardian usually completes
  // this, and the child should then sign in themselves — which is also the
  // moment they learn that their password works.
  redirect("/login?activated=1");
}

export async function requestPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();

  // Never throws, never reveals. The same response is returned whether the
  // account exists, is suspended, or was never real.
  await requestPasswordReset({ identifier, requestIp: await clientIp() });

  return {
    status: "success",
    message:
      "If we can recover that account, we have sent instructions to the parent or guardian's email address.",
  };
}

export async function completePasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", fieldErrors };
  }

  try {
    await completePasswordReset({
      rawToken: parsed.data.token,
      newPassword: parsed.data.password,
    });
  } catch (error) {
    return toState(error);
  }

  redirect("/login?reset=1");
}

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return {
      status: "error",
      fieldErrors: { confirmPassword: "Those two do not match. Try typing them again." },
    };
  }

  try {
    await changeOwnPassword({ currentPassword, newPassword });
  } catch (error) {
    return toState(error);
  }

  // Changing the password ends every session, including this one, so the only
  // sensible next screen is sign-in.
  redirect("/login?changed=1");
}

// ---------------------------------------------------------------------------
// Member lifecycle (librarian)
// ---------------------------------------------------------------------------

export async function suspendMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await suspendMember(String(formData.get("memberId") ?? ""), String(formData.get("reason") ?? ""));
    revalidatePath("/desk/members");
    return { status: "success", message: "Paused, and any signed-in device has been signed out." };
  } catch (error) {
    return toState(error);
  }
}

export async function reactivateMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await reactivateMember(String(formData.get("memberId") ?? ""));
    revalidatePath("/desk/members");
    return { status: "success", message: "Back on the shelves." };
  } catch (error) {
    return toState(error);
  }
}

export async function deactivateMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await deactivateMember(
      String(formData.get("memberId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/desk/members");
    return { status: "success", message: "Account closed. Borrowing history has been kept." };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Erases a reader's account, and says so plainly.
 *
 * `redirect` on success because the page the control lives on may be that
 * reader's own detail page, which no longer exists. Redirecting from a server
 * action throws by design, so it sits after the try/catch rather than inside
 * it — a `NEXT_REDIRECT` caught by `toState` would be reported to the Super
 * Admin as a failure of a deletion that in fact succeeded.
 */
export async function deleteMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let deleted: { displayName: string };
  try {
    deleted = await deleteMemberAccount(
      String(formData.get("memberId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    return toState(error);
  }

  revalidatePath("/desk/members");
  redirect(`/desk/members?deleted=${encodeURIComponent(deleted.displayName)}`);
}

/**
 * Fallback for a library whose email is not configured yet — the reader half.
 *
 * Returns the raw activation URL to the Super Admin who asked for it. The
 * permission is checked inside the service, as everywhere else, so a
 * hand-written POST from a librarian's session is refused exactly as a hidden
 * button is.
 *
 * Nothing is revalidated into the page: the URL is in this response, and then
 * it is the administrator's to deliver.
 */
export async function issueMemberActivationLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { url, displayName } = await issueMemberActivationLink(
      String(formData.get("memberId") ?? ""),
    );

    return {
      status: "success",
      message: `One-time link for ${displayName}. It replaces any earlier link and works once.`,
      activationUrl: url,
    };
  } catch (error) {
    return toState(error);
  }
}

export async function reissueActivationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const sent = await reissueActivation(String(formData.get("memberId") ?? ""));
    revalidatePath("/desk/members");
    return {
      status: sent ? "success" : "error",
      message: sent
        ? "A fresh link is on its way to the guardian. The previous one no longer works."
        : "The link could not be sent. Check the email settings and try again.",
    };
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Staff lifecycle (Super Admin)
// ---------------------------------------------------------------------------

export async function createStaffAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const result = await createStaffAccount({
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
    });
    revalidatePath("/admin/staff");

    return {
      status: "success",
      message: result.emailSent
        ? "Created. They have been emailed a link to choose their own password."
        : "Created, but the invitation email did not send — use “Send link again”.",
    };
  } catch (error) {
    return toState(error);
  }
}

export async function suspendStaffAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await suspendStaff(String(formData.get("staffId") ?? ""), String(formData.get("reason") ?? ""));
    revalidatePath("/admin/staff");
    return { status: "success", message: "Suspended, and their sessions have been ended." };
  } catch (error) {
    return toState(error);
  }
}

export async function reactivateStaffAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await reactivateStaff(String(formData.get("staffId") ?? ""));
    revalidatePath("/admin/staff");
    return { status: "success", message: "Reactivated." };
  } catch (error) {
    return toState(error);
  }
}

export async function deactivateStaffAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await deactivateStaff(String(formData.get("staffId") ?? ""), String(formData.get("reason") ?? ""));
    revalidatePath("/admin/staff");
    return { status: "success", message: "Account closed." };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Fallback for a library whose email is not configured yet.
 *
 * Returns the raw activation URL to the Super Admin who asked for it. The
 * permission is checked inside the service, as everywhere else, so a
 * hand-written POST is refused exactly as a hidden button is.
 *
 * The URL is deliberately not revalidated into the page or written anywhere:
 * it is in this response, and then it is the administrator's to deliver.
 */
export async function issueStaffActivationLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { url, displayName } = await issueStaffActivationLink(
      String(formData.get("staffId") ?? ""),
    );

    return {
      status: "success",
      message: `One-time link for ${displayName}. It replaces any earlier link and works once.`,
      activationUrl: url,
    };
  } catch (error) {
    return toState(error);
  }
}

export async function reissueStaffActivationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const sent = await reissueStaffActivation(String(formData.get("staffId") ?? ""));
    revalidatePath("/admin/staff");
    return {
      status: sent ? "success" : "error",
      message: sent ? "A fresh link has been sent." : "The link could not be sent.",
    };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Erases a staff account that was never used.
 *
 * Stays on `/admin/staff`, which survives the deletion, so the outcome is
 * reported in place rather than through a redirect.
 */
export async function deleteStaffAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const deleted = await deleteStaffAccount(
      String(formData.get("staffId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/admin/staff");
    return {
      status: "success",
      message: `${deleted.displayName}'s account has been deleted.`,
    };
  } catch (error) {
    return toState(error);
  }
}
