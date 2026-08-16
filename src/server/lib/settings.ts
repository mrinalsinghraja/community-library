import "server-only";

import { cache } from "react";

import type { Library, LibrarySettings, Community } from "@prisma/client";

import { prisma } from "@/server/db";
import { NotFoundError } from "@/server/lib/errors";

/**
 * The single accessor for library configuration.
 *
 * Every business rule and every piece of branding is read from here. If you are
 * about to write a literal like `14`, `"Mana Jardin"`, `5`, or `"MJCL"` into a
 * component or a service, it belongs in this row instead.
 *
 * `cache()` deduplicates the query within one request, so calling this from ten
 * components costs one query.
 */

export interface ResolvedLibrary {
  community: Community;
  library: Library;
  settings: LibrarySettings;
}

/**
 * Version 1 runs a single library per deployment. The data model is already
 * multi-library, so when a second community arrives this becomes a lookup by
 * host or slug rather than a schema change.
 */
export const getCurrentLibrary = cache(async (): Promise<ResolvedLibrary> => {
  const library = await prisma.library.findFirst({
    orderBy: { createdAt: "asc" },
    include: { community: true, settings: true },
  });

  if (!library) {
    throw new NotFoundError(
      "No library row exists. Run `npm run db:seed` (development) or the production setup steps in docs/SETUP.md.",
    );
  }
  if (!library.settings) {
    throw new NotFoundError(
      `Library ${library.id} has no library_settings row. The seed creates both together.`,
    );
  }

  return { community: library.community, library, settings: library.settings };
});

/** Convenience accessor for the settings row alone. */
export async function getLibrarySettings(): Promise<LibrarySettings> {
  return (await getCurrentLibrary()).settings;
}

/**
 * Branding, resolved for rendering. Falls back to sensible defaults so a fresh
 * install renders correctly before an admin has uploaded anything.
 */
export interface Branding {
  communityName: string;
  libraryName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

export const getBranding = cache(async (): Promise<Branding> => {
  const { community, library, settings } = await getCurrentLibrary();

  return {
    communityName: community.name,
    libraryName: library.name,
    logoUrl: settings.logoUrl,
    faviconUrl: settings.faviconUrl,
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    welcomeMessage: settings.welcomeMessage ?? `Welcome to ${library.name} 📚`,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
  };
});

/**
 * Branding that never throws.
 *
 * The root layout renders on every request, including before the database has
 * been seeded and during a database outage. A configuration lookup must not be
 * able to turn that into a blank 500 for every page in the application, so this
 * falls back to neutral platform defaults and lets the page itself say what is
 * wrong.
 */
export async function getBrandingSafe(): Promise<Branding & { configured: boolean }> {
  try {
    return { ...(await getBranding()), configured: true };
  } catch {
    return {
      communityName: "Community",
      libraryName: "Children's Library",
      logoUrl: null,
      faviconUrl: null,
      primaryColor: "#1F6F5C",
      secondaryColor: "#E4572E",
      welcomeMessage: "Welcome to the children's library 📚",
      contactEmail: null,
      contactPhone: null,
      configured: false,
    };
  }
}

/**
 * True when the catalogue may be browsed without signing in.
 *
 * Defaults to MEMBER_ONLY for the Mana Jardin deployment: the catalogue holds no
 * child data, but the owner chose to keep the shelf behind the front door.
 */
export async function catalogueIsPubliclyVisible(): Promise<boolean> {
  const settings = await getLibrarySettings();
  return settings.catalogueVisibility === "PUBLIC";
}
