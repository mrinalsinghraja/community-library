"use client";

import Link from "next/link";
import { useActionState, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Callout } from "@/components/ui/states";
import { COVER_MAX_BYTES, COVER_MIN_BYTES, describeSize } from "@/lib/cover-image";
import { downscaleImage, formatBytes } from "@/lib/image-downscale";
import { AGE_GROUPS, CATALOGUE_LIMITS, CONDITIONS, SELECTABLE_STATUSES, statusDefinition } from "@/lib/catalogue";
import {
  createBookAction,
  updateBookAction,
  type BookFormState,
} from "@/server/actions/catalogue-actions";
import { Icon } from "@/components/ui/icon";

/**
 * Add Book / Edit Book.
 *
 * The librarian may well be twelve years old, so this form is built for speed
 * and for being hard to get wrong:
 *
 *   * ten fields, in the order somebody holding a book would fill them in;
 *   * four of them are dropdowns, so there is nothing to spell;
 *   * three arrive already answered — condition Good, status Available, donated
 *     today — because those are right most of the time;
 *   * the Book ID is not on the form at all. It is issued by the database and
 *     shown afterwards, so two people cataloguing at once cannot clash and
 *     nobody has to remember where the numbering got to.
 *
 * A book should take about a minute. Every field that is not here is part of
 * why.
 */

const initialState: BookFormState = { status: "idle" };

export interface BookFormCategory {
  id: string;
  name: string;
  icon: string | null;
}

export interface BookFormValues {
  copyId: string;
  title: string;
  author: string;
  categoryId: string;
  ageGroup: string;
  condition: string;
  status: string;
  donorName: string;
  donorFlat: string;
  donatedOn: string;
  /** True when this family asked us not to print their name. */
  donorAnonymous: boolean;
  hasCover: boolean;
  copyCode: string;
}

