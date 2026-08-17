"use server";

import { revalidatePath } from "next/cache";

import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import { requirePermission } from "@/server/authz";
import { purgeScheduledMedia, storeBookCover } from "@/server/services/media-service";
import {
  archiveBook,
  createBook,
  removeBookCover,
  restoreBook,
  updateBook,
  type BookInput,
} from "@/server/services/catalogue-service";

/**
 * Catalogue form actions.
 *
 * Thin by design: read the form, call the service, translate the result into
 * something a screen can render. **No authorization decision is made here.**
 * Every service entry point below calls `requirePermission` itself, so a
 * hand-written POST to this endpoint is refused exactly as a hidden button is.
 *
 * Nothing here trusts the request for identity or tenancy either: no user id,
 * no library id and no role arrives in a form field. The actor is resolved from
 * the session inside the service, every time.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one of these makes every action in the file fail at module evaluation,
 * and `next build` compiles it happily — it only shows up on the first real
 * submit.
 */

export interface BookFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Set on a successful add, so the screen can show the code that was issued. */
  createdCode?: string;
}

/** Pulls the book fields out of a FormData. Presentation in, domain out. */
function readBookInput(formData: FormData): BookInput {
  return {
    title: String(formData.get("title") ?? ""),
    author: String(formData.get("author") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    ageGroup: String(formData.get("ageGroup") ?? "") as BookInput["ageGroup"],
    condition: String(formData.get("condition") ?? "") as BookInput["condition"],
    status: String(formData.get("status") ?? "") as BookInput["status"],
    donorName: String(formData.get("donorName") ?? ""),
    donorFlat: String(formData.get("donorFlat") ?? ""),
    donatedOn: String(formData.get("donatedOn") ?? ""),
  };
}

/**
 * Stores an uploaded cover, if there is one.
 *
 * Returns the media id of an unclaimed object. If everything after this throws,
 * the object is never claimed and the daily sweeper collects it — which is why
 * there is no cleanup path here to get wrong. See docs/MEDIA.md.
 */
async function storeCoverIfPresent(
  formData: FormData,
  libraryId: string,
  uploadedById: string,
): Promise<string> {
  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) return "";

  const stored = await storeBookCover({
    libraryId,
    bytes: new Uint8Array(await file.arrayBuffer()),
    // Read, never trusted: validation reads the actual bytes.
    declaredMimeType: file.type,
    originalFilename: file.name,
    uploadedById,
  });
  return stored.mediaId;
}

function toErrorState(error: unknown): BookFormState {
  if (error instanceof ValidationError) {
    return {
      status: "error",
      message: "Some answers need a small fix.",
      fieldErrors: error.fieldErrors,
    };
  }
  return { status: "error", message: toFriendlyMessage(error) };
}

export async function createBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  let coverMediaId = "";

  try {
    // Also checked inside createBook. Called here only so an unauthorized
    // caller cannot make us write bytes to storage before being refused.
    const actor = await requirePermission("book.create");
    coverMediaId = await storeCoverIfPresent(formData, actor.libraryId, actor.userId);

    const created = await createBook({ ...readBookInput(formData), coverMediaId });

    revalidatePath("/admin/books");
    revalidatePath("/books");

    return {
      status: "success",
      createdCode: created.copyCode,
      message: created.createdNewTitle
        ? `Added ${created.title} as ${created.copyCode}.`
        : `Added another copy of ${created.title} as ${created.copyCode}.`,
    };
  } catch (error) {
    // The cover was stored before the failure. Purge it now rather than leaving
    // a picture nobody asked for sitting in storage until the nightly sweep.
    if (coverMediaId) await purgeScheduledMedia(coverMediaId).catch(() => undefined);
    return toErrorState(error);
  }
}

export async function updateBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  const copyId = String(formData.get("copyId") ?? "");
  let coverMediaId = "";

  try {
    const actor = await requirePermission("book.edit");
    coverMediaId = await storeCoverIfPresent(formData, actor.libraryId, actor.userId);

    await updateBook(copyId, { ...readBookInput(formData), coverMediaId });

    revalidatePath("/admin/books");
    revalidatePath("/books");

    return { status: "success", message: "Saved." };
  } catch (error) {
    if (coverMediaId) await purgeScheduledMedia(coverMediaId).catch(() => undefined);
    return toErrorState(error);
  }
}

export async function removeBookCoverAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  try {
    await removeBookCover(String(formData.get("copyId") ?? ""));
    revalidatePath("/admin/books");
    revalidatePath("/books");
    return { status: "success", message: "Cover picture removed." };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function archiveBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  try {
    await archiveBook(
      String(formData.get("copyId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/admin/books");
    revalidatePath("/books");
    return {
      status: "success",
      // Says what actually happened: the record is intact, the book is not on
      // the shelf. "Deleted" would be a lie about this system.
      message: "Archived. Its record and its donation are kept.",
    };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function restoreBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  try {
    await restoreBook(String(formData.get("copyId") ?? ""));
    revalidatePath("/admin/books");
    revalidatePath("/books");
    return { status: "success", message: "Back on the shelf." };
  } catch (error) {
    return toErrorState(error);
  }
}
