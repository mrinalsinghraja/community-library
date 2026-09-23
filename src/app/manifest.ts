import type { MetadataRoute } from "next";

import { getBrandingSafe } from "@/server/lib/settings";

/**
 * What a phone needs to put the library on its home screen.
 *
 * Parents open this site from a WhatsApp link, and the next time they want it
 * they have to find that message again. With a manifest, "Add to Home Screen"
 * gives them an icon that opens straight onto the library, full screen.
 *
 * There is deliberately no service worker. An offline copy of a page that
 * shows whether a book is on the shelf would be a wrong answer kept on the
 * phone; this is an icon and a name, nothing that caches a page.
 *
 * The name comes from branding, never a literal, so another community's
 * deployment gets its own. Cached for a day rather than rendered per request:
 * a browser asks for this file on page loads, and a database read for each one
 * would cost more than the name is worth keeping fresh.
 */

export const revalidate = 86400;

/** The page ground, so the splash screen and the first paint match. */
const GROUND = "#FDF8F0";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBrandingSafe();
  const shortName =
    branding.communityName.length > 0 && branding.communityName.length <= 15
      ? branding.communityName
      : "Library";

  return {
    name: branding.libraryName,
    short_name: shortName,
    description: `A free library for the children of ${branding.communityName}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: GROUND,
    theme_color: GROUND,
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/app-icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
