"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { bookListWithNotice, safeBookListReturn } from "@/lib/return-to";

import { toFriendlyMessage, ValidationError } from "@/server/lib/errors";
import { requirePermission } from "@/server/authz";
import { purgeScheduledMedia, storeBookCover } from "@/server/services/media-service";
import {
  archiveBook,
  deleteBook,
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
 * Adding and editing a book both end in `redirect` rather than in a success
 * state. Two reasons, and the second is the one that matters: a form left
 * sitting there still holds the book that was just saved, so the next press of
 * a save button adds a second copy of it — and the librarian's next job is
 * never this book again, it is the list they were working through.
 *
 * `redirect` throws, so it is called after the try/catch rather than inside it.
 * Called inside, the catch would treat the redirect as a failure, report "not
 * saved" for a book that was saved, and purge the cover that was just stored.
 *
 * NOTE: a "use server" file may export only async functions. Exporting a const
 * from one of these makes every action in the file fail at module evaluation,
 * and `next build` compiles it happily — it only shows up on the first real
 * submit.
 */

/**
 * What the librarian typed, handed back so a refused form can be refilled.
 *
 * React resets an uncontrolled form once its action returns, so a form whose
 * `defaultValue`s came only from the database comes back blank after any
 * refusal — ten fields retyped because of one wrong picture. These are the
 * defaults the form falls back to instead.
 *
 * Strings exactly as submitted, never re-validated on the way out: the point is
 * to show somebody what they wrote, including the part that was wrong, so they
 * can see it and fix it. They go back to the browser that sent them and nowhere
 * else, and React escapes them on the way into the attribute.
 *
 * The cover picture is not here. It never left the browser in a form the server
 * could hand back, so the form re-attaches the librarian's own File itself —
 * see `CoverField`.
 */
export interface BookFormSubmission {
  title: string;
  author: string;
  categoryId: string;
  ageGroup: string;
  condition: string;
  status: string;
  donorName: string;
  donorFlat: string;
  donatedOn: string;
  donorAnonymous: boolean;
}

export interface BookFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: BookFormSubmission;
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
    // Unticked means "publish the name", which is the library's default and the
    // wording the desk uses. An absent checkbox is unticked.
    donorAnonymous: formData.get("donorAnonymous") !== null,
  };
}

/**
 * The list the librarian came from, as they sent it back.
 *
 * Checked rather than used: `safeBookListReturn` accepts the book list and
 * nothing else, so a hand-written POST cannot turn "save this book" into a
 * redirect to somebody else's website.
 */
function readReturnTo(formData: FormData): string {
  return safeBookListReturn(String(formData.get("returnTo") ?? ""));
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

/** Reads the form back out for redisplay. See `BookFormSubmission`. */
function readSubmission(formData: FormData): BookFormSubmission {
  const text = (name: string) => String(formData.get(name) ?? "");

  return {
    title: text("title"),
    author: text("author"),
    categoryId: text("categoryId"),
    ageGroup: text("ageGroup"),
    condition: text("condition"),
    status: text("status"),
    donorName: text("donorName"),
    donorFlat: text("donorFlat"),
    donatedOn: text("donatedOn"),
    donorAnonymous: formData.get("donorAnonymous") !== null,
  };
}

/**
 * A refusal, and — for the two actions that render the book form — the answers
 * that were refused. The buttons that archive or delete a book have nothing to
 * refill, so they pass no form.
 */
function toErrorState(error: unknown, formData?: FormData): BookFormState {
  const values = formData ? readSubmission(formData) : undefined;

  if (error instanceof ValidationError) {
    return {
      status: "error",
      message: "Some answers need a small fix.",
      fieldErrors: error.fieldErrors,
      values,
    };
  }
  return { status: "error", message: toFriendlyMessage(error), values };
}

export async function createBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  let coverMediaId = "";
  let destination: string;

  try {
    // Also checked inside createBook. Called here only so an unauthorized
    // caller cannot make us write bytes to storage before being refused.
    const actor = await requirePermission("book.create");
    coverMediaId = await storeCoverIfPresent(formData, actor.libraryId, actor.userId);

    const created = await createBook({ ...readBookInput(formData), coverMediaId });

    revalidatePath("/admin/books");
    revalidatePath("/books");

    destination = bookListWithNotice(readReturnTo(formData), "added", created.copyCode);
  } catch (error) {
    // The cover was stored before the failure. Purge it now rather than leaving
    // a picture nobody asked for sitting in storage until the nightly sweep.
    if (coverMediaId) await purgeScheduledMedia(coverMediaId).catch(() => undefined);
    return toErrorState(error, formData);
  }

  redirect(destination);
}

export async function updateBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  const copyId = String(formData.get("copyId") ?? "");
  let coverMediaId = "";
  let destination: string;

  try {
    const actor = await requirePermission("book.edit");
    coverMediaId = await storeCoverIfPresent(formData, actor.libraryId, actor.userId);

    const saved = await updateBook(copyId, { ...readBookInput(formData), coverMediaId });

    revalidatePath("/admin/books");
    revalidatePath("/books");

    destination = bookListWithNotice(readReturnTo(formData), "saved", saved.copyCode);
  } catch (error) {
    if (coverMediaId) await purgeScheduledMedia(coverMediaId).catch(() => undefined);
    return toErrorState(error, formData);
  }

  redirect(destination);
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

/**
 * Erasing a duplicate, and only a duplicate.
 *
 * The service refuses anything with a history. This action carries no
 * cleverness of its own: it passes the id and the reason, and reports what came
 * back — including the refusal, which is the answer a librarian most needs to
 * read.
 */
export async function deleteBookAction(
  _previous: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  try {
    const { copyCode } = await deleteBook(
      String(formData.get("copyId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/admin/books");
    revalidatePath("/books");
    return {
      status: "success",
      message: `${copyCode} has been removed. The audit log keeps a note of what it was.`,
    };
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
