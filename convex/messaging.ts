import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail } from "./authz";
import {
  areConnected,
  counterpartOf,
  fallbackLabel,
  normalise,
  preview,
  profileIndex,
} from "./network";

/**
 * Direct messages between connected members.
 *
 * THE CONNECTION IS THE PERMISSION. Every entry point here re-checks that an
 * accepted edge still exists between the two participants — not just when the
 * thread is created. That matters because a connection can be removed: once it
 * is, the thread stops accepting messages, and the history stays readable to
 * both sides rather than vanishing. Anything else means either a stranger can
 * keep writing to someone who disconnected from them, or a member loses a record
 * of a conversation they were part of.
 *
 * This is what the brief called "messaging (optional)" under module 3. It is
 * built now because a connection nobody can act on is a statistic, not a
 * network — the point of accepting a request is being able to say something.
 *
 * WHY NO CONTACT DETAILS ANYWHERE HERE. Messaging exists so that two members can
 * talk *without* either of them publishing a phone number. `directory.publicView`
 * remains the only thing that decides what contact details a member has opted
 * into sharing, and nothing in this file reads or returns them.
 */

const MAX_BODY = 4000;
/** Newest page of a thread. Older messages are not paginated yet — see below. */
const MESSAGE_LIMIT = 200;
const INBOX_LIMIT = 50;

/** Threads store the pair sorted, so a pair has exactly one thread identity. */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function threadBetween(
  ctx: QueryCtx | MutationCtx,
  a: string,
  b: string,
): Promise<Doc<"conversations"> | null> {
  const [participantA, participantB] = pairKey(a, b);
  return ctx.db
    .query("conversations")
    .withIndex("by_pair", (q) =>
      q.eq("participantA", participantA).eq("participantB", participantB),
    )
    .first();
}

/** The other end of a thread, from one participant's side. */
function otherSide(thread: Doc<"conversations">, me: string) {
  return normalise(thread.participantA) === me
    ? normalise(thread.participantB)
    : normalise(thread.participantA);
}

/**
 * Loads a thread and refuses unless the session is one of its two participants.
 *
 * An id selects a thread; it never establishes who is asking. Ownership is
 * checked before anything else is read, so someone holding an id learns nothing
 * about whether it exists in a state they could have acted on.
 */
async function requireParticipant(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<"conversations">,
  me: string,
) {
  const thread = await ctx.db.get(conversationId);
  if (!thread) throw new ConvexError("That conversation no longer exists.");

  const mine =
    normalise(thread.participantA) === me ||
    normalise(thread.participantB) === me;
  if (!mine) {
    throw new ConvexError("That conversation is not yours to read.");
  }
  return thread;
}

/**
 * The other member, for a thread header or an inbox row.
 *
 * No email address, matching `network.memberCard` — see the note at the top of
 * network.ts. A thread is addressed by its own id, so the client never needs one.
 */
function counterpartCard(email: string, profile: Doc<"alumni"> | undefined) {
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

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Opens the thread with a connected member, or returns the existing one.
 *
 * Idempotent, because "Message" is a navigation action: clicking it twice should
 * land in the same conversation, not create a second one. The thread is created
 * empty and carries `lastMessageAt` seeded to its creation time so it sorts into
 * the inbox immediately rather than at the bottom until someone speaks.
 */
export const openConversation = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    // Resolves the other side from the edge, and refuses unless the caller is a
    // party to it and it has actually been accepted. The browser therefore opens
    // a thread without ever naming an address.
    const them = await counterpartOf(ctx, args.connectionId, me);

    const existing = await threadBetween(ctx, me, them);
    if (existing) return { conversationId: existing._id, created: false };

    const [participantA, participantB] = pairKey(me, them);
    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      participantA,
      participantB,
      lastMessageAt: now,
      lastMessagePreview: "",
      lastSenderEmail: "",
      createdAt: now,
    });
    return { conversationId, created: true };
  },
});

/**
 * Sends a message.
 *
 * The connection is re-checked here and not only at thread creation, so removing
 * a connection actually closes the channel. The refusal names the reason,
 * because "message failed" would leave the sender retyping.
 */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    const thread = await requireParticipant(ctx, args.conversationId, me);
    const them = otherSide(thread, me);

    if (!(await areConnected(ctx, me, them))) {
      throw new ConvexError(
        "You are no longer connected to this member, so this conversation is closed. The history stays here.",
      );
    }

    const body = args.body.trim();
    if (body.length === 0) throw new ConvexError("Write a message first.");
    if (body.length > MAX_BODY) {
      throw new ConvexError(
        `Keep the message under ${MAX_BODY} characters.`,
      );
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("directMessages", {
      conversationId: args.conversationId,
      senderEmail: me,
      body,
      createdAt: now,
    });

    // Denormalised onto the thread so the inbox needs one index scan, not one
    // per thread.
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      lastMessagePreview: preview(body),
      lastSenderEmail: me,
    });

    return { messageId };
  },
});

