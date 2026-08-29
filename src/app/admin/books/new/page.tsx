import type { Metadata } from "next";

import { BookForm } from "@/app/admin/books/book-form";
import { StaffShell } from "@/components/layout/staff-shell";
import { Card } from "@/components/ui/card";
import { formatInTimezone } from "@/lib/dates";
import { safeBookListReturn } from "@/lib/return-to";
import { requirePermissionForPage } from "@/server/page-guards";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";
import { listCategories } from "@/server/services/catalogue-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add a book" };

/**
 * Add Book.
 *
 * The Book ID is deliberately not on this page. It is allocated by the database
 * inside the same transaction that creates the book — see server/lib/codes.ts —
 * so two people cataloguing at the same desk cannot be handed the same number,
 * and nobody has to remember where the numbering got to.
 */
export default async function NewBookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermissionForPage("book.create", {
    signedOutTo: "/login?next=/admin/books/new",
  });
  const from = (await searchParams).from;
  const returnTo = safeBookListReturn(Array.isArray(from) ? from[0] : from);
  const branding = await getBrandingSafe();
  const { settings } = await getCurrentLibrary();
  const categories = await listCategories(actor.libraryId);

  return (
    <StaffShell branding={branding} actor={actor} title="Add a book">
      <Card className="max-w-2xl">
        <BookForm
          mode="create"
          categories={categories.map((category) => ({
            id: category.id,
            name: category.name,
            icon: category.icon,
          }))}
          // Today in the *library's* timezone. A server in another part of the
          // world must not pre-fill yesterday's date.
          today={formatInTimezone(new Date(), settings.timezone, "yyyy-MM-dd")}
          returnTo={returnTo}
        />
      </Card>
    </StaffShell>
  );
}
