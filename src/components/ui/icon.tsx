import { cn } from "@/lib/cn";

/**
 * The icon set.
 *
 * Drawn here rather than installed. A library of 1,500 icons would ship a
 * dependency, a build step and a licence for the fifteen shapes this
 * application actually uses — and it would still not be *this* library's hand.
 *
 * One grid, one weight, one join. Every glyph is 24×24, stroked at 2 with round
 * caps and round joins, and painted in `currentColor` so an icon always matches
 * the text beside it and can never fall out of step with a theme change.
 *
 * Accessibility: an icon is decorative by default and hidden from screen
 * readers, because every one of them in this application sits next to a visible
 * word. Pass a `label` only when an icon genuinely stands alone, and it becomes
 * an `img` with an accessible name.
 */

export type IconName =
  | "book"
  | "shelf"
  | "myBooks"
  | "search"
  | "filter"
  | "age"
  | "calendar"
  | "renew"
  | "check"
  | "cross"
  | "plus"
  | "reader"
  | "staff"
  | "settings"
  | "audit"
  | "branding"
  | "gift"
  | "home"
  | "key"
  | "sparkle"
  | "arrowRight"
  | "issue"
  | "returnBook"
  | "heart"
  | "info"
  | "save"
  | "upload"
  | "trash"
  | "archive"
  | "mail"
  | "camera"
  | "signOut"
  | "card"
  | "refresh"
  | "handshake"
  | "star"
  | "quote"
  | "hide";

/** The drawn part of each glyph, on a 24×24 grid. */
const PATHS: Record<IconName, React.ReactNode> = {
  book: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 0 4 20.5V4.5Z" />
      <path d="M4 17.5A1.5 1.5 0 0 1 5.5 16H19" />
    </>
  ),
  shelf: (
    <>
      <path d="M5 4v12M9.5 7v9M14 5v11M18.5 8v8" />
      <path d="M3 19h18" />
    </>
  ),
  myBooks: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15.5a1 1 0 0 1-1.6.8L14 18l-3.4 2.3a1 1 0 0 1-1.6-.8V4.5Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>
  ),
  age: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  renew: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  reader: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="7.5" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.2 3.2 0 0 1 0 6.2M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </>
  ),
  audit: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
    </>
  ),
  branding: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.7-.8 1.7-1.6 0-.9-.7-1.4-.7-2.2 0-.8.7-1.4 1.5-1.4h1.3a4.7 4.7 0 0 0 4.7-4.7c0-3.9-3.7-7.1-8.5-7.1Z" />
      <circle cx="8.5" cy="11" r="1.1" />
      <circle cx="12" cy="8" r="1.1" />
      <circle cx="15.5" cy="11" r="1.1" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="9.5" width="17" height="11" rx="2" />
      <path d="M3.5 13.5h17M12 9.5v11" />
      <path d="M12 9.5S10.5 3.5 7.8 3.5a2.2 2.2 0 0 0 0 4.4h4.2M12 9.5s1.5-6 4.2-6a2.2 2.2 0 0 1 0 4.4H12" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <path d="m11.5 11.5 8 8M17 17l-2 2M19.5 14.5l-2 2" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z" />
      <path d="M18.5 16.5 19.2 18.6l2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </>
  ),
  issue: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16a1 1 0 0 1 1 1v8" />
      <path d="M4 4.5v16A1.5 1.5 0 0 1 5.5 19H12" />
      <path d="M16 16h6M19 13v6" />
    </>
  ),
  returnBook: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H18a1 1 0 0 1 1 1v9" />
      <path d="M4 4.5v16A1.5 1.5 0 0 1 5.5 19H13" />
      <path d="M22 18h-6M19 15l-3 3 3 3" />
    </>
  ),
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  save: (
    <>
      <path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h9L19.5 8.5v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11Z" />
      <path d="M8 4.5v5h6v-5M8 19.5v-5h8v5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4.5M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.5" />
      <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.8 6.5 7.3 5.6a1.5 1.5 0 0 0 1.8 0l7.3-5.6" />
    </>
  ),
  camera: (
    <>
      <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h2L9 4.5h6l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  signOut: (
    <>
      <path d="M14.5 4.5h-7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7" />
      <path d="M11 12h10M18 8.5l3 3.5-3 3.5" />
    </>
  ),
  card: (
    <>
      <rect x="2.8" y="5" width="18.4" height="14" rx="2.5" />
      <path d="M2.8 9.8h18.4" />
      <path d="M6.5 14.5h4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  /*
   * Outline only. The star row draws its own filled and half-filled shapes,
   * because a fill is the whole information there and `Icon` paints nothing.
   * This one is for the places that want a star as furniture — a heading, a
   * button — rather than as a measurement.
   */
  star: (
    <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9L12 3.5Z" />
  ),
  quote: (
    <>
      <path d="M9 7c-2.2 0-4 1.8-4 4s1.8 4 4 4c0 2-1 3.5-3 4.5" />
      <path d="M19 7c-2.2 0-4 1.8-4 4s1.8 4 4 4c0 2-1 3.5-3 4.5" />
    </>
  ),
  hide: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.3 3.4" />
      <path d="M6.3 6.9C3.9 8.4 3 10.5 3 12c0 2.5 4 7 9 7a9.4 9.4 0 0 0 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  handshake: (
    <>
      <path d="M8.5 12.5 6 10a1.8 1.8 0 0 1 0-2.6l1.4-1.4a1.8 1.8 0 0 1 2.6 0l1.9 1.9 2-2a1.8 1.8 0 0 1 2.6 0L18 7.4a1.8 1.8 0 0 1 0 2.6l-4.6 4.6a1.5 1.5 0 0 1-2.2 0Z" />
      <path d="m13.5 14.5 2.5 2.5M11 16l2 2" />
    </>
  ),
};

export function Icon({
  name,
  className,
  label,
}: {
  name: IconName;
  className?: string;
  /** Only when the icon has no visible text beside it. */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-[1.15em] shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
