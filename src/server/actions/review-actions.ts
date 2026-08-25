"use server";

import { revalidatePath } from "next/cache";

import { REVIEW_MESSAGES, isRating } from "@/lib/reviews";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  decideReview,
  deleteReviewForever,
  submitReview,
  withdrawOwnReview,
} from "@/server/services/review-service";

/**
 * Rating form actions.
 *
 * Thin, like the circulation actions and for the same reason: **no
 * authorization decision is made in this file.** Every service call below
 * resolves the actor from the session and enforces its own rule, so a
 * hand-written POST to one of these endpoints is refused exactly as a hidden
 * button is. In particular:
 *
 *   * "you must have borrowed this book" is checked in `submitReview` against
 *     the loan table;
 *   * "a published review cannot be edited or withdrawn" is checked against the
 *     row's own status, not against whether the browser drew a button;
 *   * `review.moderate` and `review.delete` are required inside `decideReview`
 *     and `deleteReviewForever`, and the second is held by the Super Admin
 *     alone.
 *
 * Who is acting is never a form field.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one makes every action in the file fail at module evaluation, and
 * `next build` compiles it happily — it shows up on the first real submit.
 */

export interface ReviewFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function toErrorState(error: unknown): ReviewFormState {
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
 * Every surface a rating is visible on.
 *
 * The shelf and the search results carry the average, so an approval changes
 * pages nobody was looking at. `/my-books` is here because the reminder card is
 * what sent the reader, and it has to be one book shorter when they get back.
 */
function revalidateReviews(code?: string): void {
  if (code) revalidatePath(`/books/${encodeURIComponent(code)}`);
  revalidatePath("/books");
  revalidatePath("/my-books");
  revalidatePath("/my-reviews");
  revalidatePath("/desk/reviews");
  revalidatePath("/desk");
}

export async function submitReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const code = String(formData.get("code") ?? "");

  try {
    const rating = Number.parseInt(String(formData.get("rating") ?? ""), 10);
    // Checked here as well as in the service, because "no stars chosen at all"
    // deserves the sentence that names the missing field rather than the
    // service's more general refusal.
    if (!isRating(rating)) {
      throw new ValidationError({ rating: REVIEW_MESSAGES.needRating });
    }

    await submitReview({
      code,
      rating,
      review: String(formData.get("review") ?? ""),
      // Anything other than the explicit opt-out means named. A missing field
      // must never silently publish a name that was not chosen, and a missing
      // checkbox in HTML is indistinguishable from an unchecked one — so the
      // control is a radio pair, and this reads its value.
      attribution: formData.get("attribution") === "ANONYMOUS" ? "ANONYMOUS" : "FIRST_NAME",
    });

    revalidateReviews(code);
    return { status: "success", message: REVIEW_MESSAGES.waiting };
  } catch (error) {
    return toErrorState(error);
  }
}

/** A reader taking back a review the desk has not answered yet. */
export async function withdrawReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const code = String(formData.get("code") ?? "");

  try {
    await withdrawOwnReview(code);
    revalidateReviews(code);
    return { status: "success", message: "Taken back. You can always rate it again." };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * A librarian or the Super Admin answering one review.
 *
 * The reason is optional on an approval and is shown to the author on a
 * decline — the same shape as a borrow request the desk turns down. A child
 * told "no" and nothing else has been refused by a machine.
 */
export async function decideReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  try {
    const approve = formData.get("approve") === "true";
    await decideReview(
      String(formData.get("reviewId") ?? ""),
      approve,
      String(formData.get("note") ?? ""),
    );

    revalidateReviews();
    return {
      status: "success",
      message: approve ? "Published on the book's page." : "Sent back to the reader.",
    };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * The Super Admin erasing a published review. Irreversible.
 *
 * The reason is required rather than optional, and the service refuses without
 * one: this is the only way a published review can ever leave the shelf, and a
 * deletion nobody can account for afterwards is worse than no control at all.
 */
export async function deleteReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  try {
    await deleteReviewForever(
      String(formData.get("reviewId") ?? ""),
      String(formData.get("reason") ?? ""),
    );

    revalidateReviews();
    return { status: "success", message: "Deleted. This cannot be undone." };
  } catch (error) {
    return toErrorState(error);
  }
}
