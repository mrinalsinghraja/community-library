"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Callout } from "@/components/ui/states";
import { CHANGEABLE_FIELDS, CHANGE_LIMITS, CHANGE_MESSAGES } from "@/lib/profile-changes";
import {
  submitProfileChangeAction,
  withdrawProfileChangeAction,
  type ProfileFormState,
} from "@/server/actions/profile-actions";
import type { OwnProfileView } from "@/server/services/profile-change-service";

/**
 * A reader correcting their own details.
 *
 * The form is pre-filled with what is on the record and submitting it asks for
 * a change rather than making one — which is the sentence the card leads with,
 * because a form that silently does nothing is worse than no form. A reader who
 * types a new address and sees the old one still there next week has been
 * misled by the interface, not by the rule.
 *
 * The boxes stay open while a request is waiting, but the submit is not: one
 * request at a time, so the desk never has to reconcile two overlapping
 * proposals from the same child.
 */

const initialState: ProfileFormState = { status: "idle" };

export function ProfileForm({ profile }: { profile: OwnProfileView }) {
  const [state, formAction, pending] = useActionState(submitProfileChangeAction, initialState);
  const [withdrawState, withdrawAction, withdrawing] = useActionState(
    withdrawProfileChangeAction,
    initialState,
  );
  const [open, setOpen] = useState(false);

  const errors = state.fieldErrors ?? {};
  const waiting = profile.pending;

  return (
    <Card tone="shelf">
      <CardTitle icon={<Icon name="reader" />}>{CHANGE_MESSAGES.heading}</CardTitle>
      <CardBody>
        <p className="text-lg text-ink-soft">{CHANGE_MESSAGES.intro}</p>

        {/*
          What the desk has been asked for, while it waits. Shown as "now →
          asked for" rather than as a list of new values, so a reader can see at
          a glance whether they typed what they meant.
        */}
        {waiting ? (
          <Callout tone="info" title={CHANGE_MESSAGES.pendingTitle} className="mt-5">
            <p>{CHANGE_MESSAGES.pendingBody}</p>
            <ul className="mt-2.5 flex list-none flex-col gap-1 p-0">
              {CHANGEABLE_FIELDS.filter((field) => field.key in waiting.proposed).map((field) => (
                <li key={field.key} className="text-base">
                  <span className="font-semibold text-ink">{field.label}:</span>{" "}
                  {waiting.proposed[field.key]}
                </li>
              ))}
            </ul>
            <form action={withdrawAction} className="mt-3">
              <Button type="submit" variant="quiet" size="sm" disabled={withdrawing}>
                {withdrawing ? "Taking it back…" : "Take it back"}
              </Button>
            </form>
            {withdrawState.status === "error" ? (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {withdrawState.message}
              </p>
            ) : null}
          </Callout>
        ) : null}

        {/*
          The last answer, so a refusal is not silent. A reader whose request was
          sent back needs to read the note and try again — and would otherwise
          only notice that their details never changed.
        */}
        {!waiting && profile.lastDecision?.status === "REJECTED" ? (
          <Callout tone="warn" title="The librarian sent your last change back" className="mt-5">
            {profile.lastDecision.decisionNote ?? "Please have a word with them next time you are in."}
          </Callout>
        ) : null}

        {!open ? (
          <div className="mt-5 flex flex-col gap-3">
            <dl className="flex flex-col gap-2">
              {CHANGEABLE_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-wrap gap-x-2 text-base">
                  <dt className="font-semibold text-ink">{field.label}:</dt>
                  <dd className="text-ink-soft">
                    {profile.current[field.key as keyof typeof profile.current] || "—"}
                  </dd>
                </div>
              ))}
            </dl>

            <div>
              <Button variant="secondary" size="sm" icon={<Icon name="save" />} onClick={() => setOpen(true)}>
                Something here is wrong
              </Button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="mt-5 flex flex-col gap-5">
            {CHANGEABLE_FIELDS.map((field) => (
              <Field
                key={field.key}
                id={field.key}
                label={field.label}
                hint={field.hint}
                error={errors[field.key]}
              >
                <TextInput
                  id={field.key}
                  name={field.key}
                  type={field.inputType}
                  maxLength={field.maxLength}
                  autoCapitalize={field.inputType === "email" ? "none" : undefined}
                  defaultValue={profile.current[field.key as keyof typeof profile.current] ?? ""}
                  invalid={Boolean(errors[field.key])}
                />
              </Field>
            ))}

            <Field
              id="note"
              label="Anything you want to tell the librarian?"
              hint="Optional. Something like “we moved to B-204”."
              error={errors.note}
            >
              <TextInput id="note" name="note" maxLength={CHANGE_LIMITS.noteMaxLength} />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || Boolean(waiting)} icon={<Icon name="mail" />}>
                {pending ? "Sending…" : "Ask the librarian to change these"}
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>

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
          </form>
        )}
      </CardBody>
    </Card>
  );
}
