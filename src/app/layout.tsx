import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import localFont from "next/font/local";

import { getBrandingSafe } from "@/server/lib/settings";

import "./globals.css";

/**
 * Fonts are self-hosted by next/font at build time — no request ever leaves the
 * child's browser for a font, which is both a privacy property and the reason
 * connect-src can stay 'self'.
 */
/*
 * Fraunces for display.
 *
 * It replaces Quicksand, which was chosen to echo the wordmark and did — but a
 * wide rounded geometric sans set at 700 weight and 48px reads as a craft-fair
 * poster, and the library outgrew that. Fraunces is a low-contrast soft serif
 * drawn from mid-century children's-book and advertising lettering: it keeps
 * the warmth, and it belongs to books.
 *
 * The variable axes are the reason it is this face and not a stock serif.
 * `SOFT` rounds the terminals just enough to stay friendly for a six-year-old,
 * `WONK` lets a few letters keep their hand-drawn tilt, and `opsz` means a
 * 34px heading and a 20px card title are drawn differently rather than being
 * the same outline scaled.
 *
 * Weight stops at 600. The old system reached for 700 and 800 everywhere, and
 * a heavy face at a large size was half of why the interface looked babyish.
 */
const fraunces = localFont({
  /*
   * Fraunces as it is actually drawn here, cut down from the full family.
   *
   * Google serves Fraunces with all four axes — weight 100–900, SOFT 0–100,
   * WONK and opsz — at 118 KB for the Latin subset, and it was the heaviest
   * thing on every first visit, preloaded ahead of the page's own content.
   * These pages only ever set SOFT 40 and WONK 1, and never draw it lighter
   * than 400 or heavier than 700, so `fraunces-display.woff2` is that same
   * Latin subset with SOFT and WONK fixed at those values and weight kept
   * from 400 to 700: 60 KB. `opsz` stays a live axis — it is what the
   * comment above is about.
   *
   * Made with fontTools' instancer from the file next/font/google fetched.
   * Fraunces is under the SIL Open Font License 1.1 (Copyright 2020 The
   * Fraunces Project Authors), which permits exactly this.
   *
   * One visible difference, and a deliberate one: display text outside a
   * heading (a book card's title is a heading; the donors' quote is not)
   * used to get SOFT 0, because only h1–h4 set the axis. Now every piece of
   * display text has the same soft terminals.
   */
  src: "./fonts/fraunces-display.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-fraunces",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingSafe();

  return {
    title: {
      default: branding.libraryName,
      template: `%s · ${branding.libraryName}`,
    },
    description: `A free community library for young readers at ${branding.communityName}.`,
    applicationName: branding.libraryName,
    // This is a private community library, not a public web property.
    robots: { index: false, follow: false },
    icons: branding.faviconUrl ? { icon: branding.faviconUrl } : undefined,
    // Opened from a home-screen icon on an iPhone, it runs full screen under
    // the community's name — the Android half of this is src/app/manifest.ts.
    appleWebApp: { capable: true, title: branding.communityName, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: "#FDF8F0",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBrandingSafe();

  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable}`}>
      <body
        /*
         * Branding arrives as CSS custom properties, so a Super Admin changing
         * the primary colour restyles the application with no deploy and no
         * rebuild. Nothing downstream hard-codes a brand colour.
         */
        style={
          {
            "--brand-primary": branding.primaryColor,
            "--brand-secondary": branding.secondaryColor,
          } as React.CSSProperties
        }
      >
        <a href="#main" className="skip-link">
          Skip to the main part of the page
        </a>
        {children}
      </body>
    </html>
  );
}
