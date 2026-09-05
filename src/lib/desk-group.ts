import { DESK_DESTINATIONS, type DeskGroup } from "@/lib/desk-nav";

/**
 * Which cluster a desk screen belongs to, from its address.
 *
 * Longest matching door wins, so `/admin/books/new` is "Shelves" because
 * `/admin/books` is a door, and `/desk/members/<id>` is "People" because
 * `/desk/members` is. A screen under no door at all — `/account`, which staff
 * and readers share — belongs to no cluster and gets nothing.
 *
 * Kept out of `desk-nav.ts` on purpose: that file takes no argument about where
 * a person is standing, and a test holds it to that. This one exists precisely
 * to answer that question, for the eyebrow over the desk's title and nothing
 * else.
 */
export function deskGroupForPath(path: string): DeskGroup | null {
  let best: { length: number; group: DeskGroup } | null = null;
  for (const door of DESK_DESTINATIONS) {
    const matches = path === door.href || path.startsWith(`${door.href}/`);
    if (matches && (!best || door.href.length > best.length)) {
      best = { length: door.href.length, group: door.group };
    }
  }
  return best?.group ?? null;
}
