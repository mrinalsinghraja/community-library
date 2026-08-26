"use server";

import { revalidatePath } from "next/cache";

import {
  RECOMMENDATION_MESSAGES,
  refreshRecommendations,
  type RecommendationFailure,
} from "@/server/services/recommendation-service";

/**
 * "Suggest something new."
 *
 * Thin, like every other action file here. **No authorization decision is made
 * in this file.** `refreshRecommendations` resolves the reader from the session
 * and takes no id at all, so there is no parameter a forged post could use to
 * ask for another child's suggestions.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one makes every action in it fail at module evaluation, and `next build`
 * compiles it happily — it shows up on the first real submit.
 */

export interface RecommendationFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

/** One sentence per way this can not work, in words written for a child. */
function messageFor(reason: RecommendationFailure): string {
  switch (reason) {
    case "too-new":
      return RECOMMENDATION_MESSAGES.tooNew;
    case "nothing-left":
      return RECOMMENDATION_MESSAGES.nothingLeft;
    case "busy":
      return RECOMMENDATION_MESSAGES.busy;
    case "out-of-fuel":
      return RECOMMENDATION_MESSAGES.outOfFuel;
    case "unavailable":
    case "failed":
      return RECOMMENDATION_MESSAGES.unavailable;
  }
}

export async function refreshRecommendationsAction(): Promise<RecommendationFormState> {
  const result = await refreshRecommendations();

  if (!result.ok) return { status: "error", message: messageFor(result.reason) };

  // The card is rendered from the stored row on the reader's own page, so the
  // page has to be re-read for the new picks to appear.
  revalidatePath("/my-books");
  return { status: "success" };
}
