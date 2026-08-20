import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";

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
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  // No `weight` list: next/font refuses axes unless the family is loaded
  // variable, and variable is the whole reason for choosing this face.
  axes: ["SOFT", "WONK", "opsz"],
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
