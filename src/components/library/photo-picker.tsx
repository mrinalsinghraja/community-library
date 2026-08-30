"use client";

import { useEffect, useId, useRef, useState } from "react";

import { MemberAvatar } from "@/components/library/avatar";
import { Button } from "@/components/ui/button";
import { AVATARS } from "@/lib/avatars";
import {
  CHILD_PHOTO_MAX_BYTES,
  CHILD_PHOTO_MIN_BYTES,
  MAX_PHOTO_EDGE,
} from "@/lib/child-photo";
import { cn } from "@/lib/cn";
import { describeSize } from "@/lib/file-size";
import { COMPRESS_TOOL_URL, shrinkToBand, sizeStory } from "@/lib/shrink-to-band";
import { Icon } from "@/components/ui/icon";

/**
 * The library card picture.
 *
 * Three equal choices, in this order on purpose:
 *
 *   an avatar (the default) · a photograph · neither
 *
 * A photograph of a child is the most sensitive thing this system can hold, so
 * the interface never makes it feel like the expected answer. The avatars are
 * already there and already chosen when the form loads; adding a photo is an
 * extra step a parent takes only if they want to.
 *
 * The preview is a local object URL. The file itself travels with the form
 * submission — there is no upload endpoint a parent's browser talks to, and no
 * half-uploaded picture sitting anywhere if they change their mind and close the
 * tab.
 *
 * It is shrunk here, before it is submitted, and for this form that is not only
 * a courtesy to the network. A photograph straight off a phone is several
 * megabytes; a form submission that big is refused by the framework before any
 * of our code runs, and the parent gets a whole-page "something went wrong"
 * that no message of ours can improve. Shrinking first means a picture that
 * large simply never leaves the device — and the EXIF that would have said
 * where a child was photographed does not leave it either, because a canvas
 * re-encode has nowhere to put it.
 *
 * Shrinking is still not a control. `validateUpload` checks the bytes that
 * actually arrive, and refuses independently.
 */
/**
 * What the picker says about the picture that was just chosen.
 *
 * `problem` is the size being outside the band — the one thing here that asks
 * the parent to go back and choose again, so it is the one thing said in red.
 * `offerTool` is narrower still: a way to make a picture smaller helps nobody
 * whose picture is too small.
 */
interface PhotoNote {
  text: string;
  problem: boolean;
  offerTool?: boolean;
}

