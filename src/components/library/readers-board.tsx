import { MemberAvatar } from "@/components/library/avatar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { BOARD_SIZE, EMPTY_SOCKET_LABEL, type BoardReader } from "@/lib/readers-board";

/**
 * Six readers, celebrated together. Drawn twice: this month, then last month.
 *
 * The figure is a constellation and the point of a constellation is that it has
 * no first star — the shape exists because all of them are shining at once. So
 * there is no numeral anywhere on this card, no count of books, and no ordering
 * a child could read as a placing. The six are simply here.
 *
 * **The empty socket is the most important mark on a running month.** A month
 * with three readers so far shows six sockets, three of them dashed and saying
 * "It could be you" — drawn at exactly the same size as a filled one, so the
 * gap reads as an invitation rather than as an absence.
 *
 * **A finished month has no empty sockets**, and that difference is the whole
 * reason this component takes `running`. On the month still being written a gap
 * is something a child can still fill this week; on the month that ended it is
 * a seat nobody can reach any more, and drawing "It could be you" over it would
 * be an invitation to a door that has closed. So the finished card shows the
 * children who were on it and stops.
 *
 * A child appears here only where a guardian has said they may. See ADR-055 for
 * why permission to appear is asked separately from permission to hold a
 * photograph at all.
 */
export function ReadersBoard({
  readers,
  title,
  monthLabel,
  running,
  className,
}: {
  readers: BoardReader[];
  /** The heading. Two boards sit on the page and each has to say which it is. */
  title: string;
  monthLabel: string;
  /** True while the month is still being written. See the note above. */
  running: boolean;
  className?: string;
}) {
  // Six sockets on a running month; on a finished one, only the children who
  // were on it. The empties are the invitation, and an invitation to a month
  // that has ended is not one.
  const sockets: (BoardReader | null)[] = running
    ? Array.from({ length: BOARD_SIZE }, (_, index) => readers[index] ?? null)
    : readers;

  return (
    <Card tone="shelf" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col">
        {/*
          The rule under the heading is drawn at `bottom: -0.7rem`, so the month
          beneath it needs clearance or the gradient bar strikes straight
          through the words.
        */}
        <h2 className="garden-rule inline-block self-start text-xl">{title}</h2>
        <p className="mt-4 text-sm text-ink-soft">
          {monthLabel}
          {running ? " — so far" : null}
        </p>
      </div>

      {sockets.length > 0 ? (
        <ul className="flex list-none flex-wrap gap-x-5 gap-y-4 p-0">
          {sockets.map((reader, index) => (
            <li key={reader ? `${reader.firstName}-${index}` : `empty-${index}`}>
              <span className="flex w-20 flex-col items-center gap-2 text-center">
                {reader ? (
                  <MemberAvatar
                    avatarKey={reader.avatarKey}
                    photoUrl={reader.photoMediaId ? `/api/media/${reader.photoMediaId}` : null}
                    name={reader.firstName}
                    size={56}
                    className="ring-2 ring-accent"
                  />
                ) : (
                  /*
                   * Identical geometry to a filled socket, drawn in outline. The
                   * dashes are what make a gap read as waiting rather than as
                   * missing, and getting that right is the whole job of this card.
                   */
                  <span
                    aria-hidden="true"
                    className="flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-accent bg-accent-wash"
                  />
                )}

                <span
                  className={cn(
                    "text-sm leading-tight",
                    reader ? "font-semibold text-ink" : "text-accent-ink",
                  )}
                >
                  {reader ? reader.firstName : EMPTY_SOCKET_LABEL}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        /*
          Only reachable on a finished month nobody borrowed in — the library's
          first month, or a month it was shut. Said plainly and pointed at the
          card above, rather than drawn as six empty seats, which would read as
          six children who failed to turn up.
        */
        <p className="text-sm text-ink-soft">
          No books went home in {monthLabel}. This month&rsquo;s card is just above.
        </p>
      )}

      {/*
        The one sentence on the card, and it is doing real work: it tells a
        child who is not on the board that there is nothing to catch up on,
        because there is no race to be behind in.
      */}
      <p className="text-sm text-ink-soft">
        {running
          ? "No one is first here — these are people who have been reading a lot this month, and the month is not over. Every book you take home is one more story you have finished."
          : "No one was first here either. These are the people who read a lot that month, and the library is glad about all of them."}
      </p>
    </Card>
  );
}
