"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { actionErrorMessage, Avatar } from "@/components/kit";

/**
 * The composer.
 *
 * IT STARTS SMALL. Collapsed, it is one line: the member's own mark and a
 * prompt. A feed that opens with a tall empty form pushes everyone else's posts
 * below the fold and tells the reader the page is about writing, when almost
 * every visit is about reading. It grows on focus, and only then does it show
 * the three things a post can carry.
 *
 * PHOTO AND VIDEO ARE ADDRESSES, not uploads — the portal stores no files, so
 * the field asks for the one thing it can actually use. That is stated in the
 * field's own label rather than discovered after a failed drag.
 *
 * THE POLL IS THE SAME POST. `createPost` writes the question row in the same
 * transaction, so a poll cannot exist without its options — which is why the
 * options live in this form and not in a second step.
 */

const MAX_BODY = 5000;
const MAX_IMAGES = 4;
const MIN_POLL = 2;
const MAX_POLL = 6;

const CONTROL =
  "w-full rounded-control border border-line bg-surface px-4 py-2.5 text-[0.9375rem] text-ink transition-colors placeholder:text-slate-soft hover:border-line-strong focus:border-maroon focus:outline-none";

type Mode = "photo" | "video" | "poll" | null;

/** The three things a post can carry, drawn as marks rather than icon-library glyphs. */
function ModeIcon({ mode }: { mode: Exclude<Mode, null> }) {
  if (mode === "photo") {
    return (
      <svg viewBox="0 0 16 16" className="size-[1.15rem]" fill="none" aria-hidden>
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" />
        <circle cx="5.5" cy="6.5" r="1.15" fill="currentColor" />
        <path d="M2.5 12l3.6-3.4 2.4 2.2 2.1-1.9 2.9 3.1" stroke="currentColor" />
      </svg>
    );
  }
  if (mode === "video") {
    return (
      <svg viewBox="0 0 16 16" className="size-[1.15rem]" fill="none" aria-hidden>
        <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" stroke="currentColor" />
        <path d="M10.5 8l4-2.3v4.6L10.5 8z" stroke="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="size-[1.15rem]" fill="none" aria-hidden>
      <path d="M2.5 4.5h11M2.5 8h7.5M2.5 11.5h4" stroke="currentColor" />
    </svg>
  );
}

export default function Composer() {
  const me = useQuery(api.profiles.byEmail);
  const createPost = useMutation(api.feed.createPost);
  const reduce = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([""]);
  const [video, setVideo] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const name = me?.name ?? "You";
  const remaining = MAX_BODY - body.length;
  const canPost = body.trim().length > 0 && !busy;

  function reset() {
    setBody("");
    setImages([""]);
    setVideo("");
    setOptions(["", ""]);
    setMode(null);
    setOpen(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    try {
      await createPost({
        body,
        imageUrls: mode === "photo" ? images.filter((url) => url.trim()) : undefined,
        videoUrls: mode === "video" && video.trim() ? [video] : undefined,
        pollOptions:
          mode === "poll" ? options.filter((option) => option.trim()) : undefined,
      });
      reset();
      toast.success("Posted.");
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.form
      onSubmit={submit}
      layout={reduce ? false : "position"}
      className="overflow-hidden rounded-[14px] bg-surface shadow-card"
    >
      {/* The brass spine marks the one place on the page that writes. */}
      <div className="flex gap-3.5 border-l-2 border-brass p-5">
        <Avatar name={name} src={me?.avatarUrl ?? null} size="md" />

        <div className="min-w-0 flex-1">
          {open ? (
            <textarea
              ref={area}
              autoFocus
              value={body}
              maxLength={MAX_BODY}
              onChange={(event) => setBody(event.target.value)}
              placeholder={`What is happening, ${name.split(" ")[0]}?`}
              rows={3}
              className="w-full resize-y border-0 bg-transparent p-0 text-[1.0625rem] leading-[1.6] text-ink placeholder:text-slate-soft focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex min-h-12 w-full items-center rounded-chip border border-line bg-bone px-5 text-left text-[1rem] text-slate-ink transition-colors hover:border-line-strong hover:bg-bone-deep"
            >
              Share something with the association
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="expanded"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Whichever attachment the member chose. */}
            <AnimatePresence mode="wait">
              {mode ? (
                <motion.div
                  key={mode}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: reduce ? 0.01 : 0.15 }}
                  className="mx-5 mb-4 space-y-2.5 rounded-card border border-line bg-bone p-4"
                >
                  {mode === "photo" ? (
                    <>
                      <p className="text-[0.875rem] font-medium text-brass-ink">
                        Image links · up to {MAX_IMAGES}
                      </p>
                      {images.map((url, index) => (
                        <input
                          key={index}
                          className={CONTROL}
                          value={url}
                          placeholder="https://…"
                          onChange={(event) => {
                            const next = [...images];
                            next[index] = event.target.value;
                            setImages(next);
                          }}
                        />
                      ))}
                      {images.length < MAX_IMAGES ? (
                        <button
                          type="button"
                          onClick={() => setImages([...images, ""])}
                          className="text-[0.875rem] font-medium text-maroon hover:text-maroon-deep"
                        >
                          + another image
                        </button>
                      ) : null}
                      <p className="text-[0.8125rem] leading-relaxed text-slate-ink">
                        Paste the address of an image already online. The portal
                        stores no files.
                      </p>
                    </>
                  ) : null}

                  {mode === "video" ? (
                    <>
                      <p className="text-[0.875rem] font-medium text-brass-ink">
                        Video link
                      </p>
                      <input
                        className={CONTROL}
                        value={video}
                        placeholder="https://youtube.com/watch?v=… or an mp4 address"
                        onChange={(event) => setVideo(event.target.value)}
                      />
                      <p className="text-[0.8125rem] leading-relaxed text-slate-ink">
                        A YouTube or Vimeo link plays as an embed. Any other
                        address plays in the browser&rsquo;s own player.
                      </p>
                    </>
                  ) : null}

                  {mode === "poll" ? (
                    <>
                      <p className="text-[0.875rem] font-medium text-brass-ink">
                        Poll options · {MIN_POLL} to {MAX_POLL}
                      </p>
                      {options.map((option, index) => (
                        <input
                          key={index}
                          className={CONTROL}
                          value={option}
                          placeholder={`Option ${index + 1}`}
                          onChange={(event) => {
                            const next = [...options];
                            next[index] = event.target.value;
                            setOptions(next);
                          }}
                        />
                      ))}
                      <div className="flex gap-3">
                        {options.length < MAX_POLL ? (
                          <button
                            type="button"
                            onClick={() => setOptions([...options, ""])}
                            className="text-[0.875rem] font-medium text-maroon hover:text-maroon-deep"
                          >
                            + option
                          </button>
                        ) : null}
                        {options.length > MIN_POLL ? (
                          <button
                            type="button"
                            onClick={() => setOptions(options.slice(0, -1))}
                            className="text-[0.875rem] text-slate-ink hover:text-ink"
                          >
                            − option
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[0.8125rem] leading-relaxed text-slate-ink">
                        Your post becomes the question. One vote per member, and
                        the result is visible to everyone.
                      </p>
                    </>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-5 py-4">
              {(["photo", "video", "poll"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(mode === option ? null : option)}
                  aria-pressed={mode === option}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-chip border px-3.5 text-[0.875rem] font-medium capitalize transition-colors ${
                    mode === option
                      ? "border-maroon/40 bg-maroon-tint text-maroon"
                      : "border-line text-slate-ink hover:border-line-strong hover:text-ink"
                  }`}
                >
                  <ModeIcon mode={option} />
                  {option}
                </button>
              ))}

              <span className="ml-auto flex items-center gap-3">
                {remaining < 500 ? (
                  <span
                    className={`font-mono text-[0.8125rem] tabular-nums ${
                      remaining < 0 ? "text-maroon" : "text-slate-ink"
                    }`}
                  >
                    {remaining}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={reset}
                  className="min-h-10 rounded-control px-3 text-[0.9375rem] text-slate-ink transition-colors hover:text-ink"
                >
                  Cancel
                </button>
                <motion.button
                  type="submit"
                  disabled={!canPost}
                  whileTap={reduce || !canPost ? undefined : { scale: 0.97 }}
                  className="inline-flex min-h-10 items-center rounded-control bg-maroon px-5 text-[0.9375rem] font-medium text-bone shadow-panel transition-colors hover:bg-maroon-deep disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy ? "Posting…" : "Post"}
                </motion.button>
              </span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.form>
  );
}
