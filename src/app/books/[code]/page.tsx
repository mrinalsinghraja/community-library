import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BookCover } from "@/components/library/book-cover";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ageGroupLabel, statusDefinition } from "@/lib/catalogue";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import { getBrandingSafe } from "@/server/lib/settings";
import { getBookByCode } from "@/server/services/catalogue-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A book" };

/**
 * One book's page.
 *
 * The URL carries the code printed on the book's own label — the thing a child
 * can read off the object in their hand — and not a database id.
 *
 * What is deliberately absent: internal ids, audit information, storage paths,
 * staff notes, the book's condition, and anything at all about who has borrowed
 * it. **No child's name appears anywhere in this catalogue.** That is not a
 * rendering choice; `ReaderBookDetail` has no field to put one in, so a future
 * edit to this template cannot leak one by accident.
 */
export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const branding = await getBrandingSafe();
  const actor = await getActor();
  const { code } = await params;

  let book;
  try {
    book = await getBookByCode(decodeURIComponent(code));
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_AUTHENTICATED") {
      redirect(`/login?next=/books/${encodeURIComponent(code)}`);
    }
    if (isAppError(error) && error.code === "NOT_FOUND") {
      // A signed-out visitor to a member-only catalogue lands here too, and
      // gets the same answer as somebody asking for a book that never existed.
      if (!actor) redirect(`/login?next=/books/${encodeURIComponent(code)}`);
      notFound();
    }
    throw error;
  }

  const status = statusDefinition(book.status);

  return (
    <PublicShell branding={branding} signedIn={Boolean(actor)}>
      <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <Link href="/books" className="text-lg font-bold text-primary-deep">
          ← All the books
        </Link>

        <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-10">
          <div className="w-44 shrink-0 self-center sm:w-56 sm:self-start">
            <BookCover coverMediaId={book.coverMediaId} title={book.title} sizes="224px" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-4xl leading-tight">{book.title}</h1>
            <p className="mt-2 text-xl text-ink-soft">{book.authors.join(", ")}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <StatusBadge tone="neutral">
                <span aria-hidden="true">{book.categoryIcon ?? "📚"}</span> {book.categoryName}
              </StatusBadge>
              <StatusBadge tone="neutral">{ageGroupLabel(book.ageGroup)}</StatusBadge>
              <StatusBadge tone={status.tone}>
                <span aria-hidden="true">{status.mark}</span> {status.readerLabel}
              </StatusBadge>
            </div>

            {/*
              The thank-you, rendered by the service exactly as the donor chose
              to be credited — named, flat only, or simply "a neighbour". The
              template never sees the raw donation, so it cannot say more than
              the donor agreed to.
            */}
            {book.donorAcknowledgement ? (
              <p className="mt-8 rounded-[var(--radius-card)] bg-accent-wash px-5 py-4 text-lg text-ink">
                {book.donorAcknowledgement}
              </p>
            ) : null}

            <p className="mt-8 text-lg text-ink-soft">
              {status.onShelf
                ? "Come and find it on the shelf, and ask a librarian when you would like to take it home."
                : "This one is not on the shelf right now. Have a look at what else is waiting."}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/books" size="lg" icon="📚">
                Find another book
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
