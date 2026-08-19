import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CoverThumbnail } from "@/components/library/cover-viewer";
import { Butterfly, LeafSprig } from "@/components/library/library-logo";
import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ageGroupLabel, statusDefinition } from "@/lib/catalogue";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import { getBrandingSafe } from "@/server/lib/settings";
import { getBookByCode } from "@/server/services/catalogue-service";
import { Icon } from "@/components/ui/icon";

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
 *
 * The cover is given real size and a shadow, because this is the one screen
 * where a child is deciding whether they want the book.
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
      <div className="relative mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <Butterfly className="drift pointer-events-none absolute right-4 top-6 w-9 opacity-60 sm:w-12" />

        <Link
          href="/books"
          className="inline-flex items-center gap-2 text-lg font-bold text-primary-deep"
        >
          <Icon name="arrowRight" className="rotate-180" />
          All the books
        </Link>

        <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-10">
          <div className="w-48 shrink-0 self-center sm:w-60 sm:self-start">
            <div className="overflow-hidden rounded-[var(--radius-card)] shadow-raise">
              {/*
                Tap it to see it properly. Nothing new is fetched and nowhere is
                navigated to — it is the same picture from the same authorised
                route, shown at a size a child can actually look at.
              */}
              <CoverThumbnail
                coverMediaId={book.coverMediaId}
                title={book.title}
                sizes="240px"
                className="rounded-none"
              />
            </div>
            {book.coverMediaId ? (
              <p className="mt-2 text-center text-base text-ink-soft">Tap the cover to see it bigger</p>
            ) : null}
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
              What to do next, in one sentence, in a panel that changes colour
              with the answer — but never *only* colour: the sentence itself
              says whether the book can be taken home today.
            */}
            <div
              className={`mt-8 flex items-start gap-3 rounded-[var(--radius-card)] px-5 py-4 text-lg ${
                status.onShelf ? "bg-success-wash text-ink" : "bg-surface-sunk text-ink"
              }`}
            >
              <Icon
                name={status.onShelf ? "check" : "info"}
                className={`mt-1 ${status.onShelf ? "text-success" : "text-ink-soft"}`}
              />
              <p>
                {status.onShelf
                  ? "Available — come and find it on the shelf, and ask a librarian when you would like to take it home."
                  : "This one is not on the shelf right now. Have a look at what else is waiting."}
              </p>
            </div>

            {/*
              The thank-you, rendered by the service exactly as the donor chose
              to be credited — named, flat only, or simply "a neighbour". The
              template never sees the raw donation, so it cannot say more than
              the donor agreed to.
            */}
            {book.donorAcknowledgement ? (
              <div className="relative mt-6 overflow-hidden rounded-[var(--radius-card)] bg-accent-wash px-5 py-4">
                <LeafSprig className="pointer-events-none absolute -bottom-2 right-2 w-12 opacity-30" />
                {/*
                  No drawn icon here. The sentence the service returns already
                  opens with a symbol of its own — adding a second one put two
                  marks in front of four words.
                */}
                <p className="relative text-lg text-ink">{book.donorAcknowledgement}</p>
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/books" size="lg" icon={<Icon name="shelf" />}>
                Find another book
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
