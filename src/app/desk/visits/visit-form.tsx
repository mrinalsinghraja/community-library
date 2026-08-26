"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { SLOT_NOTE_MAX_LENGTH, TIME_OPTIONS, WEEKDAYS } from "@/lib/visits";
import { createVisitSlotsAction, type VisitFormState } from "@/server/actions/visit-actions";

/**
 * Putting the library room's opening times up.
 *
 * Everything is a dropdown, as the owner asked, and the reason it is worth
 * insisting on is consistency rather than convenience: two volunteers typing
 * opening hours freehand produce `16:00`, `4pm` and `4:00 PM` for the same
 * hour, and a child reading three spellings of one time learns the library is
 * not sure when it is open.
 *
 * The form has two shapes because a library has two kinds of opening. "Every
 * Saturday until December" is the ordinary case and would be thirteen separate
 * submissions without the repeat; "this Wednesday only" is the exception and
 * would be a strange thing to express as a range of one. Choosing between them
 * hides the fields the other one does not use, so neither shape ever shows a
 * box that does nothing.
 */

const initialState: VisitFormState = { status: "idle" };

export function VisitForm({ dates }: { dates: { value: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createVisitSlotsAction, initialState);
  const [repeat, setRepeat] = useState<"weekly" | "once">("weekly");

  const errors = state.fieldErrors ?? {};

  // A sensible far end for a repeat: about three months out, or the last date
  // the library is allowed to schedule, whichever comes first.
  const defaultTo = dates[dates.length - 1]?.value;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="repeat" value={repeat} />

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="text-base font-semibold text-ink">How often</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              { value: "weekly", label: "Every week on the same day" },
              { value: "once", label: "One date only" },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-base text-ink">
              <input
                type="radio"
                name="repeatChoice"
                value={option.value}
                checked={repeat === option.value}
                onChange={() => setRepeat(option.value)}
                className="size-5"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {repeat === "weekly" ? (
        <Field id="weekday" label="Which day" error={errors.weekday} required>
          <Select id="weekday" name="weekday" defaultValue="6" invalid={Boolean(errors.weekday)}>
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="fromDate"
          label={repeat === "weekly" ? "Starting from" : "Date"}
          error={errors.fromDate}
          required
        >
          <Select id="fromDate" name="fromDate" invalid={Boolean(errors.fromDate)}>
            {dates.map((date) => (
              <option key={date.value} value={date.value}>
                {date.label}
              </option>
            ))}
          </Select>
        </Field>

        {repeat === "weekly" ? (
          <Field id="toDate" label="Up to and including" error={errors.toDate} required>
            <Select
              id="toDate"
              name="toDate"
              defaultValue={defaultTo}
              invalid={Boolean(errors.toDate)}
            >
              {dates.map((date) => (
                <option key={date.value} value={date.value}>
                  {date.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="startMinute" label="Opens at" error={errors.startMinute} required>
          <Select
            id="startMinute"
            name="startMinute"
            defaultValue={16 * 60}
            invalid={Boolean(errors.startMinute)}
          >
            {TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="endMinute" label="Closes at" error={errors.endMinute} required>
          <Select
            id="endMinute"
            name="endMinute"
            defaultValue={17 * 60}
            invalid={Boolean(errors.endMinute)}
          >
            {TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        id="note"
        label="A short note for readers"
        hint="Optional. Shown under the time, exactly as you type it."
        error={errors.note}
      >
        <TextInput
          id="note"
          name="note"
          maxLength={SLOT_NOTE_MAX_LENGTH}
          placeholder="Returns only, please"
          invalid={Boolean(errors.note)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} icon={<Icon name="calendar" />}>
          {pending ? "Putting them up…" : "Put these times up"}
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
