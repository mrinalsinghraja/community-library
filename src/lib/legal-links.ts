/**
 * The policy links, in the order a person looks for them.
 *
 * A module constant rather than inline JSX so `tests/unit/legal.test.ts` can
 * assert that every href here is a route that exists — a footer link to a page
 * nobody built is the specific failure this row is supposed to prevent.
 *
 * Its own file, rather than living in `site-shell.tsx`, because that shell now
 * imports a server action to put "Sign out" in the masthead — which drags
 * Auth.js in behind it, and a plain list of four hrefs should not need a
 * runtime to be read.
 */
export const LEGAL_LINKS: readonly { href: string; label: string }[] = [
  { href: "/privacy", label: "Privacy notice" },
  { href: "/terms", label: "Terms of use" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/contact", label: "Contact us" },
] as const;
