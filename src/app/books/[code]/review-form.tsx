"use client";

import { useActionState, useState } from "react";
import type { ReviewAttribution } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import {
  RATING_MAX,
  RATING_VALUES,
  REVIEW_MAX_WORDS,
  REVIEW_MESSAGES,
  countWords,
  ratingLabel,
} from "@/lib/reviews";
import {
  deleteReviewAction,
  submitReviewAction,
  type ReviewFormState,
} from "@/server/actions/review-actions";

/**
 * "What did you think?"
 *
 * The only thing a child writes in this whole application, so it is the one
 * form that has to feel like an invitation rather than a task.
 *
 * **The stars are real radio buttons.** Every one of them is an `<input
 * type="radio">` with its own label; the visible star is what the label draws.
 * That is what makes the arrow keys work, the choice survive a submit, and the
 * whole group announce itself as "How many stars, 4 of 5, Really good" instead
 * of as five unlabelled pictures. A div with an onClick would have looked the
 * same and been unusable by anyone not holding a mouse.
 *
 * **Words are optional and the form says so.** Most children will tap five
 * stars and leave, and that has to be a finished action — the button is enabled
 * the moment a star is chosen and the text box never blocks it.
 *
 * **The safety line is above the box, not below it.** A rule read after writing
 * is a rule that arrives too late to change what was written.
 *
 * The only fields that leave the browser are the book's printed code, a number,
 * some words, and a yes/no about being named. Who is writing is decided from
 * the session on the server.
 */

const initialState: ReviewFormState = { status: "idle" };

