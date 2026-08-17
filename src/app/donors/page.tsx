import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PublicShell } from "@/components/layout/site-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { getActor } from "@/server/authz";
import { isAppError } from "@/server/lib/errors";
import { getBrandingSafe } from "@/server/lib/settings";
import { listDonorCredits } from "@/server/services/catalogue-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thank you, book donors" };

/**
 * Thank You, Book Donors.
 *
 * Read the code behind this page and the most striking thing is what it does
 * not compute. There is no count, no total, no ordering by generosity, no
 * "top donor", no badge and no comparison between families. Every donor appears
 * exactly once, alphabetically, in the words they chose to be credited by.
 *
 * That is a product decision, not an unfinished feature. A family who gave
 * thirty books and a family who gave one gave the same thing: a book to a child
 * who did not have it. And a family who cannot afford to give at all must be
 * able to open this page without being shown where they rank — which is why
 * donating is never a condition of membership either.
 */
export default async function DonorsPage() {
  const branding = await getBrandingSafe();
  const actor = await getActor();

  let credits;
  try {
    credits = await listDonorCredits();
  } catch (error) {
    // Same gate as the catalogue itself: member-only by default.
    if (isAppError(error) && (error.code === "NOT_AUTHENTICATED" || error.code === "NOT_FOUND")) {
      redirect("/login?next=/donors");
    }
    throw error;
  }

  return (
    <PublicShell branding={branding} signedIn={Boolean(actor)}>
      <div className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <h1 className="text-4xl sm:text-5xl">Thank You, Book Donors ❤️</h1>
        <p className="mt-4 max-w-2xl text-xl text-ink-soft">
          Every book on our shelves is a gift to our young readers. Thank you to the families who
          have shared books with our community.
        </p>

        <div className="mt-12">
          {credits.length === 0 ? (
            <EmptyState
              illustration="🎁"
              title="Our first gift is still to come"
              action={
                <ButtonLink href="/books" variant="secondary" size="lg" icon="📚">
                  See the books
                </ButtonLink>
              }
            >
              When a family shares a book with the library, we will say thank you right here.
            </EmptyState>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {credits.map((credit) => (
                <li
                  key={credit.acknowledgement}
                  className="rounded-[var(--radius-card)] bg-surface px-5 py-4 text-lg text-ink shadow-lift"
                >
                  {credit.acknowledgement}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-14 max-w-2xl text-lg text-ink-soft">
          Sharing a book is always a choice. Joining the library is free, and it never depends on
          giving one.
        </p>
      </div>
    </PublicShell>
  );
}
