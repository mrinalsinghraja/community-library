"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";

import { LIFECYCLE_MESSAGES } from "@/lib/account-lifecycle";
import { GENERIC_LOGIN_FAILURE, signIn, signOut } from "@/server/auth";

/**
 * Server actions for signing in and out.
 *
 * Actions stay thin on purpose: parse the input, call into the auth layer,
 * translate the outcome. No business logic, no database access of their own.
 */

const signInSchema = z.object({
  identifier: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
  /**
   * Where to go afterwards. Only ever a same-origin path — an absolute URL here
   * would turn the login form into an open redirect.
   */
  next: z
    .string()
    .optional()
    .transform((value) =>
      value && value.startsWith("/") && !value.startsWith("//") ? value : "/account",
    ),
});

export interface SignInState {
  error?: string;
}

export async function signInAction(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    // Deliberately the same message as a wrong password: an empty field and a
    // wrong secret word must be indistinguishable from outside.
    return { error: GENERIC_LOGIN_FAILURE };
  }

  try {
    await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      /*
       * A closed account, told plainly.
       *
       * SECURITY: `authorize` raises this only AFTER verifying the password, so
       * reaching this branch means the person typed the right secret word. A
       * wrong guess still falls through to the generic message below and gives
       * away nothing about whether the account exists or what state it is in.
       *
       * Worth the extra branch: a child whose card was retired on their
       * birthday would otherwise be told to check their spelling, over and
       * over, for a password that is perfectly correct.
       */
      const code = (error as { code?: string }).code;
      if (code === "account_grown_up") return { error: LIFECYCLE_MESSAGES.grownUp };
      if (code === "account_left") return { error: LIFECYCLE_MESSAGES.left };
      return { error: GENERIC_LOGIN_FAILURE };
    }
    throw error;
  }

  // redirect() throws internally, so it must sit outside the try/catch above.
  redirect(parsed.data.next);
}

export async function signOutAction(): Promise<void> {
  // The signOut event in the auth config deletes the session row, so the handle
  // is dead server-side and not merely forgotten by the browser.
  await signOut({ redirectTo: "/" });
}
