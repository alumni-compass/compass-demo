import {
  createThread,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalAction, mutation, query } from "./_generated/server";
import { chatAgent } from "./agent";
import { requireIdentity } from "./authz";

/**
 * Assistant chat, used by the mobile app.
 *
 * SECURITY: every entry point requires a session. Unauthenticated, these were a
 * free LLM proxy — anyone who knew the deployment URL could run unlimited
 * Gemini generations billed to the association's API key, and read any
 * conversation whose thread id they could guess.
 *
 * Threads are owned by the account that created them: the creator's subject is
 * recorded as the thread's userId, and every read and write re-checks it.
 */
export const createNewThread = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    // Binding the thread to the caller is what makes the ownership check below
    // possible at all — without it every thread is anonymous and unattributable.
    const threadId = await createThread(ctx, components.agent, {
      userId: identity.subject,
    });
    return threadId;
  },
});

/** Throws unless the signed-in caller owns this thread. */
async function assertThreadOwner(
  ctx: Parameters<typeof requireIdentity>[0],
  threadId: string,
) {
  const identity = await requireIdentity(ctx);
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });
  if (!thread) throw new Error("That conversation no longer exists.");
  if (thread.userId !== identity.subject) {
    throw new Error("That conversation belongs to someone else.");
  }
}

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await assertThreadOwner(ctx, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { threadId, prompt }) => {
    await assertThreadOwner(ctx, threadId);
    if (prompt.trim().length === 0) throw new Error("Type a message first.");
    if (prompt.length > 4000) {
      throw new Error("Shorten the message to 4000 characters or fewer.");
    }
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(0, internal.chat.generateResponseAsync, {
      threadId,
      promptMessageId: messageId,
    });
    return messageId;
  },
});

export const generateResponseAsync = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { threadId, promptMessageId }) => {
    await chatAgent.streamText(ctx, { threadId }, { promptMessageId }, { saveStreamDeltas: true });
  },
});
