import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail, requireMember } from "./authz";
import { activeMembership, canModerate, membershipOf, standingOf } from "./communities";
import { fallbackLabel, normalise, profileIndex } from "./network";

/**
 * Posts — the general feed, and each community's feed.
 *
 * TWO AUDIENCES, ONE TABLE. A post with no `communityId` belongs to the general
 * feed and is readable by every verified member, which is the "everyone, every
 * batch and year" surface the association asked for. A post with one belongs to
 * that community and is readable by its active members. One table because the
 * composer, the like, the comment and the moderation path are identical either
 * way; splitting them would mean two of each and two chances to diverge.
 *
 * READ PERMISSION IS CHECKED PER FEED, NOT PER POST. `generalFeed` needs only
 * "are you a verified member"; `communityFeed` needs one membership lookup for the
 * whole request. Checking per post would be one lookup per row for an answer that
 * cannot differ within a feed.
 *
 * POLLS REUSE THE QUESTION TABLES. A poll is one `questions` row with `scope:
 * "poll"` and its options, and a vote is one `questionAnswers` row. That is not
 * cleverness for its own sake: a vote is exactly "this person answered this
 * question with this option", and `by_question_email` already enforces one answer
 * per person, which is the whole rule a poll needs.
 *
 * NO EMAIL ADDRESSES ARE RETURNED, as in network.ts and communities.ts.
 */

const MAX_BODY = 5000;
const MAX_COMMENT = 1500;
const PAGE = 30;
const MAX_POLL_OPTIONS = 6;
const MIN_POLL_OPTIONS = 2;
const MAX_IMAGES = 4;
const MAX_VIDEOS = 1;
const MAX_URL = 600;
/** A share can carry a note, or nothing at all. */
const MAX_SHARE_NOTE = 600;

/**
 * Cleans a list of media addresses.
 *
 * HTTPS ONLY, and that is not pedantry: the portal is served over HTTPS, so an
 * http:// image is a mixed-content block in every browser — it would simply not
 * appear, and the member who posted it would have no idea why.
 */
