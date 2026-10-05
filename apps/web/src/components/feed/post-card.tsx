"use client";

import { api, type Id, useMutation, useQuery, type FunctionReturnType } from "@/lib/standalone";

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

/**
 * The like, drawn as a thumb.
 *
 * It used to be a wax seal -- a notched disc -- with the label "Add your
 * seal". The institutional idiom is right for a masthead and wrong for the
 * one control on the page whose entire job is to be recognised without
 * being read. Nobody scanning a feed stops to work out what a notched disc
 * does; everybody knows the thumb. Outline when you have not pressed it,
 * solid when you have, which is the only state anybody needs to read.
 */
function LikeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-[1.15rem]" aria-hidden>
      <path
        d="M6.4 17.2V8.6l3.4-5.4a1.5 1.5 0 0 1 2.7 1.1l-.7 3.1h4a1.6 1.6 0 0 1 1.6 2l-1.5 6a1.9 1.9 0 0 1-1.8 1.4H6.4z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* The cuff, kept as a separate stroke so the solid state still reads
          as a hand rather than as one filled blob. */}
      <path
        d="M6.4 8.9H3.9a1 1 0 0 0-1 1v6.3a1 1 0 0 0 1 1h2.5z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActionButton({
  onClick,
  active,
  label,
  count = 0,
  children,
}: {
  onClick?: () => void;
  active?: boolean;
  label: string;
  /** Shown beside the label once there is one. Zero stays blank. */
  count?: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={count > 0 ? `${label} · ${count}` : label}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      className={`relative inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control text-[0.9375rem] font-medium transition-colors ${
        active
          ? "bg-maroon-tint text-maroon"
          : "text-slate-ink hover:bg-bone hover:text-ink"
      }`}
    >
      {children}
      {/*
        The count sits on the control, not only in the summary line above it.
        A zero renders as nothing rather than as "0" -- an empty post should
        read as quiet, not as a row of noughts.
      */}
      {count > 0 ? (
        <span className="font-mono text-[0.8125rem] tabular-nums opacity-80">
          {count}
        </span>
      ) : null}
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
    <div className="border-t border-line bg-bone px-5 py-4">
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
          className="min-w-0 flex-1 rounded-chip border border-line bg-surface px-4 py-2.5 text-[0.9375rem] text-ink placeholder:text-slate-soft focus:border-maroon focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="shrink-0 rounded-control px-3.5 text-[0.9375rem] font-medium text-maroon transition-colors hover:text-maroon-deep disabled:opacity-40"
        >
          {busy ? "…" : "Reply"}
        </button>
      </form>

      {comments === undefined ? (
        <p className="mt-4 text-[0.875rem] text-slate-soft">Loading</p>
      ) : comments.length === 0 ? (
        <p className="mt-4 text-[0.875rem] text-slate-ink">
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
                <div className="min-w-0 flex-1 rounded-card border border-line bg-surface px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-display text-[0.9375rem] font-medium text-ink">
                      {comment.author.name}
                    </span>
                    {comment.author.verified ? <VerifiedMark /> : null}
                    <span className="text-[0.8125rem] text-slate-soft">
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
                        className="ml-auto text-[0.8125rem] text-slate-soft transition-colors hover:text-maroon"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[0.9375rem] leading-[1.6] text-ink">
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
      className={`font-display font-medium text-ink ${
        small ? "text-[0.9375rem]" : "text-[1.0625rem]"
      }`}
    >
      {author.name}
    </span>
  );

  return (
    <div className="flex min-w-0 gap-3">
      <Avatar
        name={author.name}
        src={author.avatarUrl}
        size={small ? "sm" : "md"}
      />
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
          {/* Sized to the name: md against the 1.0625rem author line on a
              post, sm against the 0.9375rem one on a comment. */}
          {author.verified ? <VerifiedMark size={small ? "sm" : "md"} /> : null}
        </div>
        {subtitle(author) ? (
          <p className="truncate text-[0.8125rem] leading-snug text-slate-ink">
            {subtitle(author)}
          </p>
        ) : null}
        {/* A timestamp is read, not filed. Sentence-case sans at 13px, the
            size every feed uses, instead of 10px tracked capitals. */}
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-slate-soft">
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

  /*
   * The right-hand half of the summary line. Likes are not in here: they get
   * the badge on the left, the way every feed does it, because the number of
   * people who liked something is read differently from the number who
   * replied to it.
   */
  const engagement = [
    post.commentCount > 0
      ? `${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}`
      : null,
    post.shareCount > 0
      ? `${post.shareCount} ${post.shareCount === 1 ? "share" : "shares"}`
      : null,
  ].filter(Boolean);

  const hasCounts = post.likeCount > 0 || engagement.length > 0;

  return (
    <motion.article
      layout={!reduce}
      className="overflow-hidden rounded-[14px] bg-surface shadow-card"
    >
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
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
            className="shrink-0 rounded-control px-2.5 py-1.5 text-[0.8125rem] text-slate-soft transition-colors hover:bg-maroon-tint hover:text-maroon"
          >
            Delete
          </button>
        ) : null}
      </div>

      {post.hidden ? (
        <p className="mx-5 mb-3 rounded-control border border-maroon/30 bg-maroon-tint px-4 py-2.5 text-[0.875rem] text-maroon">
          Hidden by a moderator{post.hiddenReason ? ` — ${post.hiddenReason}` : ""}
        </p>
      ) : null}

      {/* 16px at 1.65 — the reading size, not the caption size. */}
      {post.body ? (
        <p className="whitespace-pre-wrap px-5 text-[1rem] leading-[1.65] text-ink">
          {post.body}
        </p>
      ) : null}

      <div className="px-5">
        <PostMedia imageUrls={post.imageUrls} videoUrls={post.videoUrls} />
      </div>

      {/* The quoted original, inert. */}
      {post.sharedFrom ? (
        <div className="mx-5 mt-4 rounded-card border border-line bg-bone p-4">
          <AuthorLine
            author={post.sharedFrom.author}
            createdAt={post.sharedFrom.createdAt}
            small
          />
          {post.sharedFrom.body ? (
            <p className="mt-2 whitespace-pre-wrap text-[0.9375rem] leading-[1.6] text-ink">
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
        <p className="mx-5 mt-4 rounded-card border border-dashed border-line bg-bone p-4 text-[0.875rem] text-slate-ink">
          The post this shared has since been deleted.
        </p>
      ) : null}

      {/* Poll */}
      {post.poll ? (
        <div className="mt-4 space-y-2 px-5">
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
                  <span className="text-[0.9375rem] text-ink">{option.label}</span>
                  {/* The tally stays mono: it is a column of figures, which is
                      the one place the utility face still earns its keep. */}
                  <span className="font-mono shrink-0 text-[0.8125rem] tabular-nums text-slate-ink">
                    {pct}% · {option.votes}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="pt-1.5 text-[0.8125rem] text-slate-soft">
            {post.poll.totalVotes}{" "}
            {post.poll.totalVotes === 1 ? "vote" : "votes"}
            {post.poll.myAnswer ? " · you voted" : " · one vote each"}
          </p>
        </div>
      ) : null}

      {hasCounts ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 pt-3 text-[0.8125rem] text-slate-ink">
          {post.likeCount > 0 ? (
            <span className="inline-flex items-center gap-2">
              {/* A filled thumb in a maroon disc, so the count on the left is
                  unmistakably the likes and not a total of everything. */}
              <span className="inline-flex size-[1.15rem] items-center justify-center rounded-full bg-maroon text-bone">
                <svg viewBox="0 0 20 20" className="size-3" aria-hidden>
                  <path
                    d="M6.4 17.2V8.6l3.4-5.4a1.5 1.5 0 0 1 2.7 1.1l-.7 3.1h4a1.6 1.6 0 0 1 1.6 2l-1.5 6a1.9 1.9 0 0 1-1.8 1.4H6.4zM6.4 8.9H3.9a1 1 0 0 0-1 1v6.3a1 1 0 0 0 1 1h2.5z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              {/* "You and 3 others" rather than a bare number, because the
                  fact that your own like registered is the thing you are
                  looking for after pressing it. */}
              <span>
                {post.likedByMe ? (
                  post.likeCount === 1 ? (
                    "You"
                  ) : (
                    <>
                      You and{" "}
                      <span className="font-mono tabular-nums">
                        {post.likeCount - 1}
                      </span>{" "}
                      {post.likeCount - 1 === 1 ? "other" : "others"}
                    </>
                  )
                ) : (
                  <span className="font-mono tabular-nums">{post.likeCount}</span>
                )}
              </span>
            </span>
          ) : (
            <span />
          )}
          {engagement.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowComments(true)}
              className="text-left transition-colors hover:text-maroon"
            >
              {engagement.join(" · ")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 border-t border-line" />
      )}

      <div className="flex items-stretch gap-1 p-2.5">
        <ActionButton
          onClick={like}
          active={post.likedByMe}
          count={post.likeCount}
          label={post.likedByMe ? "Undo your like" : "Like this post"}
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
              <LikeIcon active={post.likedByMe} />
            </motion.span>
            {/* The ring: one expanding brass circle, once, on stamping. */}
            <AnimatePresence>
              {stamping > 0 && post.likedByMe && !reduce ? (
                <motion.span
                  key={`ring-${stamping}`}
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brass"
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
          count={post.commentCount}
          label="Comments"
        >
          <svg viewBox="0 0 16 16" className="size-5" fill="none" aria-hidden>
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
          count={post.shareCount}
          label="Share this post"
        >
          <svg viewBox="0 0 16 16" className="size-5" fill="none" aria-hidden>
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
            <div className="space-y-3 p-5">
              <p className="text-[0.875rem] font-medium text-brass-ink">
                Share to the association feed
              </p>
              <textarea
                value={shareNote}
                rows={2}
                onChange={(event) => setShareNote(event.target.value)}
                placeholder="Add a note — optional"
                className="w-full resize-y rounded-control border border-line bg-surface px-4 py-3 text-[0.9375rem] leading-[1.6] text-ink placeholder:text-slate-soft focus:border-maroon focus:outline-none"
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
                  className="inline-flex min-h-10 items-center rounded-control bg-maroon px-5 text-[0.9375rem] font-medium text-bone transition-colors hover:bg-maroon-deep disabled:opacity-45"
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
                  className="min-h-10 rounded-control border border-line px-4 text-[0.9375rem] text-slate-ink transition-colors hover:border-line-strong hover:text-ink"
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
