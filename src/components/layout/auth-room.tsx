import type { ReactNode } from "react";

import { Butterfly, LibraryLogo } from "@/components/library/library-logo";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import type { Branding } from "@/server/lib/settings";

/**
 * The room every door into the library opens onto.
 *
 * Sign in, forgotten password, a new password, an activation link, a
 * confirmation link, the joining form: six pages that used to be six
 * slightly different arrangements of a heading, a card and a paragraph. A
 * parent meets three or four of them in their first week, and each one
 * looking different from the last is the kind of thing that reads as
 * carelessness without anybody being able to say why.
 *
 * So they are one frame now. Two halves in a lifted plate: the library on one
 * side, in the deep green of its own rule, saying what this is, who it is for
 * and that nobody here can see a password; and on the other side whatever
 * this particular door asks for. The panel's words can be replaced by the
 * page — an activation link greets a child, the joining form talks to a
 * parent — but its position, its light and its three promises are fixed.
 *
 * `stacked` is for the one page whose form is too long to sit beside a panel:
 * the panel becomes a short band across the top and the form has the width.
 *
 * The panel comes second on a phone and first on a desk. The DOM keeps it
 * first because a sighted keyboard user on a wide screen meets it first, and
 * it holds nothing to focus, so the tab order is the form's either way.
 */

export interface PanelLine {
  icon: IconName;
  text: ReactNode;
}

/** What the panel says when the page does not say otherwise. */
export const PANEL_LINES: readonly PanelLine[] = [
  {
    icon: "book",
    text: (
      <>
        <strong className="font-semibold text-white">Readers</strong> — your books, your card,
        and what to read next.
      </>
    ),
  },
  {
    icon: "staff",
    text: (
      <>
        <strong className="font-semibold text-white">Library staff</strong> — the desk, the
        shelves, and the families who use them.
      </>
    ),
  },
  {
    icon: "key",
    text: "Nobody at the library can see your password. Not even the librarian.",
  },
];

export function AuthRoom({
  branding,
  eyebrow,
  title,
  lede,
  notice,
  panelHeading = "Your library is open.",
  panelLede = "Free to join, run by neighbours, and shelved a short walk from your door.",
  panelLines = PANEL_LINES,
  stacked = false,
  footer,
  children,
}: {
  branding: Branding;
  /** A short line above the heading, in the berry. "Almost there". */
  eyebrow?: string;
  /** The page's own heading. Omitted only when the content brings its own. */
  title?: string;
  /** The sentence under the heading. */
  lede?: ReactNode;
  /** A status line above everything — "Your new password is saved." */
  notice?: ReactNode;
  panelHeading?: string;
  panelLede?: string;
  panelLines?: readonly PanelLine[];
  /** Panel as a band across the top; for a form too long to sit beside it. */
  stacked?: boolean;
  /** The quiet links under the form, above a hairline. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 py-8 sm:px-8 sm:py-12",
        stacked ? "max-w-4xl" : "max-w-6xl",
      )}
    >
      <div
        className={cn(
          "grid overflow-hidden rounded-[1.25rem] bg-surface shadow-float",
          !stacked && "lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]",
        )}
      >
        <aside
          className={cn(
            "auth-panel relative isolate flex flex-col text-white",
            stacked
              ? "order-none gap-6 px-7 py-8 sm:flex-row sm:items-center sm:gap-8 sm:px-10"
              : "order-2 justify-between gap-10 px-7 py-9 sm:px-10 sm:py-11 lg:order-none lg:px-12 lg:py-14",
          )}
        >
          <Butterfly
            tone="soft"
            className="drift pointer-events-none absolute right-8 top-6 w-12 opacity-50 sm:w-16"
          />
          {stacked ? null : (
            <Butterfly
              tone="soft"
              className="drift-slow pointer-events-none absolute bottom-24 right-24 hidden w-9 opacity-35 lg:block"
            />
          )}

          <div className={cn("relative", stacked && "flex items-start gap-5 sm:items-center")}>
            {/* On its own white plate, so an uploaded mark with a light ground never floats unframed on the dark panel. */}
            <span className="inline-flex shrink-0 rounded-[0.9rem] bg-white/95 p-2.5 shadow-lift">
              <LibraryLogo
                logoUrl={branding.logoUrl}
                libraryName={branding.libraryName}
                size={64}
                className={stacked ? "w-10 sm:w-12" : "w-12 sm:w-14"}
              />
            </span>
            <div className={stacked ? "" : "mt-6"}>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
                {branding.libraryName}
              </p>
              <h2
                className={cn(
                  "mt-2 max-w-md text-white",
                  stacked ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl",
                )}
              >
                {panelHeading}
              </h2>
              <p className="mt-3 max-w-md text-base text-white/80 sm:text-lg">{panelLede}</p>
            </div>
          </div>

          {stacked ? null : (
            <ul className="relative flex flex-col gap-4 text-base text-white/85">
              {panelLines.map((line, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
                    <Icon name={line.icon} />
                  </span>
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          )}

          <p
            className={cn(
              "relative flex items-start gap-2.5 text-sm text-white/70",
              stacked && "sm:ms-auto sm:shrink-0",
            )}
          >
            <Icon name="home" className="mt-0.5 shrink-0" />
            <span>{branding.venueAddress}</span>
          </p>
        </aside>

        <div
          className={cn(
            "order-1 px-6 py-8 sm:px-10 sm:py-11 lg:order-none",
            stacked ? "lg:px-12 lg:py-12" : "lg:px-12 lg:py-14",
          )}
        >
          {notice ? (
            <p
              role="status"
              className="mb-6 flex items-start gap-3 rounded-[var(--radius-field)] border border-success/25 bg-success-wash px-5 py-4 text-base font-bold text-success"
            >
              <Icon name="check" className="mt-0.5 shrink-0" />
              <span>{notice}</span>
            </p>
          ) : null}

          {eyebrow ? <p className="text-base font-bold text-accent-ink">{eyebrow}</p> : null}
          {title ? (
            <h1 className={cn("garden-rule inline-block text-3xl sm:text-4xl", eyebrow && "mt-2")}>
              {title}
            </h1>
          ) : null}
          {lede ? <p className="mt-8 text-lg text-ink-soft">{lede}</p> : null}

          <div className={title || lede ? "mt-8" : undefined}>{children}</div>

          {footer ? (
            <div className="mt-8 flex flex-col gap-3 border-t border-hairline pt-6 text-base text-ink-soft">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
