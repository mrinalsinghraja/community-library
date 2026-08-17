"use server";

import { revalidatePath } from "next/cache";

import { isCondition } from "@/lib/catalogue";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  cancelLoan,
  issueBook,
  renewLoan,
  returnBook,
} from "@/server/services/circulation-service";

/**
 * Circulation form actions.
 *
 * Thin by design: read the form, call the service, translate the result into a
 * sentence a screen can render. **No authorization decision is made here.**
 * Every service entry point below calls `requirePermission` itself, so a
 * hand-written POST to one of these endpoints is refused exactly as a hidden
 * button is.
 *
 * Nothing here trusts the request for identity or tenancy either. No user id,
 * no library id and no role arrives in a form field; the actor is resolved from
 * the session inside the service, every time. The member and copy ids that DO
 * arrive are checked against the actor's own library before anything happens —
 * an id from another community resolves to nothing.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one of these makes every action in the file fail at module evaluation,
 * and `next build` compiles it happily — it only shows up on the first real
 * submit.
 */

export interface CirculationFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function toErrorState(error: unknown): CirculationFormState {
  if (error instanceof ValidationError) {
    return {
      status: "error",
      message: "Some answers need a small fix.",
      fieldErrors: error.fieldErrors,
    };
  }
  // Everything else becomes its friendly message. A rule violation says which
  // rule in words a librarian can act on; anything unexpected says nothing at
  // all about the internals.
  return { status: "error", message: toFriendlyMessage(error) };
}

/** Refreshes every surface a circulation change is visible on. */
function revalidateCirculation(): void {
  revalidatePath("/desk");
  revalidatePath("/desk/circulation");
  revalidatePath("/desk/loans");
  revalidatePath("/admin/books");
  revalidatePath("/books");
  revalidatePath("/my-books");
}

export async function issueBookAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    const issued = await issueBook({
      memberUserId: String(formData.get("memberUserId") ?? ""),
      copyId: String(formData.get("copyId") ?? ""),
    });

    revalidateCirculation();

    // Names the book, its code and the reader, because that is what the
    // librarian says out loud to the child in front of them. The due date is
    // on the screen already; repeating it here would be noise.
    return {
      status: "success",
      message: `${issued.title} (${issued.copyCode}) is now with ${issued.readerName}.`,
    };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function returnBookAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    /*
     * The condition control is optional and omitting it means "unchanged".
     * A blank or unrecognised value must therefore become `undefined` rather
     * than a default of GOOD — a book that went out Fair comes back Fair
     * unless a librarian actually looked at it and said otherwise.
     */
    const raw = String(formData.get("condition") ?? "");
    // `isCondition` narrows, so the type arrives without this file needing to
    // import anything from the database client — see the lint rule that keeps
    // actions off Prisma entirely.
    const condition = isCondition(raw) ? raw : undefined;

    const returned = await returnBook({
      loanId: String(formData.get("loanId") ?? ""),
      condition,
    });

    revalidateCirculation();

    return {
      status: "success",
      message:
        condition === "DAMAGED"
          ? `${returned.title} (${returned.copyCode}) is back, and marked as damaged so it stays off the shelf.`
          : `${returned.title} (${returned.copyCode}) is back on the shelf.`,
    };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function renewLoanAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await renewLoan({ loanId: String(formData.get("loanId") ?? "") });
    revalidateCirculation();
    return { status: "success", message: "Kept for longer. The new date is on the row." };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function cancelLoanAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await cancelLoan({
      loanId: String(formData.get("loanId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    revalidateCirculation();
    return {
      status: "success",
      // Says what actually happened. The loan row and its events are still
      // there; "deleted" would be a lie about this system.
      message: "Cancelled. The record of it stays, with your reason attached.",
    };
  } catch (error) {
    return toErrorState(error);
  }
}