export function BookForm({
  mode,
  categories,
  values,
  today,
  returnTo,
}: {
  mode: "create" | "edit";
  categories: BookFormCategory[];
  values?: BookFormValues;
  /** Today in the library's timezone, as YYYY-MM-DD. Never the browser's idea of it. */
  today: string;
  /**
   * The book list this form was opened from, filters and page and all.
   *
   * Saving goes back to it, and so does Cancel — the two ways out of this form
   * lead to the same place, because a librarian working down a filtered list
   * should not be able to lose it by pressing the wrong one.
   */
  returnTo: string;
}) {
  const [state, formAction] = useActionState(
    mode === "create" ? createBookAction : updateBookAction,
    initialState,
  );
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const errors = state.fieldErrors ?? {};

  return (
    /*
     * No encType here. React sets multipart itself for a form whose action is a
     * function, and specifying one is overridden with a console warning.
     */
    <form action={formAction} className="flex flex-col gap-6">
      {values ? <input type="hidden" name="copyId" value={values.copyId} /> : null}
      {/* Read back through `safeBookListReturn`, which accepts the book list
          and nothing else — this field crosses a browser. */}
      <input type="hidden" name="returnTo" value={returnTo} />

      {state.status === "error" && state.message ? (
        <Callout tone="warn" title="Not saved yet">
          {state.message}
        </Callout>
      ) : null}

      {/*
        No success banner here. A saved book redirects to the list and says so
        there, because the next thing the librarian needs is the list — and a
        form left open still holding a saved book is how a second copy of it
        gets added by somebody pressing save twice.
      */}

      <Field
        id={field("title")}
        label="Book title"
        required
        error={errors.title}
        hint="Exactly as it appears on the front of the book."
      >
        <TextInput
          id={field("title")}
          name="title"
          defaultValue={values?.title}
          maxLength={CATALOGUE_LIMITS.titleMax}
          autoComplete="off"
          required
          invalid={Boolean(errors.title)}
          describedBy={errors.title ? `${field("title")}-error` : undefined}
        />
      </Field>

      <Field id={field("author")} label="Author" required error={errors.author}>
        <TextInput
          id={field("author")}
          name="author"
          defaultValue={values?.author}
          maxLength={CATALOGUE_LIMITS.authorMax}
          autoComplete="off"
          required
          invalid={Boolean(errors.author)}
        />
      </Field>

      <Field
        id={field("categoryId")}
        label="Shelf"
        required
        error={errors.categoryId}
        hint="Where it lives in the room."
      >
        <Select
          id={field("categoryId")}
          name="categoryId"
          defaultValue={values?.categoryId ?? ""}
          required
          invalid={Boolean(errors.categoryId)}
        >
          {/* An empty first option, so nobody accidentally files every book on
              whichever shelf happens to sort first. */}
          <option value="" disabled>
            Choose a shelf…
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.icon ? `${category.icon} ` : ""}
              {category.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        id={field("ageGroup")}
        label="Recommended age"
        required
        error={errors.ageGroup}
        hint="A guide, not a rule — anyone may borrow anything."
      >
        <Select
          id={field("ageGroup")}
          name="ageGroup"
          defaultValue={values?.ageGroup ?? ""}
          required
          invalid={Boolean(errors.ageGroup)}
        >
          <option value="" disabled>
            Choose an age…
          </option>
          {AGE_GROUPS.map((group) => (
            <option key={group.value} value={group.value}>
              {group.label}
            </option>
          ))}
        </Select>
      </Field>

      <CoverField
        fieldId={field("cover")}
        error={errors.cover}
        hasCover={values?.hasCover ?? false}
      />

      <fieldset className="flex flex-col gap-6 rounded-[var(--radius-card)] bg-surface-sunk p-5">
        <legend className="px-2 text-base font-semibold text-ink">
          Was it donated?
        </legend>
        <p className="-mt-2 text-base text-ink-soft">
          Optional. Leave the name blank for a book the library bought — nothing
          in the library depends on a donation, and nobody is ranked by it.
        </p>

        <Field id={field("donorName")} label="Donated by" error={errors.donorName}>
          <TextInput
            id={field("donorName")}
            name="donorName"
            defaultValue={values?.donorName}
            maxLength={CATALOGUE_LIMITS.donorNameMax}
            autoComplete="off"
            invalid={Boolean(errors.donorName)}
          />
        </Field>

        <Field id={field("donorFlat")} label="Flat number" error={errors.donorFlat}>
          <TextInput
            id={field("donorFlat")}
            name="donorFlat"
            defaultValue={values?.donorFlat}
            maxLength={CATALOGUE_LIMITS.donorFlatMax}
            autoComplete="off"
            invalid={Boolean(errors.donorFlat)}
          />
        </Field>

        <Field
          id={field("donatedOn")}
          label="Donated on"
          error={errors.donatedOn}
          hint="Today, unless you are catching up on older books."
        >
          <TextInput
            id={field("donatedOn")}
            name="donatedOn"
            type="date"
            max={today}
            defaultValue={values?.donatedOn || today}
            invalid={Boolean(errors.donatedOn)}
          />
        </Field>

        {/*
          The default is to say thank you by name -- that is what the donors
          page is for, and asking every family to opt in would leave it empty.
          This is the opt OUT, and it is a tick box rather than a menu because
          the question the librarian is actually asking at the desk has two
          answers.

          Unticked is not "we did not ask". If nobody said otherwise the name
          goes on the page, so the wording at the desk has to say that out loud.
        */}
        <div className="rounded-[var(--radius-field)] bg-surface p-4">
          <label className="flex items-start gap-3 text-base font-bold text-ink">
            <input
              type="checkbox"
              id={field("donorAnonymous")}
              name="donorAnonymous"
              value="yes"
              defaultChecked={values?.donorAnonymous ?? false}
              className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-primary)]"
            />
            <span>Do not publish this name</span>
          </label>
          <p className="ml-9 mt-1.5 text-base text-ink-soft">
            Tick this only if the family asked. We keep the name here so the
            librarian knows who gave the book; the thank-you page shows no name,
            no flat and no page for them.
          </p>
        </div>
      </fieldset>

      <Field
        id={field("condition")}
        label="Condition"
        required
        error={errors.condition}
        hint={CONDITIONS.map((condition) => `${condition.label} — ${condition.hint}`).join("  ")}
      >
        <Select
          id={field("condition")}
          name="condition"
          defaultValue={values?.condition ?? "GOOD"}
          required
          invalid={Boolean(errors.condition)}
        >
          {CONDITIONS.map((condition) => (
            <option key={condition.value} value={condition.value}>
              {condition.label}
            </option>
          ))}
        </Select>
      </Field>

      {/*
        Where the book is.

        A book that is currently out gets no control at all — not a disabled
        one, and not a dropdown missing its own current value. Circulation owns
        AVAILABLE ↔ BORROWED as of Phase 3: the way to put this book back on the
        shelf is to take it back at the desk, which is a person handling a
        physical object. A form that could set "Available" on a book in a
        child's bag is exactly the inconsistency the database now refuses to
        commit, so the form does not offer it either.

        Submitting no status at all means "leave it as it is", which is why the
        field is optional in the service's schema.
      */}
      {values?.status === "BORROWED" ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold text-ink">Where is it now?</p>
          <p className="rounded-[var(--radius-field)] bg-surface-sunk px-4 py-3.5 text-ink-soft">
            <Icon name="book" /> Out with a reader.{" "}
            <Link href="/desk/loans" className="font-bold text-primary-deep">
              Take it back at the desk
            </Link>{" "}
            to change this. Everything else on this form can still be edited.
          </p>
        </div>
      ) : (
        <Field
          id={field("status")}
          label="Where is it now?"
          required
          error={errors.status}
          hint="Lending and returning happen at the desk. This records where the book is when it is not out."
        >
          <Select
            id={field("status")}
            name="status"
            defaultValue={values?.status ?? "AVAILABLE"}
            required
            invalid={Boolean(errors.status)}
          >
            {SELECTABLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusDefinition(status).staffLabel}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SaveButton mode={mode} />
        <Link
          href={returnTo}
          className="rounded-[var(--radius-button)] border border-control-border px-6 py-3.5 text-lg font-bold text-ink-soft no-underline hover:bg-surface-sunk hover:text-ink"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * Disabled while the action is in flight, so a slow upload does not become two
 * books. `useFormStatus` has to live in a child of the form to see it.
 */
function SaveButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" icon={<Icon name="save" />} disabled={pending}>
      {pending ? "Saving…" : mode === "create" ? "Save this book" : "Save changes"}
    </Button>
  );
}
/**
 * The cover picture: optional, and secondary to everything above it.
 *
 * Two things happen the moment a file is chosen, and both exist because the
 * librarian is often twelve and often on a phone.
 *
 * The picture is shown back, because a file input reveals only a filename and
 * somebody who tapped the wrong photo in a camera roll has no other way to
 * know before saving.
 *
 * And it is shrunk, in the browser, before it is ever submitted — a phone
 * photograph of a book jacket is routinely 4 MB and 4000 pixels wide, which is
 * four megabytes every child then downloads to render a two-centimetre
 * thumbnail. See `src/lib/image-downscale.ts`: it is a courtesy to the network,
 * never a security control, and every server-side rule still runs on whatever
 * actually arrives.
 *
 * If the browser cannot do it, the original file is submitted unchanged and
 * everything still works. Nothing here is allowed to stop a book being
 * catalogued.
 */
