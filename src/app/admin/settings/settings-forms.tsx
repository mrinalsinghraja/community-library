"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import {
  DATE_FORMAT_OPTIONS,
  SETTING_BOUNDS,
  TIMEZONE_OPTIONS,
  UNAVAILABLE_FEATURES,
} from "@/lib/settings-schema";
import { STRENGTH_LABELS } from "@/lib/guardian-verification";
import {
  setRemindersAction,
  updateSettingsAction,
  updateVerificationAction,
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

function NumberField({
  name,
  label,
  hint,
  bound,
  defaultValue,
  error,
}: {
  name: string;
  label: string;
  hint?: string;
  bound: { min: number; max: number };
  defaultValue: number;
  error?: string;
}) {
  return (
    <Field id={name} label={label} hint={hint} error={error} required>
      <TextInput
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        min={bound.min}
        max={bound.max}
        step={1}
        defaultValue={defaultValue}
        required
        className="max-w-40"
      />
    </Field>
  );
}

/**
 * What the form needs, spelled out.
 *
 * Not the Prisma row: a component that imports the database's own types ends up
 * rendering whatever the schema happens to contain, and the lint rule that
 * forbids it here is the reason the dormant columns cannot drift onto a screen
 * by accident.
 */
export interface SettingsFormValues {
  timezone: string;
  dateFormat: string;
  borrowingPeriodDays: number;
  maxActiveLoans: number;
  maxRenewals: number;
  renewalPeriodDays: number;
  ageMin: number;
  ageMax: number;
  memberCodePrefix: string;
  copyCodePrefix: string;
  catalogueVisibility: string;
}

/**
 * One form, four sections, one Save.
 *
 * A librarian changing the loan period should not have to work out which of six
 * screens owns it. These are all "how this library works", so they are saved
 * together, and the confirmation says the thing people actually worry about:
 * books already out keep their dates.
 */
export function LibrarySettingsForm({
  libraryName,
  settings,
}: {
  libraryName: string;
  settings: SettingsFormValues;
}) {
  const [state, formAction, pending] = useActionState(updateSettingsAction, INITIAL);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Notice state={state} />

      <Card>
        <h2 className="text-2xl">Your library</h2>
        <div className="mt-5 flex flex-col gap-5">
          <Field id="libraryName" label="Library name" error={errors.libraryName} required>
            <TextInput id="libraryName" name="libraryName" defaultValue={libraryName} required />
          </Field>

          <Field id="timezone" label="Timezone" error={errors.timezone} required>
            <Select id="timezone" name="timezone" defaultValue={settings.timezone}>
              {[...new Set([settings.timezone, ...TIMEZONE_OPTIONS])].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="dateFormat" label="How dates are written" error={errors.dateFormat} required>
            <Select id="dateFormat" name="dateFormat" defaultValue={settings.dateFormat}>
              {DATE_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.example}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-2xl">Borrowing</h2>
        <p className="mt-2 text-ink-soft">
          These decide what happens the <strong>next</strong> time a book goes out. A book already
          borrowed keeps the date it was given.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <NumberField
            name="borrowingPeriodDays"
            label="Days a book can be kept"
            bound={SETTING_BOUNDS.borrowingPeriodDays}
            defaultValue={settings.borrowingPeriodDays}
            error={errors.borrowingPeriodDays}
          />
          <NumberField
            name="maxActiveLoans"
            label="Books one child can have"
            bound={SETTING_BOUNDS.maxActiveLoans}
            defaultValue={settings.maxActiveLoans}
            error={errors.maxActiveLoans}
          />
          <NumberField
            name="maxRenewals"
            label="Times a book can be kept longer"
            bound={SETTING_BOUNDS.maxRenewals}
            defaultValue={settings.maxRenewals}
            error={errors.maxRenewals}
          />
          <NumberField
            name="renewalPeriodDays"
            label="Extra days when it is kept longer"
            hint="Added to the date it was already due, not to today."
            bound={SETTING_BOUNDS.renewalPeriodDays}
            defaultValue={settings.renewalPeriodDays}
            error={errors.renewalPeriodDays}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-2xl">Readers</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <NumberField
            name="ageMin"
            label="Youngest age"
            bound={SETTING_BOUNDS.ageMin}
            defaultValue={settings.ageMin}
            error={errors.ageMin}
          />
          <NumberField
            name="ageMax"
            label="Oldest age"
            bound={SETTING_BOUNDS.ageMax}
            defaultValue={settings.ageMax}
            error={errors.ageMax}
          />
          <Field
            id="memberCodePrefix"
            label="Library card prefix"
            hint="Only new cards use this. Cards already printed keep their number."
            error={errors.memberCodePrefix}
            required
          >
            <TextInput
              id="memberCodePrefix"
              name="memberCodePrefix"
              defaultValue={settings.memberCodePrefix}
              required
              className="max-w-48 uppercase"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-2xl">Books</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field
            id="copyCodePrefix"
            label="Book label prefix"
            hint="Only new labels use this. Books already on the shelf keep theirs."
            error={errors.copyCodePrefix}
            required
          >
            <TextInput
              id="copyCodePrefix"
              name="copyCodePrefix"
              defaultValue={settings.copyCodePrefix}
              required
              className="max-w-48 uppercase"
            />
          </Field>

          <Field
            id="catalogueVisibility"
            label="Who can look at the shelf"
            error={errors.catalogueVisibility}
            required
          >
            <Select
              id="catalogueVisibility"
              name="catalogueVisibility"
              defaultValue={settings.catalogueVisibility}
            >
              <option value="MEMBER_ONLY">Only children who have joined</option>
              <option value="PUBLIC">Anyone who visits the website</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div>
        <Button type="submit" size="md" disabled={pending} icon={<Icon name="save" />}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Guardian verification.
 *
 * Deliberately not one of the fields above. This is the setting that decides
 * what evidence the library holds that the adult approving a child's account is
 * that child's guardian, so it is saved on its own, behind a tick box, and the
 * legal warning stays on the screen where the change is made.
 */
export function VerificationForm({
  current,
  selectable,
  version,
}: {
  current: string;
  selectable: readonly string[];
  version: string;
}) {
  const [state, formAction, pending] = useActionState(updateVerificationAction, INITIAL);
  const [choice, setChoice] = useState(current);
  const changed = choice !== current;

  return (
    <Card>
      <h2 className="text-2xl">Checking that a grown-up is really the parent</h2>

      <p className="mt-3 rounded-lg bg-accent-wash px-4 py-3 text-base text-ink">
        <strong>
          Changing this setting changes how guardian verification is handled for children&rsquo;s
          accounts.
        </strong>{" "}
        It decides what a registration must reach before a child&rsquo;s account can be approved.
        This software does not give legal advice — the wording, and the strength this library needs,
        are for someone qualified to review.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-5">
        <Notice state={state} />

        <Field
          id="requiredGuardianVerification"
          label="What a registration must reach"
          error={state.fieldErrors?.requiredGuardianVerification}
          required
        >
          <Select
            id="requiredGuardianVerification"
            name="requiredGuardianVerification"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            {selectable.map((strength) => (
              <option key={strength} value={strength}>
                {STRENGTH_LABELS[strength as keyof typeof STRENGTH_LABELS] ?? strength}
              </option>
            ))}
          </Select>
        </Field>

        {changed ? (
          <Field id="confirm" label="Please confirm" error={state.fieldErrors?.confirm}>
            <label className="flex items-start gap-3 text-base text-ink">
              <input
                id="confirm"
                name="confirm"
                type="checkbox"
                className="mt-1 size-6 shrink-0 rounded border-2 border-control-border"
              />
              <span>
                I mean to change this, and I understand it changes how children&rsquo;s accounts are
                approved from now on.
              </span>
            </label>
          </Field>
        ) : null}

        <div>
          <Button type="submit" size="md" variant="secondary" disabled={pending || !changed}>
            {pending ? "Saving…" : "Change this"}
          </Button>
        </div>
      </form>

      <p className="mt-4 text-base text-ink-soft">
        Wording version <code>{version}</code>. The words a parent agrees to live in the code and
        change with a release, so that a record of what somebody agreed to can never be rewritten
        from this screen.
      </p>
    </Card>
  );
}

/**
 * The reminder switch.
 *
 * When email cannot leave the building there is no control at all — not a
 * disabled-looking one, not a warning beside a working one. The server refuses
 * the change as well; this is only the half a person can see.
 */
export function ReminderSwitch({
  enabled,
  canEnable,
}: {
  enabled: boolean;
  canEnable: boolean;
}) {
  const [state, formAction, pending] = useActionState(setRemindersAction, INITIAL);

  return (
    <Card>
      <h2 className="text-2xl">Reminder emails</h2>
      <p className="mt-2 text-ink-soft">
        A gentle note to a parent two days before a book is due, and again if it is late. Nothing
        else is ever sent by this.
      </p>

      {canEnable ? (
        <form action={formAction} className="mt-5 flex flex-col gap-4">
          <Notice state={state} />
          <p className="text-lg font-bold text-ink">
            Reminders are currently {enabled ? "on" : "off"}.
          </p>
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <div>
            <Button
              type="submit"
              size="md"
              variant={enabled ? "secondary" : "primary"}
              disabled={pending}
            >
              {pending ? "Saving…" : enabled ? "Turn reminders off" : "Turn reminders on"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-5 rounded-lg bg-surface-sunk px-4 py-3 text-base font-bold text-ink">
          Email reminders cannot be enabled until a production email provider is configured. Nothing
          sent from here today would reach a family.
        </p>
      )}
    </Card>
  );
}

/** Things the database can describe and the library cannot do. Text, never a control. */
export function UnavailableFeatures() {
  return (
    <Card>
      <h2 className="text-2xl">Not available yet</h2>
      <p className="mt-2 text-ink-soft">
        These are not switched off — they are not built. There is nothing here to turn on.
      </p>
      <dl className="mt-5 flex flex-col gap-4">
        {UNAVAILABLE_FEATURES.map((feature) => (
          <div key={feature.label}>
            <dt className="text-base font-semibold text-ink">{feature.label}</dt>
            <dd className="text-base text-ink-soft">{feature.reason}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
