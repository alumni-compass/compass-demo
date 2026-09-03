"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import type { Id } from "@RIT-ALUMINI/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import PostMedia from "@/components/feed/post-media";
import { actionErrorMessage, Avatar, VerifiedMark } from "@/components/kit";

/**
 * One post.
 *
 * THE SIGNATURE IS THE LIKE, and it is a seal rather than a heart. This
 * association's own world is letterhead, a crest and stamped approval, so
 * approving a post presses a seal into it: the mark springs, a brass ring
 * expands out of it once, and the count rolls over. The label stays the word
 * everybody already knows — a familiar name on an unfamiliar gesture, not the
 * other way round. It is the one loud moment on the card; everything else is
 * hairlines, mono labels and quiet.
 *
 * THE MONO LAYER IS THE TEXTURE. Every count, timestamp and label is set in the
 * monospace face, uppercase and tracked. That is what keeps this feed reading
 * like an institution's noticeboard instead of a generic social app, without
 * spending a single colour or border on decoration.
 *
 * COMMENTS ARE NOT FETCHED UNTIL ASKED FOR. `commentsFor` is subscribed to only
 * once a card is expanded, so a feed of thirty posts opens thirty subscriptions
 * to posts, not to every comment on every post.
 *
 * A SHARE RENDERS ITS ORIGINAL INSIDE ITSELF, quoted and inert: no like button,
 * no lightbox, no nested share. The engagement on the card belongs to the
 * share; the original keeps its own, wherever it sits in the feed.
 */

/**
 * Derived from the query rather than written out.
 *
 * A hand-kept mirror of the server's shape is a second definition that goes
 * stale the first time a field is added to `decorate` — and it goes stale
 * silently, because both sides still compile.
 */
export type FeedPost = FunctionReturnType<
  typeof api.feed.generalFeed
>["posts"][number];

type Author = FeedPost["author"];

/** "4m", "3h", "2d", then the date. Absolute past a week — "9d" means nothing. */
function ago(ts: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: days > 330 ? "numeric" : undefined,
  });
}

/** Batch · department · role at company, with the empty parts dropped. */
function subtitle(author: Author) {
  const academic = [
    author.batch ? `Batch of ${author.batch}` : null,
    author.department,
  ]
    .filter(Boolean)
    .join(" · ");
  const work = [author.designation, author.company].filter(Boolean).join(" at ");
  return [academic, work].filter(Boolean).join(" — ");
}

/* ------------------------------------------------------------------ */
/* The seal                                                            */
/* ------------------------------------------------------------------ */

