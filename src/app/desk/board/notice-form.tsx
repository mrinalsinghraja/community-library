"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import {
  NOTICE_BODY_MAX_LENGTH,
  NOTICE_TITLE_MAX_LENGTH,
} from "@/lib/message-board";
import {
  postNoticeAction,
  withdrawNoticeAction,
  type NoticeFormState,
} from "@/server/actions/announcement-actions";

/**
 * Writing the notice every family will read.
 *
 * Short on purpose. A heading and a few lines is what fits on a card on a
 * phone, and a notice long enough to need scrolling is a notice a child stops
 * reading halfway down — the length limits are the design, not a database
 * constraint leaking into the form.
 *
 * There is no schedule and no audience picker. One notice is live at a time and
 * it goes up now, because the owner asked for something that reaches every
 * reader immediately, and every control added here is a control somebody has to
 * get right while typing something urgent.
 */

const initialState: NoticeFormState = { status: "idle" };

export function NoticeForm() {
  const [state, formAction, pending] = useActionState(postNoticeAction, initialState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field id="title" label="Heading" error={errors.title} required>
        <TextInput
          id="title"
          name="title"
          maxLength={NOTICE_TITLE_MAX_LENGTH}
          placeholder="The library is shut this Saturday"
          invalid={Boolean(errors.title)}
        />
      </Field>

      <Field
        id="body"
        label="The notice"
        hint="A few lines. Line breaks are kept exactly as you type them."
        error={errors.body}
        required
      >
        <textarea
          id="body"
          name="body"
          rows={4}
          maxLength={NOTICE_BODY_MAX_LENGTH}
          aria-invalid={Boolean(errors.body) || undefined}
          className="w-full rounded-[var(--radius-field)] border border-control-border bg-surface p-3.5 text-base text-ink"
          placeholder="We will be back on Wednesday at the usual time."
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} icon={<Icon name="info" />}>
          {pending ? "Posting…" : "Post to every reader"}
        </Button>

        {state.status !== "idle" && state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={
              state.status === "error"
                ? "text-base font-semibold text-danger"
                : "text-base font-semibold text-primary-deep"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Taking the live notice down. Readers see the standing greeting again. */
export function WithdrawNotice({ noticeId }: { noticeId: string }) {
  const [state, formAction, pending] = useActionState(withdrawNoticeAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="noticeId" value={noticeId} />
      <Button type="submit" variant="quiet" size="sm" icon={<Icon name="hide" />} disabled={pending}>
        {pending ? "Taking it down…" : "Take it down"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
