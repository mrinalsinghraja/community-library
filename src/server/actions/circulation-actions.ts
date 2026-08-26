"use server";

import { revalidatePath } from "next/cache";

import { isCondition } from "@/lib/catalogue";
import {
  BORROW_REQUEST_MESSAGES,
  RENEWAL_REQUEST_MESSAGES,
  RETURN_ANNOUNCEMENT_MESSAGES,
} from "@/lib/circulation";
import type { BulkResult } from "@/lib/bulk";
import { limitBulkSelection, runBulk } from "@/server/lib/bulk";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  announceReturn,
  cancelLoan,
  cancelOwnBorrowRequest,
  cancelOwnRenewalRequest,
  decideBorrowRequest,
  decideRenewalRequest,
  issueBook,
  listLoansForStaff,
  listPendingBorrowRequests,
  listPendingRenewalRequests,
  renewLoan,
  requestBorrow,
  requestRenewal,
  returnBook,
  withdrawReturnAnnouncement,
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
  revalidatePath("/desk/renewals");
  revalidatePath("/desk/requests");
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

/**
 * A child asks to keep a book.
 *
 * The form sends a **book code** — the one printed on the book they are
 * holding — and nothing else. No loan id, no member id, no library id. The
 * service resolves it against the signed-in child's own active loans, so a code
 * belonging to somebody else's loan finds nothing, and there is no field here
 * that could be edited into another child's record.
 */
export async function requestRenewalAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await requestRenewal({ code: String(formData.get("code") ?? "") });
    revalidateCirculation();
    return { status: "success", message: RENEWAL_REQUEST_MESSAGES.pending };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function cancelRenewalRequestAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await cancelOwnRenewalRequest({ code: String(formData.get("code") ?? "") });
    revalidateCirculation();
    return { status: "success", message: RENEWAL_REQUEST_MESSAGES.cancelled };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * A reader says a book is coming back.
 *
 * Same shape as the renewal ask above and for the same reason: the code is the
 * only input, and a code belonging to somebody else's loan finds nothing.
 */
export async function announceReturnAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await announceReturn({ code: String(formData.get("code") ?? "") });
    revalidateCirculation();
    return { status: "success", message: RETURN_ANNOUNCEMENT_MESSAGES.done };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function withdrawReturnAnnouncementAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await withdrawReturnAnnouncement({ code: String(formData.get("code") ?? "") });
    revalidateCirculation();
    return { status: "success", message: RETURN_ANNOUNCEMENT_MESSAGES.keptBack };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * A librarian answers a request.
 *
 * The decision arrives as a form value and is narrowed here to the two words
 * the service accepts — anything else is a decline, which is the safe direction
 * for a value that arrived over the wire: a malformed submit can never extend a
 * loan by accident.
 */
export async function decideRenewalRequestAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    const decision = String(formData.get("decision") ?? "") === "APPROVE" ? "APPROVE" : "DECLINE";

    const result = await decideRenewalRequest({
      requestId: String(formData.get("requestId") ?? ""),
      decision,
      reason: String(formData.get("reason") ?? ""),
    });

    revalidateCirculation();

    return {
      status: "success",
      message:
        result.decision === "APPROVE"
          ? `${result.title} stays with ${result.readerName} for longer.`
          : `${result.readerName} has been told about ${result.title}.`,
    };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * A child asks for a book.
 *
 * The code arrives in a form field and nothing else does — no member id, no
 * copy id, no library. Who is asking comes from the session inside the service,
 * so there is no field here anybody could edit to ask on another child's
 * behalf.
 */
export async function requestBorrowAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await requestBorrow({ code: String(formData.get("code") ?? "") });
    revalidateCirculation();
    return { status: "success", message: BORROW_REQUEST_MESSAGES.pending };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function cancelBorrowRequestAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    await cancelOwnBorrowRequest({ code: String(formData.get("code") ?? "") });
    revalidateCirculation();
    return { status: "success", message: BORROW_REQUEST_MESSAGES.cancelled };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * A librarian answers a request for a book.
 *
 * Same narrowing as the renewal decision, and for the same reason: anything
 * that is not exactly "APPROVE" is a decline, so a malformed submit can never
 * send a book home with a child by accident.
 */
export async function decideBorrowRequestAction(
  _previous: CirculationFormState,
  formData: FormData,
): Promise<CirculationFormState> {
  try {
    const decision = String(formData.get("decision") ?? "") === "APPROVE" ? "APPROVE" : "DECLINE";

    const result = await decideBorrowRequest({
      requestId: String(formData.get("requestId") ?? ""),
      decision,
      reason: String(formData.get("reason") ?? ""),
    });

    revalidateCirculation();

    return {
      status: "success",
      message:
        result.decision === "APPROVE"
          ? `${result.title} is ready for ${result.readerName} to collect.`
          : `${result.readerName} has been told about ${result.title}.`,
    };
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

// ---------------------------------------------------------------------------
// Doing it to several at once
// ---------------------------------------------------------------------------

/*
 * Every one of these is the row's own action, run once per ticked row, through
 * `runBulk`. No bulk query, no relaxed rule, no second code path — see
 * src/server/lib/bulk.ts for why that is the whole safety argument.
 *
 * The labels come from the same list the screen is showing, so a failure names
 * a child and a book rather than a uuid. They are fetched here rather than sent
 * by the browser: a label that came from the client would be a sentence the
 * server repeats without knowing whether it is true.
 */

export async function bulkDecideBorrowRequestsAction(
  ids: string[],
  action: string,
  note: string,
): Promise<BulkResult> {
  const decision = action === "APPROVE" ? "APPROVE" : "DECLINE";
  const chosen = limitBulkSelection(ids);

  const rows = await listPendingBorrowRequests();
  const labels = new Map(rows.map((row) => [row.requestId, `${row.title} for ${row.readerName}`]));

  const result = await runBulk(
    chosen,
    (id) => labels.get(id) ?? "That request",
    (id) => decideBorrowRequest({ requestId: id, decision, reason: note }),
  );

  revalidateCirculation();
  return result;
}

export async function bulkDecideRenewalsAction(
  ids: string[],
  action: string,
  note: string,
): Promise<BulkResult> {
  const decision = action === "APPROVE" ? "APPROVE" : "DECLINE";
  const chosen = limitBulkSelection(ids);

  const rows = await listPendingRenewalRequests();
  const labels = new Map(rows.map((row) => [row.requestId, `${row.title} for ${row.readerName}`]));

  const result = await runBulk(
    chosen,
    (id) => labels.get(id) ?? "That ask",
    (id) => decideRenewalRequest({ requestId: id, decision, reason: note }),
  );

  revalidateCirculation();
  return result;
}

/**
 * Taking several books back at once.
 *
 * The condition is deliberately not offered here and is therefore left
 * unchanged on every copy, exactly as omitting it does on the single-row form.
 * A bulk condition control would be a librarian asserting that six books they
 * have not looked at are all Good — which is the one thing the per-row
 * "Check it first" step exists to prevent. Anything that needs a closer look
 * goes back one at a time.
 */
export async function bulkReturnLoansAction(ids: string[]): Promise<BulkResult> {
  const chosen = limitBulkSelection(ids);

  const page = await listLoansForStaff({ filter: "active" });
  const labels = new Map(page.items.map((row) => [row.loanId, `${row.title} from ${row.readerName}`]));

  const result = await runBulk(
    chosen,
    (id) => labels.get(id) ?? "That book",
    (id) => returnBook({ loanId: id }),
  );

  revalidateCirculation();
  return result;
}