function Seal({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      {/* A notched disc: a wax seal, not a heart and not a thumb. */}
      <path
        d="M8 1.2l1.5 1.05 1.8-.35.75 1.68 1.6.9-.35 1.8.9 1.6-1.35 1.24-.35 1.8-1.82.15L8.6 14.6 8 14.8l-.6-.2-1.68-.82-1.82-.15-.35-1.8L2.2 10.6l.9-1.6-.35-1.8 1.6-.9.75-1.68 1.8.35L8 1.2z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1"
      />
      {active ? (
        <path
          d="M5.6 8.2l1.7 1.7 3.2-3.5"
          fill="none"
          stroke="#F7F5F0"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function ActionButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick?: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      className={`font-mono relative inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-control text-[0.68rem] uppercase tracking-[0.1em] transition-colors ${
        active
          ? "bg-maroon-tint text-maroon"
          : "text-slate-ink hover:bg-bone hover:text-ink"
      }`}
    >
      {children}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

function Comments({ postId }: { postId: Id<"posts"> }) {
  const comments = useQuery(api.feed.commentsFor, { postId });
  const addComment = useMutation(api.feed.addComment);
  const deleteComment = useMutation(api.feed.deleteComment);
  const me = useQuery(api.profiles.byEmail);
  const reduce = useReducedMotion();

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-t border-line bg-bone px-4 py-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim() || busy) return;
          setBusy(true);
          addComment({ postId, body: draft })
            .then(() => setDraft(""))
            .catch((error) => toast.error(actionErrorMessage(error)))
            .finally(() => setBusy(false));
        }}
        className="flex gap-2.5"
      >
        <Avatar name={me?.name ?? "You"} src={me?.avatarUrl ?? null} size="sm" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a comment"
          className="min-w-0 flex-1 rounded-chip border border-line bg-surface px-3.5 text-[0.875rem] text-ink placeholder:text-slate-soft focus:border-maroon focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="font-mono shrink-0 rounded-control px-3 text-[0.68rem] uppercase tracking-[0.1em] text-maroon transition-colors hover:text-maroon-deep disabled:opacity-40"
        >
          {busy ? "…" : "Reply"}
        </button>
      </form>

      {comments === undefined ? (
        <p className="font-mono mt-3 text-[0.68rem] uppercase tracking-[0.1em] text-slate-soft">
          Loading
        </p>
      ) : comments.length === 0 ? (
        <p className="mt-3 text-[0.8rem] text-slate-ink">
          No comments yet. Be the first to reply.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          <AnimatePresence initial={false}>
            {comments.map((comment) => (
              <motion.li
                key={String(comment._id)}
                layout={!reduce}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
                transition={{ duration: reduce ? 0.01 : 0.16 }}
                className="flex gap-2.5"
              >
                <Avatar
                  name={comment.author.name}
                  src={comment.author.avatarUrl}
                  size="sm"
                />
                <div className="min-w-0 flex-1 rounded-card border border-line bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-display text-[0.85rem] text-ink">
                      {comment.author.name}
                    </span>
                    {comment.author.verified ? <VerifiedMark /> : null}
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-slate-soft">
                      {ago(comment.createdAt)}
                    </span>
                    {comment.isMine ? (
                      <button
                        type="button"
                        onClick={() =>
                          deleteComment({ commentId: comment._id }).catch((error) =>
                            toast.error(actionErrorMessage(error)),
                          )
                        }
                        className="font-mono ml-auto text-[0.62rem] uppercase tracking-[0.1em] text-slate-soft transition-colors hover:text-maroon"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">
                    {comment.body}
                  </p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

function AuthorLine({
  author,
  createdAt,
  editedAt,
  small,
}: {
  author: Author;
  createdAt: number;
  editedAt?: number | null;
  small?: boolean;
}) {
  const name = (
    <span
      className={`font-display text-ink ${small ? "text-[0.875rem]" : "text-[0.95rem]"}`}
    >
      {author.name}
    </span>
  );

  return (
    <div className="flex min-w-0 gap-3">
      <Avatar name={author.name} src={author.avatarUrl} size="sm" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2">
          {author.alumniId ? (
            <Link
              href={`/directory/${author.alumniId}`}
              className="transition-colors hover:text-maroon"
            >
              {name}
            </Link>
          ) : (
            name
          )}
          {author.verified ? <VerifiedMark /> : null}
        </div>
        {subtitle(author) ? (
          <p className="truncate text-[0.75rem] leading-snug text-slate-ink">
            {subtitle(author)}
          </p>
        ) : null}
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-slate-soft">
          {ago(createdAt)}
          {editedAt ? " · edited" : ""}
        </p>
      </div>
    </div>
  );
}

export default function PostCard({ post }: { post: FeedPost }) {
  const toggleLike = useMutation(api.feed.toggleLike);
  const votePoll = useMutation(api.feed.votePoll);
  const deletePost = useMutation(api.feed.deletePost);
  const sharePost = useMutation(api.feed.sharePost);
  const reduce = useReducedMotion();

  const [showComments, setShowComments] = useState(false);
  const [stamping, setStamping] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [busy, setBusy] = useState(false);

  function like() {
    // The ring is keyed on a counter so a rapid double-press re-runs it.
    if (!post.likedByMe) setStamping((n) => n + 1);
    toggleLike({ postId: post._id }).catch((error) =>
      toast.error(actionErrorMessage(error)),
    );
  }

  const counts = [
    post.likeCount > 0
      ? `${post.likeCount} ${post.likeCount === 1 ? "seal" : "seals"}`
      : null,
    post.commentCount > 0
      ? `${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}`
      : null,
    post.shareCount > 0 ? `${post.shareCount} shared` : null,
  ].filter(Boolean);

  return (
    <motion.article
      layout={!reduce}
      className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
    >
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <AuthorLine
          author={post.author}
          createdAt={post.createdAt}
          editedAt={post.editedAt}
        />
        {post.isMine ? (
          <button
            type="button"
            onClick={() => {
              if (busy) return;
              setBusy(true);
              deletePost({ postId: post._id })
                .then(() => toast.success("Post deleted."))
                .catch((error) => toast.error(actionErrorMessage(error)))
                .finally(() => setBusy(false));
            }}
            className="font-mono shrink-0 rounded-control px-2 py-1 text-[0.62rem] uppercase tracking-[0.1em] text-slate-soft transition-colors hover:bg-maroon-tint hover:text-maroon"
          >
            Delete
          </button>
        ) : null}
      </div>

      {post.hidden ? (
        <p className="font-mono mx-4 mb-3 rounded-control border border-maroon/30 bg-maroon-tint px-3 py-2 text-[0.65rem] uppercase tracking-[0.1em] text-maroon">
          Hidden by a moderator{post.hiddenReason ? ` — ${post.hiddenReason}` : ""}
        </p>
      ) : null}

      {post.body ? (
        <p className="whitespace-pre-wrap px-4 text-[0.95rem] leading-relaxed text-ink">
          {post.body}
        </p>
      ) : null}

      <div className="px-4">
        <PostMedia imageUrls={post.imageUrls} videoUrls={post.videoUrls} />
      </div>

      {/* The quoted original, inert. */}
      {post.sharedFrom ? (
        <div className="mx-4 mt-3 rounded-card border border-line bg-bone p-3">
          <AuthorLine
            author={post.sharedFrom.author}
            createdAt={post.sharedFrom.createdAt}
            small
          />
          {post.sharedFrom.body ? (
            <p className="mt-2 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">
              {post.sharedFrom.body}
            </p>
          ) : null}
          <PostMedia
            imageUrls={post.sharedFrom.imageUrls}
            videoUrls={post.sharedFrom.videoUrls}
            compact
          />
        </div>
      ) : post.sharedFromMissing ? (
        <p className="mx-4 mt-3 rounded-card border border-dashed border-line bg-bone p-3 text-[0.8rem] text-slate-ink">
          The post this shared has since been deleted.
        </p>
      ) : null}

      {/* Poll */}
      {post.poll ? (
        <div className="mt-3 space-y-1.5 px-4">
          {post.poll.options.map((option) => {
            const mine = post.poll?.myAnswer === option.label;
            const pct = Math.round(option.share * 100);
            return (
              <button
                key={option.label}
                type="button"
                onClick={() =>
                  votePoll({
                    questionId: post.poll!.questionId,
                    answer: option.label,
                  }).catch((error) => toast.error(actionErrorMessage(error)))
                }
                className={`relative block w-full overflow-hidden rounded-control border px-3 py-2 text-left transition-colors ${
                  mine
                    ? "border-maroon/45 bg-maroon-tint"
                    : "border-line hover:border-line-strong"
                }`}
              >
                <motion.span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-brass/20"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: reduce ? 0.01 : 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="text-[0.875rem] text-ink">{option.label}</span>
                  <span className="font-mono shrink-0 text-[0.68rem] tabular-nums text-slate-ink">
                    {pct}% · {option.votes}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="font-mono pt-1 text-[0.62rem] uppercase tracking-[0.1em] text-slate-soft">
            {post.poll.totalVotes}{" "}
            {post.poll.totalVotes === 1 ? "vote" : "votes"}
            {post.poll.myAnswer ? " · you voted" : " · one vote each"}
          </p>
        </div>
      ) : null}

      {counts.length > 0 ? (
        <p className="font-mono mt-3 border-t border-line px-4 pt-2.5 text-[0.65rem] uppercase tracking-[0.1em] text-slate-ink">
          {counts.join(" · ")}
        </p>
      ) : (
        <div className="mt-3 border-t border-line" />
      )}

      <div className="flex items-stretch gap-1 p-2">
        <ActionButton
          onClick={like}
          active={post.likedByMe}
          label={post.likedByMe ? "Remove your seal" : "Add your seal"}
        >
          <span className="relative inline-flex items-center">
            <motion.span
              key={stamping}
              initial={
                reduce || stamping === 0 ? false : { scale: 0.75, rotate: -12 }
              }
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 620, damping: 14 }}
              className="inline-flex"
            >
              <Seal active={post.likedByMe} />
            </motion.span>
            {/* The ring: one expanding brass circle, once, on stamping. */}
            <AnimatePresence>
              {stamping > 0 && post.likedByMe && !reduce ? (
                <motion.span
                  key={`ring-${stamping}`}
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brass"
                  initial={{ scale: 0.6, opacity: 0.9 }}
                  animate={{ scale: 3.4, opacity: 0 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              ) : null}
            </AnimatePresence>
          </span>
          Like
        </ActionButton>

        <ActionButton
          onClick={() => setShowComments((value) => !value)}
          active={showComments}
          label="Comments"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
            <path
              d="M2.5 3.5h11v7.5h-6l-3 2.5v-2.5h-2V3.5z"
              stroke="currentColor"
            />
          </svg>
          Comment
        </ActionButton>

        <ActionButton
          onClick={() => setSharing((value) => !value)}
          active={sharing}
          label="Share this post"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
            <path
              d="M4 9.5v3h8v-3M8 11V3.2M8 3.2L5.4 5.9M8 3.2l2.6 2.7"
              stroke="currentColor"
              strokeLinecap="round"
            />
          </svg>
          Share
        </ActionButton>
      </div>

      <AnimatePresence initial={false}>
        {sharing ? (
          <motion.div
            key="share"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line bg-bone"
          >
            <div className="space-y-2 p-4">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-brass-ink">
                Share to the association feed
              </p>
              <textarea
                value={shareNote}
                rows={2}
                onChange={(event) => setShareNote(event.target.value)}
                placeholder="Add a note — optional"
                className="w-full resize-y rounded-control border border-line bg-surface px-3 py-2 text-[0.875rem] text-ink placeholder:text-slate-soft focus:border-maroon focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    sharePost({ postId: post._id, note: shareNote })
                      .then(() => {
                        setShareNote("");
                        setSharing(false);
                        toast.success("Shared to the feed.");
                      })
                      .catch((error) => toast.error(actionErrorMessage(error)))
                      .finally(() => setBusy(false));
                  }}
                  className="font-mono inline-flex min-h-9 items-center rounded-control bg-maroon px-4 text-[0.68rem] uppercase tracking-[0.12em] text-bone transition-colors hover:bg-maroon-deep disabled:opacity-45"
                >
                  {busy ? "Sharing…" : "Share"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(`${window.location.origin}/feed#${post._id}`)
                      .then(() => toast.success("Link copied."))
                      .catch(() => toast.error("Could not copy the link."));
                  }}
                  className="font-mono min-h-9 rounded-control border border-line px-3 text-[0.68rem] uppercase tracking-[0.1em] text-slate-ink transition-colors hover:border-line-strong hover:text-ink"
                >
                  Copy link
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showComments ? (
          <motion.div
            key="comments"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <Comments postId={post._id} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