function CoverField({
  fieldId,
  error,
  hasCover,
}: {
  fieldId: string;
  error?: string;
  hasCover: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });

    if (!file) {
      setChosen(null);
      setNote(null);
      return;
    }

    setChosen(file.name);
    setNote("Getting the picture ready…");

    const { file: prepared, changed } = await downscaleImage(file);

    /*
     * Put the smaller file back into the input, so the ordinary form submission
     * carries it. A DataTransfer is the only way to assign to `input.files`,
     * and assigning does not fire another change event — which is what keeps
     * this from looping.
     */
    if (changed && inputRef.current && typeof DataTransfer === "function") {
      const transfer = new DataTransfer();
      transfer.items.add(prepared);
      inputRef.current.files = transfer.files;
    }

    setPreviewUrl(URL.createObjectURL(prepared));

    /*
     * Said here, before the form is submitted, because the server's refusal
     * arrives after a page round trip with the file input already emptied — so
     * a librarian meets the rule at the point where they can still choose a
     * different picture. The server still refuses independently; this is a
     * courtesy, not the gate.
     */
    if (prepared.size < COVER_MIN_BYTES) {
      setNote(
        `That picture is only ${describeSize(prepared.size)}, which is usually too small to ` +
          `read on a phone. Please choose one over ${describeSize(COVER_MIN_BYTES)}.`,
      );
      return;
    }

    if (prepared.size > COVER_MAX_BYTES) {
      setNote(
        `That picture is ${describeSize(prepared.size)}. Please choose one under ` +
          `${describeSize(COVER_MAX_BYTES)}.`,
      );
      return;
    }

    setNote(
      changed
        ? `Ready — resized to ${formatBytes(prepared.size)} so it loads quickly.`
        : "Ready.",
    );
  }

  return (
    <Field
      id={fieldId}
      label="Cover picture"
      error={error}
      hint={`Optional. A photo of the front cover is plenty — books without one get a drawn cover instead. Between ${describeSize(COVER_MIN_BYTES)} and ${describeSize(COVER_MAX_BYTES)}; anything larger is shrunk for you.`}
    >
      <input
        id={fieldId}
        ref={inputRef}
        name="cover"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFile}
        className="min-h-14 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-4 py-3 text-base file:me-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-base file:font-bold file:text-white"
      />

      {chosen ? (
        <div className="flex items-center gap-4">
          {previewUrl ? (
            <span className="w-16 shrink-0 overflow-hidden rounded-[var(--radius-field)] shadow-lift">
              {/* A local object URL for a file this browser already holds. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt=""
                className="aspect-[2/3] w-full object-cover"
              />
            </span>
          ) : null}
          <span className="text-base text-ink-soft">
            Chosen: {chosen}
            {note ? (
              <>
                <br />
                {note}
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {hasCover ? (
        <p className="text-base text-ink-soft">
          This book already has a cover. Choosing a new picture replaces it; to take it away
          entirely, use Remove cover next to the picture.
        </p>
      ) : null}
    </Field>
  );
}
