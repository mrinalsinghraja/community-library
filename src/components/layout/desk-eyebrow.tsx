"use client";

import { usePathname } from "next/navigation";

import { deskGroupForPath } from "@/lib/desk-group";

/**
 * The cluster's name over the desk's title — "Lending", "People".
 *
 * The same small capitals the masthead uses for the library's name and a
 * content page uses for its section, so every screen on the site opens the
 * same way. Reads the address, like `NavLink`, and nothing else; rendered
 * empty on a screen that belongs to no cluster.
 */
export function DeskEyebrow() {
  const group = deskGroupForPath(usePathname());
  if (!group) return null;

  return (
    /* 80% white, which is where AA stops on the lightest patch of the band. */
    <p className="relative mb-2 text-xs font-bold uppercase tracking-[0.18em] text-white/80">
      {group}
    </p>
  );
}
