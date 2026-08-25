import "server-only";

import type { LibraryCardFacts } from "@/lib/library-card";
import { prisma } from "@/server/db";
import { requireActor } from "@/server/authz";
import { getBrandingSafe, getCurrentLibrary } from "@/server/lib/settings";

/**
 * One reader's own card.
 *
 * Ownership comes from the session and there is no id in the signature, so this
 * cannot be pointed at another child — the same shape as `getOwnMemberCard`,
 * and the reason there is no `/my-card/[id]`.
 *
 * Staff get `null` rather than an error. A librarian has no library card, that
 * is not a failure, and the page says so in a sentence instead of a 403.
 *
 * What comes back is bounded by `LibraryCardFacts`, which exists precisely so
 * that adding a field to the card is a decision somebody makes on purpose. No
 * guardian contact, no staff notes: see `OMITTED_FROM_CARD`.
 */
export async function getOwnLibraryCard(): Promise<LibraryCardFacts | null> {
  const actor = await requireActor();
  if (actor.kind !== "MEMBER") return null;

  const profile = await prisma.memberProfile.findUnique({
    where: { userId: actor.userId },
    select: {
      memberCode: true,
      apartment: true,
      birthYear: true,
      joinedAt: true,
      avatarKey: true,
      photoMediaId: true,
    },
  });
  if (!profile) return null;

  const branding = await getBrandingSafe();

  // Settings may be missing on an unconfigured library. The card still prints —
  // it simply carries no allowances, which is honest rather than broken.
  let rules: LibraryCardFacts["rules"] = null;
  try {
    const { settings } = await getCurrentLibrary();
    rules = {
      ageMin: settings.ageMin,
      ageMax: settings.ageMax,
      borrowingPeriodDays: settings.borrowingPeriodDays,
      maxActiveLoans: settings.maxActiveLoans,
    };
  } catch {
    rules = null;
  }

  return {
    readerName: actor.displayName,
    memberCode: profile.memberCode,
    apartment: profile.apartment,
    birthYear: profile.birthYear,
    joinedAt: profile.joinedAt,
    avatarKey: profile.avatarKey,
    photoMediaId: profile.photoMediaId,

    libraryName: branding.libraryName,
    communityName: branding.communityName,
    logoUrl: branding.logoUrl,

    rules,
  };
}