export function ReviewForm({
  code,
  title,
  mine,
}: {
  code: string;
  title: string;
  /** What this reader already said, when they have said something. */
  mine: {
    rating: number;
    review: string | null;
    attribution: ReviewAttribution;
    hidden: boolean;
  } | null;
}) {
  const [state, action, pending] = useActionState(submitReviewAction, initialState);
  const [removal, removeAction, removing] = useActionState(deleteReviewAction, initialState);

  const [rating, setRating] = useState<number>(mine?.rating ?? 0);
  const [text, setText] = useState<string>(mine?.review ?? "");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const words = countWords(text);
  const overLimit = words > REVIEW_MAX_WORDS;

  if (removal.status === "success") {
    return (
      <section className="mt-10 rounded-[var(--radius-card)] bg-surface-sunk p-5">
        <p role="status" className="text-lg text-ink">
          {removal.message}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="review-form-heading" className="mt-10">
      <h2 id="review-form-heading" className="garden-rule inline-block text-2xl">
        {mine ? "What you said" : REVIEW_MESSAGES.invitation}
      </h2>

      {/*
        Only the author is told their review was taken down, and only here.
        Nothing on the public list says a review is missing, because a gap
        labelled "removed" tells every other child that something happened and
        invites them to guess what.
      */}
      {mine?.hidden ? (
        <p className="mt-8 flex items-start gap-2 rounded-[var(--radius-card)] bg-surface-sunk px-5 py-4 text-base text-ink">
          <Icon name="info" className="mt-1 shrink-0 text-ink-soft" />
          {REVIEW_MESSAGES.hidden}
        </p>
      ) : null}

      <form action={action} className="mt-8 flex flex-col gap-6">
        <input type="hidden" name="code" value={code} />

        {/* ---------------------------------------------------------- */}
        {/* The stars                                                   */}
        {/* ---------------------------------------------------------- */}
        <fieldset className="border-0 p-0">
          <legend className="text-base font-semibold text-ink">
            {REVIEW_MESSAGES.ratingLegend}
            <span className="sr-only"> for {title}</span>
          </legend>

          <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
            {RATING_VALUES.map((value) => (
              <label
                key={value}
                className="group cursor-pointer rounded-[var(--radius-field)] p-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-deep"
              >
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  className="sr-only"
                />
                <span className="sr-only">
                  {value} of {RATING_MAX} — {ratingLabel(value)}
                </span>
                {/*
                  Filled to the left of the chosen star, outlined to the right.
                  The whole row is the control, which is how a rating widget is
                  read: you are choosing a level, not ticking one box of five.
                */}
                <StarGlyph filled={value <= rating} />
              </label>
            ))}

            {/*
              The word for the number. Colour and count both say four stars;
              only this says what four stars means, and it is what a child
              checks before letting go.
            */}
            <span
              aria-hidden="true"
              className={cn(
                "ml-2 text-lg font-semibold",
                rating > 0 ? "text-ink" : "text-ink-faint",
              )}
            >
              {rating > 0 ? ratingLabel(rating) : "Pick your stars"}
            </span>
          </div>

          {state.fieldErrors?.rating ? (
            <p role="alert" className="mt-2 text-base font-semibold text-danger">
              {state.fieldErrors.rating}
            </p>
          ) : null}
        </fieldset>

        {/* ---------------------------------------------------------- */}
        {/* The words                                                   */}
        {/* ---------------------------------------------------------- */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="review" className="text-base font-semibold text-ink">
            {REVIEW_MESSAGES.reviewLabel}
          </label>
          <p id="review-hint" className="text-sm text-ink-soft">
            {REVIEW_MESSAGES.reviewHint}
          </p>

          <p className="flex items-start gap-2 rounded-[var(--radius-field)] bg-accent-wash px-4 py-3 text-sm text-ink">
            <Icon name="info" className="mt-0.5 shrink-0 text-accent-ink" />
            {REVIEW_MESSAGES.safetyNote}
          </p>

          <textarea
            id="review"
            name="review"
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby="review-hint review-count"
            aria-invalid={overLimit || undefined}
            className={cn(
              "mt-1 w-full rounded-[var(--radius-field)] border bg-surface px-3.5 py-3 text-base",
              "placeholder:text-ink-faint",
              overLimit ? "border-danger" : "border-control-border",
            )}
            placeholder="The bit I liked best was…"
          />

          {/*
            A count, not a countdown. "12 of 100 words" is a fact; "88 left" is
            a target, and a target is the thing that makes a child pad out a
            review they had already finished.
          */}
          <p
            id="review-count"
            className={cn("text-sm", overLimit ? "font-semibold text-danger" : "text-ink-soft")}
          >
            {overLimit
              ? REVIEW_MESSAGES.tooLong
              : `${words} of ${REVIEW_MAX_WORDS} words`}
          </p>

          {state.fieldErrors?.review ? (
            <p role="alert" className="text-base font-semibold text-danger">
              {state.fieldErrors.review}
            </p>
          ) : null}
        </div>

        {/* ---------------------------------------------------------- */}
        {/* The signature                                               */}
        {/* ---------------------------------------------------------- */}
        <fieldset className="border-0 p-0">
          <legend className="text-base font-semibold text-ink">
            {REVIEW_MESSAGES.attributionLabel}
          </legend>
          <p className="mt-1 text-sm text-ink-soft">{REVIEW_MESSAGES.attributionHint}</p>

          {/*
            A radio pair, not a checkbox. An unchecked checkbox and a missing
            field look identical in a POST body, and the field that decides
            whether a child's name is published is not one to leave to a
            default that could be reached by accident.
          */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-5">
            <AttributionChoice
              value="FIRST_NAME"
              label={REVIEW_MESSAGES.attributionNamed}
              defaultChecked={(mine?.attribution ?? "FIRST_NAME") === "FIRST_NAME"}
            />
            <AttributionChoice
              value="ANONYMOUS"
              label={REVIEW_MESSAGES.attributionAnonymous}
              defaultChecked={mine?.attribution === "ANONYMOUS"}
            />
          </div>
        </fieldset>

        {state.status === "error" && !state.fieldErrors ? (
          <p role="alert" className="text-base font-semibold text-danger">
            {state.message}
          </p>
        ) : null}

        {state.status === "success" ? (
          <p role="status" className="flex items-center gap-2 text-base font-semibold text-success">
            <Icon name="check" />
            {state.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="lg"
            icon={<Icon name="star" />}
            disabled={pending || rating === 0 || overLimit}
          >
            {pending ? "Saving…" : mine ? REVIEW_MESSAGES.update : REVIEW_MESSAGES.submit}
          </Button>

          {mine && !confirmingRemoval ? (
            <Button variant="quiet" size="sm" onClick={() => setConfirmingRemoval(true)}>
              Take mine down
            </Button>
          ) : null}
        </div>
      </form>

      {/*
        Outside the form above, not inside it. Two submit buttons in one form is
        how "take mine down" gets pressed by an Enter key meant for "save".
      */}
      {mine && confirmingRemoval ? (
        <form action={removeAction} className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="code" value={code} />
          <p className="w-full text-base text-ink">
            Take down your stars and your words for this book?
          </p>
          <Button type="submit" variant="secondary" size="sm" disabled={removing}>
            {removing ? "Taking it down…" : "Yes, take it down"}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setConfirmingRemoval(false)}>
            Keep it
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function AttributionChoice({
  value,
  label,
  defaultChecked,
}: {
  value: ReviewAttribution;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-base text-ink">
      <input
        type="radio"
        name="attribution"
        value={value}
        defaultChecked={defaultChecked}
        className="size-5 accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

/**
 * One star in the picker.
 *
 * Bigger than the ones in a rating row — 40px at the smallest — because this is
 * a tap target for a five-year-old, not a piece of typography. Filled stars are
 * amber; unfilled ones keep a visible outline so the row always reads as five
 * of something rather than as two stars floating beside nothing.
 */
function StarGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(
        "size-10 transition-transform duration-100 group-hover:scale-110 sm:size-11",
        filled ? "text-warn" : "text-ink-faint",
      )}
    >
      <path
        d="M12 2.6l2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.02l-5.64 2.96 1.08-6.29L2.87 9.24l6.31-.92L12 2.6Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
