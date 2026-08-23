"use client";

import { useId, useRef, useState } from "react";

import { MemberAvatar } from "@/components/library/avatar";
import { Button } from "@/components/ui/button";
import { AVATARS } from "@/lib/avatars";
import { cn } from "@/lib/cn";
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputId = useId();

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!file) {
      setPreviewUrl(null);
      setFileName(null);
      onPhotoChange(false);
      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
    setFileName(file.name);
    onPhotoChange(true);
  }

  function clearPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
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
            <p className="mt-2 text-sm text-ink-soft">JPG, PNG or WebP, up to 5 MB.</p>
          </div>
        )}
      </div>
    </div>
  );
}
