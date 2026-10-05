"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, actionErrorMessage } from "@/components/kit";

/**
 * Changing the photograph on your own record.
 *
 * WHY IT LIVES ON ITS OWN. The rest of the profile is a form you fill in and
 * then save; a photograph is not. Nobody expects to pick a picture, scroll to
 * the bottom and press Save — they expect the face to change as soon as they
 * choose it. So this component owns its own upload and writes immediately,
 * which is also why it can sit inside a <form> without becoming part of it.
 *
 * WHAT IT ACTUALLY DOES. Three steps, hidden behind one file input: ask the
 * server for a signed upload URL, POST the file straight to storage, then hand
 * the storage id back so the server can attach it. The bytes never travel
 * through a Convex mutation, which is what lets a phone photograph — routinely
 * three or four megabytes — work at all.
 *
 * The preview is a local object URL shown the instant a file is chosen, so the
 * new face appears while the upload is still in flight rather than after it.
 */

/** Two megabytes. Large enough for a phone photograph, small enough to be quick. */
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default function AvatarPicker({
  name,
  currentUrl,
}: {
  name: string;
  /** What is on the record now. Null renders the monogram. */
  currentUrl: string | null;
}) {
  const generateUploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);
  const removeAvatar = useMutation(api.profiles.removeAvatar);

  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = preview ?? currentUrl;

  async function handleFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Choose a JPEG, PNG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. Choose one under 8MB.`,
      );
      return;
    }

    // Shown straight away, so the face changes when the file is chosen rather
    // than when the round trip finishes.
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy(true);

    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with ${response.status}`);
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await setAvatar({ storageId });
      toast.success("Photograph updated. It now shows on everything you have posted.");
    } catch (error) {
      // Drop the preview so the face does not lie about what was saved.
      setPreview(null);
      toast.error(actionErrorMessage(error));
    } finally {
      URL.revokeObjectURL(localUrl);
      setBusy(false);
      // Cleared so choosing the same file twice fires change again.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await removeAvatar();
      setPreview(null);
      toast.success("Photograph removed.");
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0">
        <Avatar name={name} src={shown} size="lg" />
        {busy ? (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-full bg-ink/55"
          >
            <span className="size-4 animate-spin rounded-full border-2 border-bone/40 border-t-bone" />
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="text-[0.9rem] font-medium text-ink">Profile photograph</p>
        <p className="mt-1 max-w-sm text-[0.82rem] leading-relaxed text-slate-ink">
          Shown beside your name in the directory, on every post you have written
          and on every comment. JPEG, PNG, WebP or GIF, up to 8MB.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {/*
            The input is the control, styled as a button via its label, rather
            than a button that reaches for a hidden input. Keyboard focus and
            the file dialog then behave the way the browser intends.
          */}
          <label
            className={`inline-flex min-h-10 cursor-pointer items-center rounded-control border border-line-strong bg-surface px-4 text-[0.85rem] font-medium text-ink transition-colors hover:border-maroon hover:text-maroon focus-within:border-maroon ${
              busy ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {shown ? "Change photograph" : "Add a photograph"}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(",")}
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>

          {currentUrl ? (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="min-h-10 rounded-control px-3 text-[0.85rem] text-slate-ink transition-colors hover:text-maroon disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
