"use server";

import { revalidatePath } from "next/cache";

import { REVIEW_MESSAGES, isRating } from "@/lib/reviews";
import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import {
  deleteOwnReview,
  setReviewHidden,
  submitReview,
} from "@/server/services/review-service";

/**
 * Rating form actions.
 *
 * Thin, like the circulation actions and for the same reason: **no
 * authorization decision is made in this file.** Every service call below
 * resolves the actor from the session and enforces its own rule, so a
 * hand-written POST to one of these endpoints is refused exactly as a hidden
 * button is. In particular, "you must have borrowed this book" is checked in
 * `submitReview` against the loan table — not here, and not in the browser.
 *
 * Nothing here trusts the form for identity. The only fields that arrive are
 * the book's printed code, a number of stars, some words and a yes/no about
 * being named. Who is writing is never a form field.
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
 * The shelf and the search results carry the average, so a new rating changes
 * pages the reader was not looking at. `/my-books` is here because the reminder
 * card is what sent them, and it has to be one book shorter when they get back.
 */
function revalidateReviews(code: string): void {
  revalidatePath(`/books/${encodeURIComponent(code)}`);
  revalidatePath("/books");
  revalidatePath("/my-books");
  revalidatePath("/my-reviews");
  revalidatePath("/desk/reviews");
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
    return { status: "success", message: REVIEW_MESSAGES.saved };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function deleteReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const code = String(formData.get("code") ?? "");

  try {
    await deleteOwnReview(code);
    revalidateReviews(code);
    return { status: "success", message: "Taken down. You can always rate it again." };
  } catch (error) {
    return toErrorState(error);
  }
}

/**
 * A librarian taking a review off the public page, or putting it back.
 *
 * Guarded by `book.edit` inside the service. The reason is optional and is for
 * the library's own record — it is never shown to the child, because "a grown-up
 * removed this" is a conversation to have in person, not a notice on a screen.
 */
export async function setReviewHiddenAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  try {
    const hidden = formData.get("hidden") === "true";
    await setReviewHidden(
      String(formData.get("reviewId") ?? ""),
      hidden,
      String(formData.get("reason") ?? ""),
    );

    revalidatePath("/desk/reviews");
    revalidatePath("/books");
    return {
      status: "success",
      message: hidden ? "Taken down from the book's page." : "Back on the book's page.",
    };
  } catch (error) {
    return toErrorState(error);
  }
}
