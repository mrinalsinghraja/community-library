"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Tells the library which part of the site was opened (ADR-077).
 *
 * It sends the path and nothing else, to our own server and nobody else's, so
 * `connect-src 'self'` still holds. A visitor whose browser asks not to be
 * tracked is not counted at all.
 */
export function UsageBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
      if (pathname.startsWith("/report")) return;
      const body = new Blob([JSON.stringify({ path: pathname })], { type: "text/plain" });
      if (!navigator.sendBeacon?.("/api/usage/hit", body)) {
        void fetch("/api/usage/hit", { method: "POST", body, keepalive: true }).catch(() => {});
      }
    } catch {
      // Counting is never allowed to break a page.
    }
  }, [pathname]);

  return null;
}
