"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import {
  removeLogoAction,
  updateBrandingAction,
  uploadLogoAction,
  type ActionState,
} from "@/server/actions/settings-actions";
import { Icon } from "@/components/ui/icon";

const INITIAL: ActionState = { status: "idle" };

function Notice({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;

  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "rounded-lg bg-danger-wash px-3 py-2 text-base font-bold text-danger"
          : "rounded-lg bg-success-wash px-3 py-2 text-base font-bold text-success"
      }
    >
      {state.message}
    </p>
  );
}

export interface BrandingFormValues {
  primaryColor: string;
  welcomeMessage: string;
  rulesMarkdown: string;
  donationPolicyMarkdown: string;
  contactEmail: string;
  contactPhone: string;
  venueName: string;
  venueAddress: string;
  eligibilityNote: string;
}

/**
 * One colour, a greeting, two pieces of text and how to reach the library.
 *
 * Not a theme builder: there is no second colour picker, no font control and no
 * stylesheet field. The children's pages are designed; this decides which
 * library they belong to, not what design they use.
 */
export function BrandingForm({ values }: { values: BrandingFormValues }) {
  const [state, formAction, pending] = useActionState(updateBrandingAction, INITIAL);
  const errors = state.fieldErrors ?? {};

  return (
    <Card>
      <h2 className="text-2xl">How the library looks and sounds</h2>

      <form action={formAction} className="mt-5 flex flex-col gap-5">
        <Notice state={state} />

        <Field
          id="primaryColor"
          label="Library colour"
          hint="Used for the library's mark. A pale colour is refused — the mark would disappear."
          error={errors.primaryColor}
          required
        >
          <input
            id="primaryColor"
            name="primaryColor"
            type="color"
            defaultValue={values.primaryColor}
            className="h-14 w-24 rounded-[var(--radius-field)] border border-control-border bg-surface p-1"
          />
        </Field>

        <Field
          id="welcomeMessage"
          label="Welcome message"
          hint="The first thing a child reads on the front page."
          error={errors.welcomeMessage}
        >
          <TextInput
            id="welcomeMessage"
            name="welcomeMessage"
            defaultValue={values.welcomeMessage}
            maxLength={160}
          />
        </Field>

        <Field
          id="rulesMarkdown"
          label="Anything else about how the library works"
          hint="Plain words. Shown on the 'How our library works' page underneath the rules."
          error={errors.rulesMarkdown}
        >
          <textarea
            id="rulesMarkdown"
            name="rulesMarkdown"
            defaultValue={values.rulesMarkdown}
            rows={5}
            maxLength={8000}
            className="w-full rounded-[var(--radius-field)] border border-control-border bg-surface p-4 text-lg"
          />
        </Field>

        <Field
          id="donationPolicyMarkdown"
          label="About donating books"
          hint="Plain words. Remember: donating is never a condition of joining."
          error={errors.donationPolicyMarkdown}
        >
          <textarea
            id="donationPolicyMarkdown"
            name="donationPolicyMarkdown"
            defaultValue={values.donationPolicyMarkdown}
            rows={4}
            maxLength={8000}
            className="w-full rounded-[var(--radius-field)] border border-control-border bg-surface p-4 text-lg"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="contactEmail" label="Library email" error={errors.contactEmail}>
            <TextInput
              id="contactEmail"
              name="contactEmail"
              type="email"
              autoCapitalize="none"
              defaultValue={values.contactEmail}
            />
          </Field>

          <Field id="contactPhone" label="Library phone" error={errors.contactPhone}>
            <TextInput id="contactPhone" name="contactPhone" defaultValue={values.contactPhone} />
          </Field>
        </div>

        {/*
          Where the room is and who may use it.
          
          Two boxes for the room and not one, because the two are read in
          different sentences: the short name drops into "come to the ___" on a
          child's page, and the address is what somebody writes on a note to a
          neighbour. Deriving either from the other produced text that read like
          a form letter.
        */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="venueName"
            label="The room, short"
            hint="Goes inside a sentence: “come to the …”."
            error={errors.venueName}
          >
            <TextInput id="venueName" name="venueName" maxLength={60} defaultValue={values.venueName} />
          </Field>

          <Field
            id="venueAddress"
            label="The room, in full"
            hint="What you would write on a note to a neighbour."
            error={errors.venueAddress}
          >
            <TextInput
              id="venueAddress"
              name="venueAddress"
              maxLength={120}
              defaultValue={values.venueAddress}
            />
          </Field>
        </div>

        <Field
          id="eligibilityNote"
          label="Who the library is for"
          hint="Shown on the front page, the joining page and the rules. One or two sentences."
          error={errors.eligibilityNote}
        >
          <textarea
            id="eligibilityNote"
            name="eligibilityNote"
            defaultValue={values.eligibilityNote}
            rows={2}
            maxLength={240}
            className="w-full rounded-[var(--radius-field)] border border-control-border bg-surface p-4 text-lg"
          />
        </Field>

        <div>
          <Button type="submit" size="md" disabled={pending} icon={<Icon name="save" />}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Logo upload. PNG, JPEG or WebP — an SVG is refused, and the service says so too. */
export function LogoForm({ hasLogo }: { hasLogo: boolean }) {
  const [uploadState, upload, uploading] = useActionState(uploadLogoAction, INITIAL);
  const [removeState, remove, removing] = useActionState(removeLogoAction, INITIAL);
  const state = [uploadState, removeState].find((candidate) => candidate.status !== "idle") ?? INITIAL;

  return (
    <Card>
      <h2 className="text-2xl">Logo</h2>
      <p className="mt-2 text-ink-soft">
        A picture file — PNG, JPEG or WebP, up to 2 MB. Without one, the library uses the drawn
        mark in your chosen colour.
      </p>

      <form action={upload} className="mt-5 flex flex-col gap-4">
        <Notice state={state} />

        <Field id="logo" label="Choose a picture" error={uploadState.fieldErrors?.logo}>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="w-full rounded-[var(--radius-field)] border border-control-border bg-surface p-3 text-base"
          />
        </Field>

        <div>
          <Button type="submit" size="md" disabled={uploading} icon={<Icon name="upload" />}>
            {uploading ? "Uploading…" : "Use this logo"}
          </Button>
        </div>
      </form>

      {hasLogo ? (
        <form action={remove} className="mt-4">
          <Button type="submit" size="sm" variant="secondary" disabled={removing}>
            {removing ? "Removing…" : "Remove the logo"}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
