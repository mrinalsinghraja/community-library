"use client";

import { useEffect, useId, useRef, useState } from "react";

import { MemberAvatar } from "@/components/library/avatar";
import { Button } from "@/components/ui/button";
import { AVATARS } from "@/lib/avatars";
import { CHILD_PHOTO_MAX_BYTES, MAX_PHOTO_EDGE } from "@/lib/child-photo";
import { cn } from "@/lib/cn";
import { describeSize } from "@/lib/file-size";
import { downscaleImage } from "@/lib/image-downscale";
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const inputId = useId();

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setTooBig(null);

    if (!file) {
      chosenFile.current = null;
      setPreviewUrl(null);
      setFileName(null);
      onPhotoChange(false);
      return;
    }

    // No floor: a card picture is a small round avatar, and a portrait that
    // shrinks to 40 KB is a perfectly good one.
    const { file: prepared } = await downscaleImage(file, {
      maxEdge: MAX_PHOTO_EDGE,
      minBytes: 0,
    });

    /*
     * A picture still too big after shrinking — a browser without a canvas, a
     * format the codec would not read — is refused here, in a sentence, rather
     * than by the framework in a page that says nothing useful. The photo is
     * optional, so the parent loses nothing by carrying on with an avatar.
     */
    if (prepared.size > CHILD_PHOTO_MAX_BYTES) {
      chosenFile.current = null;
      clearPhoto();
      setTooBig(
        `That picture is ${describeSize(prepared.size)}, which is too big to send. ` +
          `Please choose one under ${describeSize(CHILD_PHOTO_MAX_BYTES)}, or carry on ` +
          `with an avatar instead.`,
      );
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
    setFileName(prepared.name);
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
    setFileName(null);
    // Clearing the input matters: without it the browser would still submit the
    // file the parent just said they did not want.
    if (inputRef.current) inputRef.current.value = "";
    onPhotoChange(false);
  }

  return (
    <div>
      <input type="hidden" name="avatarKey" value={avatarKey} />

      {error || tooBig ? (
        <p role="alert" className="mb-4 text-base font-bold text-danger">
          {error ?? tooBig}
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
              <p className="truncate text-base font-bold text-ink">{fileName}</p>
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
            {/* The size is read from the rule rather than typed, because the
                two saying different things is how a parent ends up sending a
                picture the library cannot accept. */}
            <p className="mt-2 text-sm text-ink-soft">
              JPG, PNG or WebP, up to {describeSize(CHILD_PHOTO_MAX_BYTES)}. Large
              photos are made smaller on your phone before they are sent.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
