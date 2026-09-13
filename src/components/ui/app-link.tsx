import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Every link in the application, with prefetching off unless a link asks (ADR-073).
 *
 * Next's `<Link>` prefetches every link that scrolls into view. On a site of
 * static pages that is free. Here every page is dynamic -- each one reads the
 * session to draw its header -- so a prefetch is a real server render: a
 * function invocation, an edge request and Active CPU, for a page the visitor
 * has not asked for and usually never opens.
 *
 * Measured on production, 2026-09-13: one view of /rules fired 15 prefetch
 * requests to 8 routes. Over twelve hours every nav destination showed ~350
 * invocations, identical for public and desk pages alike. That was the nav
 * being prefetched on each page view, not visitors or crawlers. A catalogue page
 * of 24 book cards prefetches 24 book pages on top.
 *
 * With prefetching off, a link is fetched when it is clicked. That is one render
 * instead of sixteen, and on these pages it costs a few hundred milliseconds.
 * A link that genuinely benefits can still pass `prefetch`.
 *
 * `tests/unit/app-link.test.ts` fails if anything imports `next/link` directly.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