/**
 * Marks the other side's messages in one thread as read.
 *
 * Only messages the caller did not send are touched — marking your own message
 * read is meaningless, and it would make the unread count depend on who opened
 * the thread last rather than on who has seen what.
 */
export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    await requireParticipant(ctx, args.conversationId, me);

    const rows = await ctx.db
      .query("directMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();

    const now = Date.now();
    const unread = rows.filter(
      (row) => normalise(row.senderEmail) !== me && row.readAt === undefined,
    );
    await Promise.all(unread.map((row) => ctx.db.patch(row._id, { readAt: now })));

    return { marked: unread.length };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * The inbox — every thread the caller is in, most recent first.
 *
 * Two index scans, because the caller is `participantA` in some threads and
 * `participantB` in others. That is the cost of storing the pair sorted, and it
 * buys a single deterministic thread per pair, which is the more important
 * property.
 */
export const myConversations = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmail(ctx);

    const [asA, asB] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_a", (q) => q.eq("participantA", me))
        .order("desc")
        .take(INBOX_LIMIT),
      ctx.db
        .query("conversations")
        .withIndex("by_b", (q) => q.eq("participantB", me))
        .order("desc")
        .take(INBOX_LIMIT),
    ]);

    const threads = [...asA, ...asB]
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, INBOX_LIMIT);

    const profiles = await profileIndex(ctx);

    const rows = await Promise.all(
      threads.map(async (thread) => {
        const them = otherSide(thread, me);
        const messages = await ctx.db
          .query("directMessages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", thread._id),
          )
          .collect();

        const unread = messages.filter(
          (row) => normalise(row.senderEmail) !== me && row.readAt === undefined,
        ).length;

        return {
          conversationId: thread._id,
          counterpart: counterpartCard(them, profiles.byEmail.get(them)),
          lastMessageAt: thread.lastMessageAt,
          lastMessagePreview: thread.lastMessagePreview,
          /** Lets the inbox render "You: …" without a second lookup. */
          lastFromMe: normalise(thread.lastSenderEmail) === me,
          unread,
          messageCount: messages.length,
          /** False once either side disconnects — the composer is then closed. */
          stillConnected: await areConnected(ctx, me, them),
        };
      }),
    );

    return {
      me,
      rows,
      totalUnread: rows.reduce((sum, row) => sum + row.unread, 0),
    };
  },
});

/**
 * One thread in full.
 *
 * Returns the newest `MESSAGE_LIMIT` messages. There is no older-message paging
 * yet, and `truncated` says so rather than letting the top of the thread look
 * like its beginning.
 */
export const conversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    const thread = await requireParticipant(ctx, args.conversationId, me);
    const them = otherSide(thread, me);

    const all = await ctx.db
      .query("directMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .collect();

    const messages = all.slice(-MESSAGE_LIMIT);
    const profiles = await profileIndex(ctx);

    return {
      me,
      conversationId: thread._id,
      counterpart: counterpartCard(them, profiles.byEmail.get(them)),
      stillConnected: await areConnected(ctx, me, them),
      truncated: all.length > messages.length,
      messages: messages.map((row) => ({
        _id: row._id,
        body: row.body,
        createdAt: row.createdAt,
        fromMe: normalise(row.senderEmail) === me,
        readAt: row.readAt ?? null,
      })),
    };
  },
});

/**
 * Unread total for the header badge.
 *
 * Its own query so a signed-in member on any page subscribes to one integer
 * rather than to every thread they are in.
 */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmail(ctx);

    const [asA, asB] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_a", (q) => q.eq("participantA", me))
        .collect(),
      ctx.db
        .query("conversations")
        .withIndex("by_b", (q) => q.eq("participantB", me))
        .collect(),
    ]);

    const counts = await Promise.all(
      [...asA, ...asB].map(async (thread) => {
        const rows = await ctx.db
          .query("directMessages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", thread._id),
          )
          .collect();
        return rows.filter(
          (row) => normalise(row.senderEmail) !== me && row.readAt === undefined,
        ).length;
      }),
    );

    return counts.reduce((sum, n) => sum + n, 0);
  },
});
