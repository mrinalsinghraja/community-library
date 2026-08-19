import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookForm } from "@/app/admin/books/book-form";
import { RemoveCoverButton } from "@/app/admin/books/cover-actions";
import { CoverThumbnail } from "@/components/library/cover-viewer";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/states";
import { formatInTimezone } from "@/lib/dates";
import { isAppError } from "@/server/lib/errors";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { getBookForStaff, listCategories } from "@/server/services/catalogue-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit book" };

/**
 * Edit one physical book.
 *
 * Worth being explicit about on screen, because it surprises people: the title,
 * author, shelf, reading age and cover belong to the *book*, so changing them
 * changes every copy the library holds of it. The condition, the status and the
 * donation belong to this object alone.
 */
export default async function EditBookPage({
  params,
}: {
  params: Promise<{ copyId: string }>;
}) {
  const actor = await requirePermissionForPage("book.edit", {
    signedOutTo: "/login?next=/admin/books",
  });
  const { copyId } = await params;
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();

  let book;
  try {
    book = await getBookForStaff(copyId);
  } catch (error) {
    // A book id from another library resolves to nothing, like any other
    // unknown id. The service decided that; this only renders it tidily.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const categories = await listCategories(actor.libraryId);

  return (
    <StaffShell branding={branding} actor={actor} title={book.title}>
      <p className="font-mono text-base text-ink-soft">{book.copyCode}</p>

      {book.archivedAt ? (
        <Callout tone="warn" title="This book is archived" className="mt-4 max-w-2xl">
          It was taken off the shelf on{" "}
          {formatInTimezone(book.archivedAt, settings.timezone)}. Put it back from the book list
          before editing it.
        </Callout>
      ) : null}

      <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="w-40 shrink-0">
          <CoverThumbnail coverMediaId={book.coverMediaId} title={book.title} sizes="160px" />
          {book.coverMediaId ? <RemoveCoverButton copyId={book.copyId} /> : null}
        </div>

        <Card className="max-w-2xl flex-1">
          <p className="mb-6 rounded-[var(--radius-field)] bg-primary-wash px-4 py-3 text-base text-ink">
            The title, author, shelf, age and cover belong to the book itself, so changing them
            changes every copy the library has. The condition, status and donation belong to this
            copy alone.
          </p>

          <BookForm
            mode="edit"
            categories={categories.map((category) => ({
              id: category.id,
              name: category.name,
              icon: category.icon,
            }))}
            today={formatInTimezone(new Date(), settings.timezone, "yyyy-MM-dd")}
            values={{
              copyId: book.copyId,
              copyCode: book.copyCode,
              title: book.title,
              author: book.authors.join(", "),
              categoryId: book.categoryId,
              ageGroup: book.ageGroup,
              condition: book.condition,
              status: book.status,
              donorName: book.donorName ?? "",
              donorFlat: book.donorApartment ?? "",
              donatedOn: book.donatedAt
                ? formatInTimezone(book.donatedAt, settings.timezone, "yyyy-MM-dd")
                : "",
              hasCover: Boolean(book.coverMediaId),
            }}
          />
        </Card>
      </div>
    </StaffShell>
  );
}
