import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { BOARD_MESSAGES, type BoardNotice } from "@/lib/message-board";
import { cn } from "@/lib/cn";

/**
 * The little board at the top of a reader's own page.
 *
 * Two states, and the ordinary one is the one that had to be got right. Most
 * days there is nothing special to say, and the card still has to look like
 * something somebody put there — so on a quiet day it greets the reader and
 * offers a line about reading, in exactly the same frame. A card that went
 * blank when nobody had posted would teach a child to stop looking at it, and
 * then the week it mattered they would not see that either.
 *
 * A posted notice takes the whole card: accent ground, a pin, and the heading
 * in the display face. Nothing else on the page changes colour, so a notice is
 * visible from the top of the screen without being an alarm.
 */
export function MessageBoard({ notice, className }: { notice: BoardNotice; className?: string }) {
  return (
    <Card
      as="section"
      tone={notice.special ? "plain" : "sunk"}
      className={cn(
        "flex items-start gap-3.5",
        notice.special ? "border-l-4 border-l-accent bg-accent-wash" : null,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full",
          notice.special ? "bg-surface text-accent-ink" : "bg-surface text-primary-deep",
        )}
      >
        <Icon name={notice.special ? "info" : "sparkle"} />
      </span>

      <div className="min-w-0">
        {/*
          The board's own name, for a screen reader only. On screen the heading
          is the greeting or the notice — putting "Notice board" above it in
          print would be a label on a thing that is already obviously itself,
          and would push the actual words down the card.
        */}
        <h2 className={cn("text-xl leading-tight", notice.special ? "text-accent-ink" : "text-ink")}>
          <span className="sr-only">{BOARD_MESSAGES.heading}: </span>
          {notice.title}
        </h2>

        {/*
          Whitespace preserved. A notice is typed as lines by somebody standing
          at a desk, and it should reach a family as the lines they typed.
        */}
        <p className="mt-1.5 whitespace-pre-line text-base text-ink-soft">{notice.body}</p>

        {!notice.special ? (
          <p className="mt-2 text-sm text-ink-faint">{BOARD_MESSAGES.standingHint}</p>
        ) : null}
      </div>
    </Card>
  );
}