function cleanUrls(raw: string[] | undefined, max: number, what: string) {
  const out: string[] = [];
  for (const value of raw ?? []) {
    const url = value.trim();
    if (url.length === 0) continue;
    if (!/^https:\/\/\S+$/i.test(url)) {
      throw new ConvexError(
        `Each ${what} needs a full address starting with https://.`,
      );
    }
    if (url.length > MAX_URL) {
      throw new ConvexError(`That ${what} address is too long.`);
    }
    if (!out.includes(url)) out.push(url);
  }
  if (out.length > max) {
    throw new ConvexError(
      `A post takes at most ${max} ${what}${max === 1 ? "" : "s"}.`,
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Author card                                                        */
/* ------------------------------------------------------------------ */

function authorCard(email: string, profile: Doc<"alumni"> | undefined) {
  return {
    name: profile?.name ?? fallbackLabel(email),
    alumniId: profile?._id ?? null,
    batch: profile?.batch ?? null,
    department: profile?.department ?? null,
    designation: profile?.designation ?? null,
    company: profile?.company ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    verified: profile?.verified ?? false,
  };
}

/**
 * Decorates a page of posts with author, like state and poll results.
 *
 * Everything is batched: one profile scan, one like lookup per post, one poll
 * read per poll. A feed of 30 posts is a bounded number of reads rather than a
 * cascade, which is why this is a helper and not a per-post query.
 */
/** The quoted post inside a share. Enough to recognise it, and no more. */
function quotedView(
  post: Doc<"posts">,
  profiles: Awaited<ReturnType<typeof profileIndex>>,
) {
  return {
    _id: post._id,
    body: post.body,
    imageUrls: post.imageUrls,
    videoUrls: post.videoUrls ?? [],
    createdAt: post.createdAt,
    author: authorCard(
      post.authorEmail,
      profiles.byEmail.get(normalise(post.authorEmail)),
    ),
  };
}

async function decorate(
  ctx: QueryCtx,
  rows: Doc<"posts">[],
  me: string | null,
) {
  const profiles = await profileIndex(ctx);

  /*
   * The quoted originals, fetched once for the whole page rather than once per
   * card. Ten shares of the same post are one read, not ten.
   */
  const quotedIds = [
    ...new Set(
      rows
        .map((post) => post.sharedFromId)
        .filter((id): id is Id<"posts"> => id !== undefined),
    ),
  ];
  const quoted = new Map<string, ReturnType<typeof quotedView>>();
  for (const id of quotedIds) {
    const original = await ctx.db.get(id);
    // A share whose original was deleted keeps its own note and says so on the
    // card; it is not dropped from the feed.
    if (original) quoted.set(id, quotedView(original, profiles));
  }

  return Promise.all(
    rows.map(async (post) => {
      const likedByMe =
        me === null
          ? false
          : (await ctx.db
              .query("postLikes")
              .withIndex("by_post_email", (q) =>
                q.eq("postId", post._id).eq("email", me),
              )
              .first()) !== null;

      let poll = null as null | {
        questionId: Id<"questions">;
        prompt: string;
        options: Array<{ label: string; votes: number; share: number }>;
        totalVotes: number;
        myAnswer: string | null;
      };

      if (post.kind === "poll") {
        const question = await ctx.db
          .query("questions")
          .withIndex("by_post", (q) => q.eq("postId", post._id))
          .first();
        if (question) {
          const votes = await ctx.db
            .query("questionAnswers")
            .withIndex("by_question", (q) => q.eq("questionId", question._id))
            .collect();
          const tally = new Map<string, number>();
          for (const vote of votes) {
            tally.set(vote.answer, (tally.get(vote.answer) ?? 0) + 1);
          }
          const total = votes.length;
          poll = {
            questionId: question._id,
            prompt: question.prompt,
            options: question.options.map((label) => {
              const count = tally.get(label) ?? 0;
              return {
                label,
                votes: count,
                // Guarded: an unvoted poll must not divide by zero.
                share: total > 0 ? count / total : 0,
              };
            }),
            totalVotes: total,
            myAnswer:
              me === null
                ? null
                : (votes.find((vote) => normalise(vote.email) === me)?.answer ??
                  null),
          };
        }
      }

      return {
        _id: post._id,
        body: post.body,
        kind: post.kind,
        imageUrls: post.imageUrls,
        videoUrls: post.videoUrls ?? [],
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        shareCount: post.shareCount ?? 0,
        sharedFrom: post.sharedFromId
          ? (quoted.get(post.sharedFromId) ?? null)
          : null,
        /** True when this is a share whose original has since been deleted. */
        sharedFromMissing:
          post.sharedFromId !== undefined && !quoted.has(post.sharedFromId),
        createdAt: post.createdAt,
        editedAt: post.editedAt ?? null,
        hidden: post.hidden,
        hiddenReason: post.hiddenReason ?? null,
        communityId: post.communityId ?? null,
        author: authorCard(post.authorEmail, profiles.byEmail.get(normalise(post.authorEmail))),
        likedByMe,
        isMine: me !== null && normalise(post.authorEmail) === me,
        poll,
      };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Writing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates a post, in the general feed or in a community.
 *
 * `communityId` absent means the general feed, which any verified member may post
 * to. Present means the caller must be an active member of it — a community whose
 * feed strangers can write into is not a community.
 *
 * A poll's question row is written in the same transaction as the post, so a poll
 * post can never exist without its options.
 */
export const createPost = mutation({
  args: {
    communityId: v.optional(v.id("communities")),
    body: v.string(),
    /** Present makes this a poll. Between 2 and 6 options. */
    pollOptions: v.optional(v.array(v.string())),
    /** Up to four images, as https addresses. */
    imageUrls: v.optional(v.array(v.string())),
    /** One video: a direct file, or a YouTube or Vimeo link. */
    videoUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { email } = await requireMember(ctx);

    const body = args.body.trim();
    if (body.length === 0) throw new ConvexError("Write something first.");
    if (body.length > MAX_BODY) {
      throw new ConvexError(`Keep the post under ${MAX_BODY} characters.`);
    }

    if (args.communityId) {
      const community = await ctx.db.get(args.communityId);
      if (!community) throw new ConvexError("That community no longer exists.");
      if (community.archived) {
        throw new ConvexError("That community is archived, so its feed is closed.");
      }
      const membership = await activeMembership(ctx, args.communityId, email);
      if (!membership) {
        throw new ConvexError(
          "Join this community before posting in it.",
        );
      }
    }

    /* ---- Poll options ------------------------------------------------ */
    let options: string[] | null = null;
    if (args.pollOptions !== undefined) {
      const seen = new Set<string>();
      options = [];
      for (const raw of args.pollOptions) {
        const label = raw.trim().replace(/\s+/g, " ");
        if (label.length === 0) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) {
          throw new ConvexError(`"${label}" is listed twice — every option must differ.`);
        }
        seen.add(key);
        if (label.length > 120) {
          throw new ConvexError("Keep each option under 120 characters.");
        }
        options.push(label);
      }
      if (options.length < MIN_POLL_OPTIONS) {
        throw new ConvexError(
          `A poll needs at least ${MIN_POLL_OPTIONS} options for there to be a choice.`,
        );
      }
      if (options.length > MAX_POLL_OPTIONS) {
        throw new ConvexError(`A poll takes at most ${MAX_POLL_OPTIONS} options.`);
      }
    }

    const imageUrls = cleanUrls(args.imageUrls, MAX_IMAGES, "image");
    const videoUrls = cleanUrls(args.videoUrls, MAX_VIDEOS, "video");

    const now = Date.now();
    const postId = await ctx.db.insert("posts", {
      authorEmail: email,
      communityId: args.communityId,
      body,
      kind: options ? "poll" : "text",
      imageUrls,
      videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      hidden: false,
      createdAt: now,
    });

    if (options) {
      await ctx.db.insert("questions", {
        scope: "poll",
        postId,
        // The post body is the question. Repeating it on the question row keeps
        // the poll renderable from the question alone.
        prompt: body,
        kind: "choice",
        options,
        required: false,
        order: 0,
        active: true,
        createdByEmail: email,
        createdAt: now,
      });
    }

    if (args.communityId) {
      const community = await ctx.db.get(args.communityId);
      if (community) {
        await ctx.db.patch(args.communityId, {
          postCount: community.postCount + 1,
        });
      }
    }

    return { postId };
  },
});

/** Edits your own post. The body only — a poll's options are fixed once voted on. */
export const editPost = mutation({
  args: { postId: v.id("posts"), body: v.string() },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("That post no longer exists.");
    if (normalise(post.authorEmail) !== email) {
      throw new ConvexError("You can only edit your own posts.");
    }

    const body = args.body.trim();
    if (body.length === 0) throw new ConvexError("A post cannot be empty.");
    if (body.length > MAX_BODY) {
      throw new ConvexError(`Keep the post under ${MAX_BODY} characters.`);
    }

    await ctx.db.patch(args.postId, { body, editedAt: Date.now() });
    return { edited: true };
  },
});

/** Deletes your own post, with its likes, comments and poll. */
export const deletePost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("That post no longer exists.");

    const mine = normalise(post.authorEmail) === email;
    let moderator = false;
    if (post.communityId) {
      const membership = await membershipOf(ctx, post.communityId, email);
      moderator = canModerate(standingOf(membership));
    }
    if (!mine && !moderator) {
      throw new ConvexError(
        "Only the author, or an admin of the community it was posted in, can delete a post.",
      );
    }

    // Everything that hangs off the post goes with it, so no orphan rows are
    // left counting toward anything.
    for (const like of await ctx.db
      .query("postLikes")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect()) {
      await ctx.db.delete(like._id);
    }
    for (const comment of await ctx.db
      .query("postComments")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect()) {
      await ctx.db.delete(comment._id);
    }
    for (const question of await ctx.db
      .query("questions")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect()) {
      for (const answer of await ctx.db
        .query("questionAnswers")
        .withIndex("by_question", (q) => q.eq("questionId", question._id))
        .collect()) {
        await ctx.db.delete(answer._id);
      }
      await ctx.db.delete(question._id);
    }

    if (post.communityId) {
      const community = await ctx.db.get(post.communityId);
      if (community) {
        await ctx.db.patch(post.communityId, {
          postCount: Math.max(0, community.postCount - 1),
        });
      }
    }

    await ctx.db.delete(args.postId);
    return { deleted: true };
  },
});

/**
 * Hides a post without deleting it. Community moderators only.
 *
 * A hidden post stays readable to its author and to the community's moderators,
 * with the reason attached, so moderation is something a member can see happened
 * to them rather than a post that silently vanished.
 *
 * There is deliberately no association-wide override here. A portal admin
 * moderating inside a private community would be an invisible capability;
 * `adminOps.ts` is where association-level powers live, and adding one there is a
 * decision to take openly rather than a flag to slip into this function.
 */
export const setPostHidden = mutation({
  args: {
    postId: v.id("posts"),
    hidden: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("That post no longer exists.");
    if (!post.communityId) {
      throw new ConvexError(
        "General-feed posts have no community moderator. Ask the association.",
      );
    }
    const membership = await membershipOf(ctx, post.communityId, email);
    if (!canModerate(standingOf(membership))) {
      throw new ConvexError("Only this community's admins can hide a post.");
    }

    await ctx.db.patch(args.postId, {
      hidden: args.hidden,
      hiddenReason: args.hidden ? (args.reason?.trim() || undefined) : undefined,
    });
    return { hidden: args.hidden };
  },
});

/** Likes or unlikes. Idempotent in both directions. */
export const toggleLike = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const { email } = await requireMember(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("That post no longer exists.");
    await assertCanRead(ctx, post, email);

    const existing = await ctx.db
      .query("postLikes")
      .withIndex("by_post_email", (q) =>
        q.eq("postId", args.postId).eq("email", email),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(args.postId, {
        likeCount: Math.max(0, post.likeCount - 1),
      });
      return { liked: false };
    }

    await ctx.db.insert("postLikes", {
      postId: args.postId,
      email,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.postId, { likeCount: post.likeCount + 1 });
    return { liked: true };
  },
});

/**
 * Shares a post into the general feed, with an optional note.
 *
 * A SHARE IS A POST. It appears in the feed on its own, carries its own note,
 * its own likes and its own comments, and can be deleted without touching the
 * original — which is what members expect from every network they already use.
 * The alternative, a counter on the original, cannot hold the sentence someone
 * wanted to add, and that sentence is usually the reason they shared it.
 *
 * DEPTH IS ALWAYS ONE. Sharing a share quotes the original instead of the
 * share, so the feed never renders a quote inside a quote inside a quote, and
 * `shareCount` on the original counts every share of it however it was reached.
 *
 * A share always lands in the GENERAL feed, never inside a community, because a
 * community's posts are readable by its members only — copying one into a feed
 * every member can read would route around that in one click.
 */
export const sharePost = mutation({
  args: { postId: v.id("posts"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { email } = await requireMember(ctx);

    const original = await ctx.db.get(args.postId);
    if (!original) throw new ConvexError("That post no longer exists.");
    if (original.hidden && normalise(original.authorEmail) !== email) {
      throw new ConvexError("That post has been hidden by a moderator.");
    }

    // Flattened: quote what the share quotes, not the share.
    const rootId = original.sharedFromId ?? original._id;
    const root = rootId === original._id ? original : await ctx.db.get(rootId);
    if (!root) throw new ConvexError("The original post no longer exists.");

    if (root.communityId !== undefined) {
      throw new ConvexError(
        "Posts inside a community stay in that community. Share it there instead.",
      );
    }
    if (normalise(root.authorEmail) === email && root.sharedFromId === undefined) {
      // Sharing your own post to the same feed it is already in adds nothing
      // but a duplicate. Said plainly rather than silently allowed.
      throw new ConvexError("This is already your post in this feed.");
    }

    const note = (args.note ?? "").trim();
    if (note.length > MAX_SHARE_NOTE) {
      throw new ConvexError(`Keep the note under ${MAX_SHARE_NOTE} characters.`);
    }

    const now = Date.now();
    const postId = await ctx.db.insert("posts", {
      authorEmail: email,
      body: note,
      kind: "text",
      imageUrls: [],
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      sharedFromId: rootId,
      hidden: false,
      createdAt: now,
    });

    await ctx.db.patch(rootId, { shareCount: (root.shareCount ?? 0) + 1 });

    return { postId };
  },
});

export const addComment = mutation({
  args: { postId: v.id("posts"), body: v.string() },
  handler: async (ctx, args) => {
    const { email } = await requireMember(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new ConvexError("That post no longer exists.");
    await assertCanRead(ctx, post, email);

    const body = args.body.trim();
    if (body.length === 0) throw new ConvexError("Write a comment first.");
    if (body.length > MAX_COMMENT) {
      throw new ConvexError(`Keep the comment under ${MAX_COMMENT} characters.`);
    }

    const commentId = await ctx.db.insert("postComments", {
      postId: args.postId,
      authorEmail: email,
      body,
      hidden: false,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.postId, { commentCount: post.commentCount + 1 });
    return { commentId };
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id("postComments") },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new ConvexError("That comment no longer exists.");
    const post = await ctx.db.get(comment.postId);

    const mine = normalise(comment.authorEmail) === email;
    let moderator = false;
    if (post?.communityId) {
      const membership = await membershipOf(ctx, post.communityId, email);
      moderator = canModerate(standingOf(membership));
    }
    if (!mine && !moderator) {
      throw new ConvexError("You can only delete your own comments.");
    }

    await ctx.db.delete(args.commentId);
    if (post) {
      await ctx.db.patch(post._id, {
        commentCount: Math.max(0, post.commentCount - 1),
      });
    }
    return { deleted: true };
  },
});

/**
 * Casts or changes a poll vote.
 *
 * Changing a vote patches the existing answer rather than inserting a second one,
 * which is what `by_question_email` makes cheap and what keeps the tally equal to
 * the number of voters.
 */
export const votePoll = mutation({
  args: { questionId: v.id("questions"), answer: v.string() },
  handler: async (ctx, args) => {
    const { email } = await requireMember(ctx);

    const question = await ctx.db.get(args.questionId);
    if (!question || question.scope !== "poll" || !question.postId) {
      throw new ConvexError("That poll no longer exists.");
    }
    const post = await ctx.db.get(question.postId);
    if (!post) throw new ConvexError("That poll's post no longer exists.");
    await assertCanRead(ctx, post, email);

    const answer = args.answer.trim();
    if (!question.options.includes(answer)) {
      throw new ConvexError("That is not one of this poll's options.");
    }

    const existing = await ctx.db
      .query("questionAnswers")
      .withIndex("by_question_email", (q) =>
        q.eq("questionId", args.questionId).eq("email", email),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { answer, createdAt: Date.now() });
      return { answer, changed: true };
    }

    await ctx.db.insert("questionAnswers", {
      questionId: args.questionId,
      email,
      scope: "poll",
      postId: question.postId,
      answer,
      createdAt: Date.now(),
    });
    return { answer, changed: false };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * Refuses unless the caller may read this post's feed.
 *
 * Used by the write paths, which act on one post and therefore cannot rely on the
 * feed-level check the read paths do.
 */
async function assertCanRead(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  email: string,
) {
  if (!post.communityId) return;
  const membership = await activeMembership(ctx, post.communityId, email);
  if (!membership) {
    throw new ConvexError("That post is in a community you are not a member of.");
  }
}

/**
 * The general feed — every batch, every year, one place.
 *
 * Verified members only. It is the association's shared surface, not a public
 * noticeboard, and a post here reaches everyone.
 */
export const generalFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    /*
     * REFUSES SOFTLY, and this one matters more than most. A member who has
     * just signed in resolves to `guest` until the office verifies them by
     * hand, and this feed is the first page they land on — so throwing here
     * took the whole route down for precisely the people arriving at it. The
     * page reads `authorized` and shows them what to do next instead.
     */
    let email: string;
    try {
      email = (await requireMember(ctx)).email;
    } catch {
      return { authorized: false as const, posts: [] };
    }
    const limit = Math.min(Math.max(args.limit ?? PAGE, 1), 100);

    /*
     * `by_created` covers both feeds, so community posts arrive here too and are
     * filtered out. Taking a wider slice first is what stops a busy set of
     * communities from starving the general feed of rows.
     */
    const candidates = await ctx.db
      .query("posts")
      .withIndex("by_created")
      .order("desc")
      .take(limit * 4);

    const rows = candidates
      .filter((post) => post.communityId === undefined)
      .filter((post) => !post.hidden || normalise(post.authorEmail) === email)
      .slice(0, limit);

    return { authorized: true as const, posts: await decorate(ctx, rows, email) };
  },
});

/** One community's feed. Active members only. */
export const communityFeed = query({
  args: { communityId: v.id("communities"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const membership = await membershipOf(ctx, args.communityId, email);
    const standing = standingOf(membership);

    if (membership?.status !== "active") {
      // Not a refusal: the community page renders a join prompt in place of the
      // feed, and throwing would take the whole page down instead.
      return { allowed: false as const, posts: [], canModerate: false };
    }

    const limit = Math.min(Math.max(args.limit ?? PAGE, 1), 100);
    const rows = (
      await ctx.db
        .query("posts")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .order("desc")
        .take(limit)
    ).filter(
      (post) =>
        !post.hidden ||
        normalise(post.authorEmail) === email ||
        canModerate(standing),
    );

    return {
      allowed: true as const,
      posts: await decorate(ctx, rows, email),
      canModerate: canModerate(standing),
    };
  },
});

/** One post's comments, oldest first — a thread reads forwards. */
export const commentsFor = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) return [];
    if (post.communityId) {
      const membership = await activeMembership(ctx, post.communityId, email);
      if (!membership) return [];
    }

    const rows = await ctx.db
      .query("postComments")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect();
    const profiles = await profileIndex(ctx);

    return rows
      .filter((row) => !row.hidden)
      .map((row) => ({
        _id: row._id,
        body: row.body,
        createdAt: row.createdAt,
        author: authorCard(
          row.authorEmail,
          profiles.byEmail.get(normalise(row.authorEmail)),
        ),
        isMine: normalise(row.authorEmail) === email,
      }));
  },
});

/** Headline counts for the feed page. */
export const feedStats = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireMember(ctx);
    } catch {
      // Same reason as generalFeed: the rail must not crash the page.
      return {
        authorized: false as const,
        generalPosts: 0,
        communityPosts: 0,
        polls: 0,
        contributors: 0,
      };
    }
    const posts = await ctx.db.query("posts").collect();
    const general = posts.filter((post) => post.communityId === undefined);
    return {
      authorized: true as const,
      generalPosts: general.length,
      communityPosts: posts.length - general.length,
      polls: posts.filter((post) => post.kind === "poll").length,
      contributors: new Set(posts.map((post) => normalise(post.authorEmail))).size,
    };
  },
});
