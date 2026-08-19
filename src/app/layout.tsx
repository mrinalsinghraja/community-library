import type { Metadata, Viewport } from "next";
import { Nunito_Sans, Quicksand } from "next/font/google";

import { getBrandingSafe } from "@/server/lib/settings";

import "./globals.css";

/**
 * Fonts are self-hosted by next/font at build time — no request ever leaves the
 * child's browser for a font, which is both a privacy property and the reason
 * connect-src can stay 'self'.
 */
/*
 * Quicksand echoes the geometric, wide-apertured sans on the library's own
 * wordmark, so a heading and the mark beside it read as one piece of design.
 */
const quicksand = Quicksand({
  subsets: ["latin"],
  variable: "--font-quicksand",
  display: "swap",
  weight: ["500", "600", "700"],
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
    <html lang="en" className={`${quicksand.variable} ${nunito.variable}`}>
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
