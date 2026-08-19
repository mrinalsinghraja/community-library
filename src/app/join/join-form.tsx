"use client";

import { useActionState, useState } from "react";

import { PhotoPicker } from "@/components/library/photo-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { DEFAULT_AVATAR_KEY } from "@/lib/avatars";
import { CONSENT_LABELS, CONSENT_TEXTS, REQUIRED_CONSENT_TYPES, type ConsentTypeKey } from "@/lib/consent";
import {
  submitRegistrationAction,
  type RegistrationFormState,
} from "@/server/actions/registration-actions";
import { Icon } from "@/components/ui/icon";
import { IconMedallion } from "@/components/ui/states";

const INITIAL: RegistrationFormState = { status: "idle" };

/**
 * The registration form.
 *
 * Written for a parent on a phone, in one sitting, with a child next to them.
 * Six fields and an avatar picker — nothing else is asked, because nothing else
 * is needed to run a library.
 */
export function JoinForm({
  ageMin,
  ageMax,
  libraryName,
}: {
  ageMin: number;
  ageMax: number;
  libraryName: string;
}) {
  const [state, formAction, pending] = useActionState(submitRegistrationAction, INITIAL);
  const [avatarKey, setAvatarKey] = useState<string>(DEFAULT_AVATAR_KEY);
  const [openConsent, setOpenConsent] = useState<ConsentTypeKey | null>(null);
  /**
   * Drives the photo consent tickbox. It appears only once a photo has actually
   * been chosen: asking every family to agree to storing a photograph they never
   * uploaded would be noise, and noise is how consent forms stop being read.
   */
  const [hasPhoto, setHasPhoto] = useState(false);

  if (state.status === "success") {
    return (
      <Card tone="primary" className="text-center">
        <IconMedallion name="sparkle" tone="accent" />
        <h2 className="mt-4 text-3xl">Thank you!</h2>
        <p className="mt-3 text-lg text-ink-soft">
          We have your registration. Our librarian will take a look, and you will get an email at
          the address you gave us with the next step.
        </p>
        <p className="mt-3 text-base text-ink-soft">
          There is nothing else to do right now. Joining {libraryName} is free, and always will be.
        </p>
      </Card>
    );
  }

  const fieldError = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      {state.status === "error" && state.message ? (
        <p
          role="alert"
          className="rounded-[var(--radius-field)] bg-danger-wash px-5 py-4 text-lg font-bold text-danger"
        >
          {state.message}
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      <Card>
        <h2 className="text-2xl">About your child</h2>

        <div className="mt-6 flex flex-col gap-6">
          <Field id="childName" label="Their name" error={fieldError("childName")} required>
            <TextInput
              id="childName"
              name="childName"
              autoComplete="off"
              required
              invalid={Boolean(fieldError("childName"))}
            />
          </Field>

          <Field
            id="childDateOfBirth"
            label="Their date of birth"
            hint={`Our library is for readers aged ${ageMin} to ${ageMax}.`}
            error={fieldError("childDateOfBirth")}
            required
          >
            <TextInput
              id="childDateOfBirth"
              name="childDateOfBirth"
              type="date"
              required
              invalid={Boolean(fieldError("childDateOfBirth"))}
            />
          </Field>

          <Field id="apartment" label="Your flat" error={fieldError("apartment")} required>
            <TextInput
              id="apartment"
              name="apartment"
              autoComplete="off"
              placeholder="P15"
              required
              invalid={Boolean(fieldError("apartment"))}
            />
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <h2 className="text-2xl">Pick a library card picture</h2>
        <p className="mt-2 text-ink-soft">
          Let your child choose! An avatar works just as well as a photo and keeps things simple.
        </p>

        <div className="mt-6">
          <PhotoPicker
            avatarKey={avatarKey}
            onAvatarChange={setAvatarKey}
            onPhotoChange={setHasPhoto}
            error={fieldError("photo")}
          />
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <h2 className="text-2xl">About you</h2>
        <p className="mt-2 text-ink-soft">
          We need one grown-up we can contact. Your email is where we send the link to set up the
          account, and how we help if the password is ever forgotten.
        </p>

        <div className="mt-6 flex flex-col gap-6">
          <Field id="guardianName" label="Your name" error={fieldError("guardianName")} required>
            <TextInput
              id="guardianName"
              name="guardianName"
              autoComplete="name"
              required
              invalid={Boolean(fieldError("guardianName"))}
            />
          </Field>

          <Field id="guardianEmail" label="Your email" error={fieldError("guardianEmail")} required>
            <TextInput
              id="guardianEmail"
              name="guardianEmail"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              invalid={Boolean(fieldError("guardianEmail"))}
            />
          </Field>

          <Field id="guardianPhone" label="Your phone" error={fieldError("guardianPhone")} required>
            <TextInput
              id="guardianPhone"
              name="guardianPhone"
              type="tel"
              autoComplete="tel"
              required
              invalid={Boolean(fieldError("guardianPhone"))}
            />
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <h2 className="text-2xl">Parent or guardian confirmation</h2>
        <p className="mt-2 text-ink-soft">
          Because this account is for a child, we need a parent or guardian to agree. You can read
          exactly what you are agreeing to, and you can change your mind at any time — just tell the
          librarian.
        </p>

        {fieldError("consent") ? (
          <p role="alert" className="mt-4 text-base font-bold text-danger">
            {fieldError("consent")}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-5">
          {/* Photo consent is its own record, and appears only when there is a
              photo — so a family can later withdraw the photo without
              withdrawing the membership. */}
          {hasPhoto ? (
            <div className="rounded-[var(--radius-field)] bg-surface-sunk p-4">
              <label className="flex items-start gap-3 text-lg font-bold text-ink">
                <input
                  type="checkbox"
                  name="consent.CHILD_PHOTO_STORAGE"
                  required
                  className="mt-1.5 h-6 w-6 shrink-0 accent-[var(--color-primary)]"
                />
                <span>{CONSENT_LABELS.CHILD_PHOTO_STORAGE}</span>
              </label>

              <button
                type="button"
                onClick={() =>
                  setOpenConsent(
                    openConsent === "CHILD_PHOTO_STORAGE" ? null : "CHILD_PHOTO_STORAGE",
                  )
                }
                aria-expanded={openConsent === "CHILD_PHOTO_STORAGE"}
                className="mt-2 ml-9 text-base font-bold text-primary-deep underline"
              >
                {openConsent === "CHILD_PHOTO_STORAGE"
                  ? "Hide the full wording"
                  : "Read the full wording"}
              </button>

              {openConsent === "CHILD_PHOTO_STORAGE" ? (
                <p className="mt-3 ml-9 whitespace-pre-line rounded-lg bg-surface p-4 text-base text-ink-soft">
                  {CONSENT_TEXTS.CHILD_PHOTO_STORAGE}
                </p>
              ) : null}
            </div>
          ) : null}

          {REQUIRED_CONSENT_TYPES.map((type) => (
            <div key={type} className="rounded-[var(--radius-field)] bg-surface-sunk p-4">
              <label className="flex items-start gap-3 text-lg font-bold text-ink">
                <input
                  type="checkbox"
                  name={`consent.${type}`}
                  required
                  className="mt-1.5 h-6 w-6 shrink-0 accent-[var(--color-primary)]"
                />
                <span>{CONSENT_LABELS[type]}</span>
              </label>

              <button
                type="button"
                onClick={() => setOpenConsent(openConsent === type ? null : type)}
                aria-expanded={openConsent === type}
                className="mt-2 ml-9 text-base font-bold text-primary-deep underline"
              >
                {openConsent === type ? "Hide the full wording" : "Read the full wording"}
              </button>

              {openConsent === type ? (
                <p className="mt-3 ml-9 whitespace-pre-line rounded-lg bg-surface p-4 text-base text-ink-soft">
                  {CONSENT_TEXTS[type]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* A bot fills this in; a person never sees it. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" size="lg" fullWidth disabled={pending} icon={<Icon name="sparkle" />}>
        {pending ? "Sending…" : "Send our registration"}
      </Button>
    </form>
  );
}
