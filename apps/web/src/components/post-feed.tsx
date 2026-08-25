"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import type { Id } from "@RIT-ALUMINI/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Avatar,
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  VerifiedMark,
} from "@/components/kit";

/**
 * The composer and the post list, shared by the general feed and every community.
 *
 * One component for both, because a post is the same object in both places — the
 * only difference is which `communityId` it carries, and that is a prop. Two
 * copies would drift the moment either gained a feature.
 */

type Post = FunctionReturnType<typeof api.feed.generalFeed>["posts"][number];

function reason(error: unknown) {
  return actionErrorMessage(error);
}

/** Relative for the recent past, then a date. Feeds are read newest-first. */
function when(ts: number) {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function shortBatch(batch: number | null) {
  if (batch === null || batch === 0) return null;
  return `’${String(batch).slice(2)}`;
}

/* ------------------------------------------------------------------ */
/* Composer                                                           */
/* ------------------------------------------------------------------ */

/**
 * Write a post, optionally as a poll.
 *
 * The poll options are hidden until asked for, so the default composer is one box.
 * A poll needs at least two options, which is enforced on the server too — the
 * button being disabled is the page agreeing with `feed.createPost`, not the check.
 */
export function Composer({
  communityId,
  placeholder,
}: {
  communityId?: Id<"communities">;
  placeholder: string;
}) {
  const createPost = useMutation(api.feed.createPost);
  const [body, setBody] = useState("");
  const [isPoll, setIsPoll] = useState(false);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);

  const liveOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
  const canSubmit =
    body.trim().length > 0 && (!isPoll || liveOptions.length >= 2) && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await createPost({
        communityId,
        body: body.trim(),
        pollOptions: isPoll ? liveOptions : undefined,
      });
      setBody("");
      setIsPoll(false);
      setOptions(["", ""]);
      toast.success("Posted.");
    } catch (error) {
      toast.error(reason(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <label htmlFor="post-body" className="sr-only">
          Write a post
        </label>
        <textarea
          id="post-body"
          rows={3}
          maxLength={5000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          className="w-full resize-none rounded-control border border-line bg-surface px-3.5 py-2.5 text-[0.95rem] leading-relaxed text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
        />

        {isPoll ? (
          <div className="mt-4 rounded-control border border-line bg-bone p-4">
            <Eyebrow>Poll options</Eyebrow>
            <div className="mt-3 space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="font-mono w-5 shrink-0 text-[0.7rem] tabular-nums text-slate-ink">
                    {index + 1}
                  </span>
                  <input
                    value={option}
                    maxLength={120}
                    onChange={(event) => {
                      const next = [...options];
                      next[index] = event.target.value;
                      setOptions(next);
                    }}
                    placeholder={`Option ${index + 1}`}
                    aria-label={`Poll option ${index + 1}`}
                    className="w-full rounded-control border border-line bg-surface px-3 py-2 text-[0.875rem] text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
                  />
                  {options.length > 2 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOptions(options.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove option ${index + 1}`}
                      className="font-mono shrink-0 px-2 text-[0.9rem] text-slate-ink transition-colors hover:text-maroon"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {options.length < 6 ? (
              <button
                type="button"
                onClick={() => setOptions([...options, ""])}
                className="font-mono mt-3 text-[0.7rem] uppercase tracking-[0.12em] text-maroon transition-colors hover:text-maroon-deep"
              >
                + Add option
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setIsPoll((v) => !v)}
            aria-pressed={isPoll}
            className={`font-mono inline-flex min-h-9 items-center rounded-control border px-3.5 text-[0.7rem] uppercase tracking-[0.12em] transition-colors ${
              isPoll
                ? "border-maroon bg-maroon-tint text-maroon"
                : "border-line text-slate-ink hover:border-maroon hover:text-maroon"
            }`}
          >
            {isPoll ? "Poll on" : "Add a poll"}
          </button>
          <Button type="submit" disabled={!canSubmit} size="sm">
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Poll                                                               */
/* ------------------------------------------------------------------ */

/**
 * Results are always visible, and voting is changeable.
 *
 * Hiding results until someone votes is a common pattern and the wrong one here:
 * these are association questions, not a game, and a member should be able to see
 * what the cohort thinks without being made to pick first.
 */
function Poll({ poll }: { poll: NonNullable<Post["poll"]> }) {
  const vote = useMutation(api.feed.votePoll);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="mt-4 space-y-2">
      {poll.options.map((option) => {
        const mine = poll.myAnswer === option.label;
        const pct = Math.round(option.share * 100);
        return (
          <button
            key={option.label}
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setBusy(option.label);
              vote({ questionId: poll.questionId, answer: option.label })
                .catch((error) => toast.error(reason(error)))
                .finally(() => setBusy(null));
            }}
            aria-pressed={mine}
            className={`relative block w-full overflow-hidden rounded-control border px-3.5 py-2.5 text-left transition-colors ${
              mine
                ? "border-maroon bg-maroon-tint"
                : "border-line bg-surface hover:border-maroon/50"
            }`}
          >
            {/* The bar is a background layer, so the label always reads at full
                contrast rather than sitting on top of a filled block. */}
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 ${mine ? "bg-maroon/12" : "bg-bone-deep/70"}`}
              style={{ width: `${pct}%` }}
            />
            <span className="relative flex items-center justify-between gap-3">
              <span className="text-[0.875rem] text-ink">
                {option.label}
                {mine ? (
                  <span className="font-mono ml-2 text-[0.65rem] uppercase tracking-[0.1em] text-maroon">
                    your vote
                  </span>
                ) : null}
              </span>
              <span className="font-mono shrink-0 text-[0.72rem] tabular-nums text-slate-ink">
                {pct}% · {option.votes}
              </span>
            </span>
          </button>
        );
      })}
      <p className="font-mono text-[0.68rem] tabular-nums text-slate-soft">
        {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"} ·{" "}
        {poll.myAnswer ? "tap another option to change yours" : "tap to vote"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comments                                                           */
/* ------------------------------------------------------------------ */

function Comments({ postId }: { postId: Id<"posts"> }) {
  const comments = useQuery(api.feed.commentsFor, { postId });
  const addComment = useMutation(api.feed.addComment);
  const deleteComment = useMutation(api.feed.deleteComment);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-4 border-t border-line pt-4">
      {comments === undefined ? (
        <p className="text-[0.8rem] text-slate-ink">Loading comments…</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment._id} className="flex items-start gap-2.5">
              <Avatar
                name={comment.author.name}
                src={comment.author.avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1 rounded-card bg-bone px-3.5 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[0.85rem] text-ink">
                    {comment.author.name}
                    {shortBatch(comment.author.batch) ? (
                      <span className="font-mono ml-1.5 text-[0.68rem] tabular-nums text-brass-ink">
                        {comment.author.department}{" "}
                        {shortBatch(comment.author.batch)}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[0.65rem] tabular-nums text-slate-soft">
                    {when(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">
                  {comment.body}
                </p>
                {comment.isMine ? (
                  <button
                    type="button"
                    onClick={() => {
                      void deleteComment({ commentId: comment._id })
                        .catch((error) => toast.error(reason(error)));
                    }}
                    className="font-mono mt-1.5 text-[0.65rem] uppercase tracking-[0.1em] text-slate-ink transition-colors hover:text-maroon"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim().length === 0) return;
          setBusy(true);
          addComment({ postId, body: body.trim() })
            .then(() => setBody(""))
            .catch((error) => toast.error(reason(error)))
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor={`comment-${postId}`} className="sr-only">
          Write a comment
        </label>
        <input
          id={`comment-${postId}`}
          value={body}
          maxLength={1500}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a comment…"
          className="w-full rounded-control border border-line bg-surface px-3.5 py-2 text-[0.875rem] text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
        />
        <Button
          type="submit"
          size="sm"
          disabled={busy || body.trim().length === 0}
        >
          Send
        </Button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One post                                                           */
/* ------------------------------------------------------------------ */

export function PostCard({
  post,
  canModerate = false,
}: {
  post: Post;
  canModerate?: boolean;
}) {
  const toggleLike = useMutation(api.feed.toggleLike);
  const deletePost = useMutation(api.feed.deletePost);
  const setHidden = useMutation(api.feed.setPostHidden);
  const [showComments, setShowComments] = useState(false);
  const batch = shortBatch(post.author.batch);

  return (
    <Card as="article">
      <div className="flex items-start gap-3">
        <Avatar
          name={post.author.name}
          src={post.author.avatarUrl}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {post.author.alumniId ? (
              <Link
                href={`/directory/${post.author.alumniId}` as never}
                className="text-[0.95rem] text-ink transition-colors hover:text-maroon"
              >
                {post.author.name}
              </Link>
            ) : (
              <span className="text-[0.95rem] text-ink">{post.author.name}</span>
            )}
            {post.author.verified ? <VerifiedMark /> : null}
            <span className="font-mono text-[0.65rem] tabular-nums text-slate-soft">
              {when(post.createdAt)}
              {post.editedAt ? " · edited" : ""}
            </span>
          </div>
          {post.author.department || batch ? (
            <p className="font-mono mt-0.5 text-[0.68rem] tabular-nums text-brass-ink">
              {[post.author.department, batch].filter(Boolean).join(" · ")}
              {post.author.company ? (
                <span className="text-slate-ink"> · {post.author.company}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {post.hidden ? (
        <div className="mt-3 rounded-control border border-maroon/30 bg-maroon-tint px-3.5 py-2.5">
          <p className="text-[0.8rem] leading-snug text-ink">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-maroon">
              Hidden by a community admin
            </span>
            {post.hiddenReason ? ` — ${post.hiddenReason}` : ""}. Only you and the
            community&rsquo;s admins can see it.
          </p>
        </div>
      ) : null}

      <p className="mt-3 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
        {post.body}
      </p>

      {post.poll ? <Poll poll={post.poll} /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        <button
          type="button"
          onClick={() => {
            void toggleLike({ postId: post._id }).catch((error) =>
              toast.error(reason(error)),
            );
          }}
          aria-pressed={post.likedByMe}
          className={`font-mono inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-[0.7rem] uppercase tracking-[0.1em] transition-colors ${
            post.likedByMe
              ? "bg-maroon-tint text-maroon"
              : "text-slate-ink hover:bg-bone hover:text-maroon"
          }`}
        >
          {post.likedByMe ? "Liked" : "Like"}
          {post.likeCount > 0 ? (
            <span className="tabular-nums">{post.likeCount}</span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          className="font-mono inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-[0.7rem] uppercase tracking-[0.1em] text-slate-ink transition-colors hover:bg-bone hover:text-maroon"
        >
          {showComments ? "Hide comments" : "Comment"}
          {post.commentCount > 0 ? (
            <span className="tabular-nums">{post.commentCount}</span>
          ) : null}
        </button>

        <span className="ml-auto flex items-center gap-2">
          {canModerate && !post.isMine ? (
            <button
              type="button"
              onClick={() => {
                void setHidden({ postId: post._id, hidden: !post.hidden })
                  .then(() =>
                    toast.success(post.hidden ? "Post restored." : "Post hidden."),
                  )
                  .catch((error) => toast.error(reason(error)));
              }}
              className="font-mono min-h-9 rounded-control px-3 text-[0.7rem] uppercase tracking-[0.1em] text-slate-ink transition-colors hover:text-maroon"
            >
              {post.hidden ? "Restore" : "Hide"}
            </button>
          ) : null}
          {post.isMine || canModerate ? (
            <button
              type="button"
              onClick={() => {
                void deletePost({ postId: post._id })
                  .then(() => toast.success("Post deleted."))
                  .catch((error) => toast.error(reason(error)));
              }}
              className="font-mono min-h-9 rounded-control px-3 text-[0.7rem] uppercase tracking-[0.1em] text-slate-ink transition-colors hover:text-maroon"
            >
              Delete
            </button>
          ) : null}
        </span>
      </div>

      {showComments ? <Comments postId={post._id} /> : null}
    </Card>
  );
}

/** A list of posts, with the loading and empty states it needs. */
export function PostList({
  posts,
  canModerate = false,
  emptyTitle,
  emptyHint,
}: {
  posts: Post[] | undefined;
  canModerate?: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (posts === undefined) return <LoadingRows rows={3} />;
  if (posts.length === 0) {
    return <Empty title={emptyTitle} hint={emptyHint} />;
  }
  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard key={post._id} post={post} canModerate={canModerate} />
      ))}
    </div>
  );
}
