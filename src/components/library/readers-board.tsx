import { MemberAvatar } from "@/components/library/avatar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { BOARD_SIZE, EMPTY_SOCKET_LABEL, type BoardReader } from "@/lib/readers-board";

/**
 * Five readers, celebrated together.
 *
 * The figure is a constellation and the point of a constellation is that it has
 * no first star — the shape exists because all of them are shining at once. So
 * there is no numeral anywhere on this card, no count of books, and no ordering
 * a child could read as a placing. The five are simply here.
 *
 * **The empty socket is the most important mark on it.** A month with three
 * readers on the board shows five sockets, two of them dashed and saying "It
 * could be you" — drawn at exactly the same size as a filled one, so the gap
 * reads as an invitation rather than as an absence. Before the library's first
 * full month every socket is empty, and the card is then entirely invitation,
 * which is precisely what it should be at that moment.
 *
 * A child appears here only where a guardian has said they may. See ADR-055 for
 * why permission to appear is asked separately from permission to hold a
 * photograph at all.
 */
export function ReadersBoard({
  readers,
  monthLabel,
  className,
}: {
  readers: BoardReader[];
  monthLabel: string;
  className?: string;
}) {
  // Always five. The sockets nobody filled are the invitation.
  const sockets = Array.from({ length: BOARD_SIZE }, (_, index) => readers[index] ?? null);

  return (
    <Card tone="shelf" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col">
        {/*
          The rule under the heading is drawn at `bottom: -0.7rem`, so the month
          beneath it needs clearance or the gradient bar strikes straight
          through the words.
        */}
        <h2 className="garden-rule inline-block self-start text-xl">Readers of the month</h2>
        <p className="mt-4 text-sm text-ink-soft">{monthLabel}</p>
      </div>

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

      {/*
        The one sentence on the card, and it is doing real work: it tells a
        child who is not on the board that there is nothing to catch up on,
        because there is no race to be behind in.
      */}
      <p className="text-sm text-ink-soft">
        No one is first here — these are just five people who read a lot last
        month. Every book you take home is one more story you have finished.
      </p>
    </Card>
  );
}