export function PhotoPicker({
  avatarKey,
  onAvatarChange,
  onPhotoChange,
  error,
}: {
  avatarKey: string;
  onAvatarChange: (key: string) => void;
  onPhotoChange: (hasPhoto: boolean) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The file the parent chose, kept so it can be put back.
   *
   * React empties every uncontrolled field — a file input included — once the
   * form's action returns. This component's own state survives that, so without
   * this the preview would still be sitting there showing a photograph that is
   * no longer attached to anything, and the second submit would quietly send no
   * picture at all. Holding the File and re-attaching it is the only way to
   * make what the parent sees and what the form carries agree.
   */
  const chosenFile = useRef<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState<PhotoNote | null>(null);
  const inputId = useId();

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!file) {
      chosenFile.current = null;
      setPreviewUrl(null);
      setNote(null);
      onPhotoChange(false);
      return;
    }

    /*
     * Named and measured before anything is done to it. Preparing a phone
     * photograph takes a second or two, and a picker that shows nothing in that
     * gap is a picker a parent taps twice — but more than that, a parent who
     * picked the wrong file from a camera roll of near-identical thumbnails
     * should find that out from the name, here, and not from the librarian.
     */
    /*
     * The floor is judged here, on the file as chosen, before anything is done
     * to it — see @/lib/child-photo for why it cannot be judged on the result.
     * It is also the fastest answer this picker can give: a 17 KB thumbnail is
     * refused without a single re-encode.
     */
    if (file.size < CHILD_PHOTO_MIN_BYTES) {
      clearPhoto();
      setNote({
        text:
          `${file.name} — ${describeSize(file.size)}. ` +
          `Too small to stay sharp on a library card.`,
        problem: true,
      });
      return;
    }

    setNote({
      text: `${file.name} — ${describeSize(file.size)}. Checking the picture…`,
      problem: false,
    });

    const { file: prepared } = await shrinkToBand(file, {
      topEdge: MAX_PHOTO_EDGE,
      maxBytes: CHILD_PHOTO_MAX_BYTES,
    });

    /*
     * Outside the band, the picture is let go of rather than left attached to
     * fail later at the desk. The photo is optional, so a parent loses nothing
     * by carrying on with an avatar — and the sentence says the size, both ends
     * of the rule, and where to fix it.
     */
    /*
     * The ceiling, judged on what would actually be sent. Reached only when
     * every rung of the ladder failed — a picture beyond what a browser
     * re-encode can do, or a file the browser could not decode at all — which
     * is the one case where sending a parent to another tool is genuinely the
     * help available rather than an excuse.
     */
    if (prepared.size > CHILD_PHOTO_MAX_BYTES) {
      clearPhoto();
      setNote({
        text: `${file.name} — ${sizeStory(file, prepared)}. Too big for a library card.`,
        problem: true,
        offerTool: true,
      });
      return;
    }

    /*
     * Put the smaller file back into the input so the ordinary form submission
     * carries it. A DataTransfer is the only way to assign to `input.files`,
     * and assigning does not fire another change event — which is what keeps
     * this from looping.
     */
    if (prepared !== file && inputRef.current && typeof DataTransfer === "function") {
      const transfer = new DataTransfer();
      transfer.items.add(prepared);
      inputRef.current.files = transfer.files;
    }

    chosenFile.current = prepared;
    setPreviewUrl(URL.createObjectURL(prepared));
    setNote({
      text: `${prepared.name} — ${sizeStory(file, prepared)}. Ready.`,
      problem: false,
    });
    onPhotoChange(true);
  }

  /*
   * Runs after every render, and does nothing on almost all of them. It matters
   * on exactly one: the render after a refused submission, where the input has
   * been emptied underneath a preview that is still on screen.
   */
  useEffect(() => {
    const input = inputRef.current;
    const file = chosenFile.current;
    // A browser with no DataTransfer has nowhere to put the file back, and
    // behaves as it did before this existed: the parent chooses the photo
    // again. Every browser released since 2016 has one.
    if (!input || !file || input.files?.length) return;
    if (typeof DataTransfer !== "function") return;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  });

  function clearPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    chosenFile.current = null;
    setPreviewUrl(null);
    setNote(null);
    // Clearing the input matters: without it the browser would still submit the
    // file the parent just said they did not want.
    if (inputRef.current) inputRef.current.value = "";
    onPhotoChange(false);
  }

  return (
    <div>
      <input type="hidden" name="avatarKey" value={avatarKey} />

      {error ? (
        <p role="alert" className="mb-4 text-base font-bold text-danger">
          {error}
        </p>
      ) : null}

      <fieldset>
        <legend className="text-lg font-bold text-ink">Choose an avatar</legend>
        <div className="mt-3 flex flex-wrap gap-3">
          {AVATARS.map((avatar) => {
            const selected = avatar.key === avatarKey;
            return (
              <button
                key={avatar.key}
                type="button"
                onClick={() => onAvatarChange(avatar.key)}
                aria-pressed={selected}
                className={cn(
                  "rounded-full p-1 transition-transform",
                  selected
                    ? "ring-4 ring-primary-deep"
                    : "ring-2 ring-transparent hover:ring-control-border",
                )}
              >
                <MemberAvatar avatarKey={avatar.key} name={avatar.label} size={56} />
                <span className="sr-only">{avatar.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-8 rounded-[var(--radius-field)] bg-surface-sunk p-5">
        <p className="text-lg font-bold text-ink">Or add a photo, if you would like to</p>
        <p className="mt-1 text-base text-ink-soft">
          {/*
            This sentence is a promise made at the exact moment a parent decides
            whether to hand over a picture of their child, so it has to match
            what the library actually does. It used to say the photo was "never
            published" and seen only by the child and the librarian, which the
            readers' card contradicted the day that shipped. See ADR-055.
          */}
          Completely optional — an avatar works just as well. A photo stays inside the library:
          the librarian and your child can see it, and it may appear beside your child&rsquo;s
          first name on the readers&rsquo; card that other members see when they sign in. It never
          leaves the library, is never used for advertising, and you can ask us to remove it — or
          to leave your child off that card — at any time.
        </p>

        {/* Visually hidden rather than styled: a native file input cannot be
            restyled reliably, and a parent on a phone needs the real one. */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          name="childPhoto"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFile}
          className="sr-only"
        />

        {/*
          Said next to the button that was pressed, not at the top of the card.
          A size a parent has to act on is no use above the fold of a section
          they have already scrolled past.
        */}
        {note ? (
          <p
            role={note.problem ? "alert" : undefined}
            className={cn(
              "mt-4 text-base",
              note.problem ? "font-bold text-danger" : "text-ink-soft",
            )}
          >
            {note.text}
            {note.problem ? (
              <>
                {" "}
                Please choose one between {describeSize(CHILD_PHOTO_MIN_BYTES)} and{" "}
                {describeSize(CHILD_PHOTO_MAX_BYTES)}, or carry on with an avatar
                instead.
              </>
            ) : null}
            {note.offerTool ? (
              <>
                {" "}
                You can shrink it with{" "}
                <a
                  href={COMPRESS_TOOL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Compress Image
                </a>{" "}
                — it opens in a new tab, works inside your own browser, and the
                picture is never uploaded anywhere. Give it a target size of{" "}
                {describeSize(CHILD_PHOTO_MAX_BYTES)}.
              </>
            ) : null}
          </p>
        ) : null}

        {previewUrl ? (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, never uploaded to render */}
            <img
              src={previewUrl}
              alt="The photo you chose"
              width={72}
              height={72}
              className="h-[72px] w-[72px] rounded-full object-cover"
            />
            <div className="min-w-0">
              {/* The name is in the note above, which is where the size is
                  too — saying it again here is the same word twice in two
                  lines. */}
              <button
                type="button"
                onClick={clearPhoto}
                className="mt-1 text-base font-bold text-primary-deep underline"
              >
                Remove this photo and use the avatar instead
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              icon={<Icon name="camera" />}
            >
              Choose a photo
            </Button>
            {/* Both ends read from the rule rather than typed, because the two
                saying different things is how a parent ends up sending a
                picture the library cannot accept. */}
            <p className="mt-2 text-sm text-ink-soft">
              JPG, PNG or WebP, between {describeSize(CHILD_PHOTO_MIN_BYTES)} and{" "}
              {describeSize(CHILD_PHOTO_MAX_BYTES)}. Large photos are made smaller on
              your phone before they are sent, and we will tell you the size as soon
              as you choose one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
