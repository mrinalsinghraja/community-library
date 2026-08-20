"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ActionState } from "@/server/actions/account-actions";

const INITIAL: ActionState = { status: "idle" };

/**
 * The way in, when email is not the way in.
 *
 * A library can be running before its mail provider is configured, and in that
 * state an account exists and nobody can get into it — a new librarian's, or an
 * approved reader's. This is the answer for both: the Super Admin takes one
 * activation link out by hand and gives it to them through a channel they
 * trust, in person, at the desk.
 *
 * One component serves both screens on purpose. The wording an administrator
 * reads about a stalled activation should not depend on which list they happen
 * to be looking at, and two copies of this would drift the first time one of
 * them was edited.
 *
 * What it is careful about:
 *
 *   * **The link is minted when the button is pressed**, not when the page is
 *     rendered. Nothing on either screen holds a live token until an
 *     administrator deliberately asks for one, so simply opening the staff or
 *     reader list does not put credentials on anybody's screen.
 *   * **It goes to the clipboard, not onto the page.** The text box below only
 *     appears when the clipboard is unavailable — an insecure origin, or a
 *     browser that refused — because copying it is the whole purpose and a
 *     visible token with no way to copy it would be worse than useless.
 *   * **It is never rendered for a librarian or a reader.** The caller passes
 *     the permission it already checked, and the service behind `action`
 *     checks it again regardless: hiding a button is a courtesy, not a control.
 *
 * There is no password field here, on either screen. The person whose account
 * it is chooses their own.
 */
export function ActivationFallback({
  subjectId,
  fieldName,
  action,
  emailSent,
  waitingLabel,
  waitingDetail,
}: {
  /** The staff or member user id, submitted with the form. */
  subjectId: string;
  /** `staffId` or `memberId` — whichever the server action reads. */
  fieldName: "staffId" | "memberId";
  /** The Super-Admin-only action that mints the link. */
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** Null when nothing was ever attempted. False when the mailer refused. */
  emailSent: boolean | null;
  /** Heading for the "email went out, still waiting" case. */
  waitingLabel: string;
  /** Body for that same case. */
  waitingDetail: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const url = state.status === "success" ? state.activationUrl : undefined;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // Insecure origin, or the browser said no. Show it so it can be copied
      // by hand rather than leaving the administrator with nothing.
      setCopyFailed(true);
    }
  }

  return (
    <div className="rounded-[var(--radius-field)] bg-surface-sunk p-3">
      <p className="font-bold text-ink">
        {emailSent === false ? "Activation not sent" : waitingLabel}
      </p>
      <p className="mt-1 text-base text-ink-soft">
        {emailSent === false ? "The invitation email could not be sent." : waitingDetail}
      </p>

      {!url ? (
        <form action={formAction} className="mt-2">
          <input type="hidden" name={fieldName} value={subjectId} />
          <Button type="submit" variant="secondary" size="sm" disabled={pending} icon={<Icon name="key" />}>
            {pending ? "Making a link…" : "Copy activation link"}
          </Button>
        </form>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={copy} icon={<Icon name="key" />}>
              {copied ? "Copied" : "Copy to clipboard"}
            </Button>
            {copied ? (
              <span role="status" className="text-base font-bold text-success">
                Activation link copied.
              </span>
            ) : null}
          </div>

          {/*
            Only when the clipboard would not take it. Small and plain: it has
            to be selectable, and it has to not look like a prize.
          */}
          {copyFailed ? (
            <>
              <label htmlFor={`link-${subjectId}`} className="text-base text-ink-soft">
                Copy did not work — select this and copy it by hand:
              </label>
              <input
                id={`link-${subjectId}`}
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="w-full rounded-lg border-2 border-control-border bg-surface px-2 py-1 font-mono text-sm text-ink-soft"
              />
            </>
          ) : null}

          <p className="text-base text-ink-soft">
            Send it to them yourself. It works once, replaces any earlier link, and expires.
          </p>
        </div>
      )}

      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-base font-bold text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
