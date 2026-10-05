import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail, requireRole } from "./authz";
import { canModerate, membershipOf, standingOf } from "./communities";
import { normalise } from "./network";

/**
 * Admin-authored questions, in the three places the association asked for them.
 *
 *   verification  — asked of every member requesting alumni verification, on top
 *                   of the fixed roll number and batch fields. Authored by a
 *                   PORTAL admin, because it gates the whole directory.
 *   communityJoin — screening questions on one community. Authored by that
 *                   community's own admins, because it gates only that space.
 *   poll          — created with a post in `feed.createPost`, not here. This
 *                   module refuses to author one, so a poll can never exist
 *                   without the post it belongs to.
 *   profile       — the extra questions on the member details form, on top of
 *                   the eleven configured fields in `profileFields.ts`. Also a
 *                   PORTAL admin, for the same reason as verification: it is
 *                   asked of everyone.
 *
 * WHO MAY AUTHOR WHAT IS THE WHOLE POINT of splitting the write path by scope.
 * A community admin must not be able to add a question to the association's
 * verification form, and a portal admin editing a private community's screening
 * questions would be the same invisible capability `feed.setPostHidden` declines
 * to take. `authorizeScope` is the single place that decides.
 */

const MAX_PROMPT = 300;
const MAX_OPTION = 120;
const MAX_OPTIONS = 8;
const MAX_PER_SCOPE = 15;

type Scope = "verification" | "communityJoin" | "poll" | "profile";

const scopeValidator = v.union(
  v.literal("verification"),
  v.literal("communityJoin"),
  v.literal("poll"),
  v.literal("profile"),
);

const kindValidator = v.union(
  v.literal("text"),
  v.literal("longText"),
  v.literal("choice"),
);

/**
 * Refuses unless the caller may author questions in this scope.
 *
 * Returns the caller's address, so the write path never has to ask twice.
 */
async function authorizeScope(
  ctx: QueryCtx | MutationCtx,
  scope: Scope,
  communityId: Id<"communities"> | undefined,
) {
  if (scope === "poll") {
    throw new ConvexError(
      "A poll is created with its post. Post one and add the options there.",
    );
  }

  if (scope === "verification" || scope === "profile") {
    const { email } = await requireRole(ctx, ["admin"]);
    return email;
  }

  if (!communityId) {
    throw new ConvexError("Name the community these questions belong to.");
  }
  const email = await requireEmail(ctx);
  const membership = await membershipOf(ctx, communityId, email);
  if (!canModerate(standingOf(membership))) {
    throw new ConvexError(
      "Only this community's admins can change its joining questions.",
    );
  }
  return email;
}

/** Trims, drops blanks and rejects duplicates. Required for `choice`. */
function cleanOptions(kind: "text" | "longText" | "choice", raw: string[] | undefined) {
  if (kind !== "choice") return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw ?? []) {
    const label = value.trim().replace(/\s+/g, " ");
    if (label.length === 0) continue;
    if (label.length > MAX_OPTION) {
      throw new ConvexError(`Keep each option under ${MAX_OPTION} characters.`);
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      throw new ConvexError(`"${label}" is listed twice — every option must differ.`);
    }
    seen.add(key);
    out.push(label);
  }
  if (out.length < 2) {
    throw new ConvexError(
      "A multiple-choice question needs at least two options. Use a text question instead if there is only one answer.",
    );
  }
  if (out.length > MAX_OPTIONS) {
    throw new ConvexError(`A question takes at most ${MAX_OPTIONS} options.`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Authoring                                                          */
/* ------------------------------------------------------------------ */

export const addQuestion = mutation({
  args: {
    scope: scopeValidator,
    communityId: v.optional(v.id("communities")),
    prompt: v.string(),
    kind: kindValidator,
    options: v.optional(v.array(v.string())),
    required: v.boolean(),
  },
  handler: async (ctx, args) => {
    const email = await authorizeScope(ctx, args.scope, args.communityId);

    const prompt = args.prompt.trim().replace(/\s+/g, " ");
    if (prompt.length < 4 || prompt.length > MAX_PROMPT) {
      throw new ConvexError(
        `Write a question between 4 and ${MAX_PROMPT} characters.`,
      );
    }
    const options = cleanOptions(args.kind, args.options);

    const siblings = await siblingsOf(ctx, args.scope, args.communityId);
    if (siblings.filter((row) => row.active).length >= MAX_PER_SCOPE) {
      throw new ConvexError(
        `That is already ${MAX_PER_SCOPE} live questions. Retire one before adding another — a long form is one nobody finishes.`,
      );
    }

    const order =
      siblings.reduce((max, row) => Math.max(max, row.order), -1) + 1;

    return ctx.db.insert("questions", {
      scope: args.scope,
      communityId: args.scope === "communityJoin" ? args.communityId : undefined,
      prompt,
      kind: args.kind,
      options,
      required: args.required,
      order,
      active: true,
      createdByEmail: email,
      createdAt: Date.now(),
    });
  },
});

/**
 * Edits a question in place.
 *
 * Changing the options of a `choice` question that already has answers would
 * orphan those answers against options that no longer exist, so it is refused —
 * retire the question and add a replacement, which keeps the old answers readable
 * against the wording they were given.
 */
export const editQuestion = mutation({
  args: {
    questionId: v.id("questions"),
    prompt: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    required: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (!question) throw new ConvexError("That question no longer exists.");
    await authorizeScope(ctx, question.scope, question.communityId);

    const patch: Partial<Doc<"questions">> = {};

    if (args.prompt !== undefined) {
      const prompt = args.prompt.trim().replace(/\s+/g, " ");
      if (prompt.length < 4 || prompt.length > MAX_PROMPT) {
        throw new ConvexError(
          `Write a question between 4 and ${MAX_PROMPT} characters.`,
        );
      }
      patch.prompt = prompt;
    }

    if (args.options !== undefined) {
      const answered = await ctx.db
        .query("questionAnswers")
        .withIndex("by_question", (q) => q.eq("questionId", args.questionId))
        .first();
      if (answered) {
        throw new ConvexError(
          "Someone has already answered this question, so its options are fixed. Retire it and add a new one instead.",
        );
      }
      patch.options = cleanOptions(question.kind, args.options);
    }

    if (args.required !== undefined) patch.required = args.required;

    await ctx.db.patch(args.questionId, patch);
    return { updated: true };
  },
});

/**
 * Retires or restores a question.
 *
 * Retiring rather than deleting, because answers already given reference it and a
 * pending join request would otherwise show "Question removed" beside an answer
 * the admin still has to read to make a decision.
 */
export const setQuestionActive = mutation({
  args: { questionId: v.id("questions"), active: v.boolean() },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (!question) throw new ConvexError("That question no longer exists.");
    await authorizeScope(ctx, question.scope, question.communityId);
    await ctx.db.patch(args.questionId, { active: args.active });
    return { active: args.active };
  },
});

/** Moves a question up or down. Order is what the form reads in. */
export const reorderQuestion = mutation({
  args: {
    questionId: v.id("questions"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (!question) throw new ConvexError("That question no longer exists.");
    await authorizeScope(ctx, question.scope, question.communityId);

    const siblings = (
      await siblingsOf(ctx, question.scope, question.communityId)
    ).sort((a, b) => a.order - b.order);

    const index = siblings.findIndex((row) => row._id === args.questionId);
    const swapWith = args.direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= siblings.length) {
      return { moved: false };
    }

    const a = siblings[index]!;
    const b = siblings[swapWith]!;
    await ctx.db.patch(a._id, { order: b.order });
    await ctx.db.patch(b._id, { order: a.order });
    return { moved: true };
  },
});

async function siblingsOf(
  ctx: QueryCtx | MutationCtx,
  scope: Scope,
  communityId: Id<"communities"> | undefined,
) {
  if (scope === "communityJoin" && communityId) {
    return ctx.db
      .query("questions")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
  }
  return ctx.db
    .query("questions")
    .filter((q) => q.eq(q.field("scope"), scope))
    .collect();
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

function questionView(row: Doc<"questions">) {
  return {
    _id: row._id,
    prompt: row.prompt,
    kind: row.kind,
    options: row.options,
    required: row.required,
    order: row.order,
    active: row.active,
    createdAt: row.createdAt,
  };
}

/**
 * The live verification questions, for the /join form.
 *
 * Readable without a session: a visitor deciding whether to join should be able to
 * see what they will be asked. The questions are the association's own wording, not
 * anybody's personal data.
 */
export const verificationQuestions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_scope", (q) =>
        q.eq("scope", "verification").eq("active", true),
      )
      .collect();
    return rows.sort((a, b) => a.order - b.order).map(questionView);
  },
});

/** Every verification question including retired ones, for the admin panel. */
export const allVerificationQuestions = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireRole(ctx, ["admin"]);
    } catch {
      // The panel renders an access notice rather than crashing.
      return [];
    }
    const rows = await ctx.db
      .query("questions")
      .filter((q) => q.eq(q.field("scope"), "verification"))
      .collect();
    return rows.sort((a, b) => a.order - b.order).map(questionView);
  },
});

/** One community's questions, including retired ones. Moderators only. */
export const communityQuestions = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.email ? normalise(identity.email) : null;
    if (!me) return [];
    const membership = await membershipOf(ctx, args.communityId, me);
    if (!canModerate(standingOf(membership))) return [];

    const rows = await ctx.db
      .query("questions")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    return rows.sort((a, b) => a.order - b.order).map(questionView);
  },
});

/**
 * Records a member's answers to the verification questions.
 *
 * Separate from `access.requestVerification` so the fixed fields and the
 * association's custom questions can be saved independently — a member correcting
 * one answer should not have to re-file their whole request. Answers are keyed on
 * the session, so a caller can only ever write their own.
 */
/**
 * Validates and stores one member's answers for a whole scope.
 *
 * Shared by the verification form and the member details form. The rules it
 * enforces are the same in both places: a required question must be answered,
 * a choice must be one of the offered options, and one member has exactly one
 * answer per question — which is why an existing row is patched rather than a
 * second one inserted.
 */
async function saveScopedAnswers(
  ctx: MutationCtx,
  scope: Scope,
  email: string,
  answers: Array<{ questionId: Id<"questions">; answer: string }>,
) {
  const live = await ctx.db
    .query("questions")
    .withIndex("by_scope", (q) => q.eq("scope", scope).eq("active", true))
    .collect();
  const byId = new Map(live.map((row) => [row._id, row]));
  const supplied = new Map(answers.map((a) => [a.questionId, a.answer.trim()]));

  for (const question of live) {
    const answer = supplied.get(question._id) ?? "";
    if (question.required && answer.length === 0) {
      throw new ConvexError(`Answer "${question.prompt}" to continue.`);
    }
    if (
      answer.length > 0 &&
      question.kind === "choice" &&
      !question.options.includes(answer)
    ) {
      throw new ConvexError(
        `"${answer}" is not one of the options for "${question.prompt}".`,
      );
    }
  }

  const now = Date.now();
  let saved = 0;
  for (const [questionId, answer] of supplied) {
    // Silently ignore an answer to a question that has since been retired,
    // rather than failing the whole submission over it.
    if (!byId.has(questionId)) continue;
    if (answer.length === 0) continue;

    const prior = await ctx.db
      .query("questionAnswers")
      .withIndex("by_question_email", (q) =>
        q.eq("questionId", questionId).eq("email", email),
      )
      .first();
    if (prior) {
      await ctx.db.patch(prior._id, { answer, createdAt: now });
    } else {
      await ctx.db.insert("questionAnswers", {
        questionId,
        email,
        scope,
        answer,
        createdAt: now,
      });
    }
    saved += 1;
  }

  return { saved };
}

const answersArg = v.array(
  v.object({ questionId: v.id("questions"), answer: v.string() }),
);

export const answerVerificationQuestions = mutation({
  args: { answers: answersArg },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    return saveScopedAnswers(ctx, "verification", email, args.answers);
  },
});

/* ------------------------------------------------------------------ */
/* The member details form                                            */
/* ------------------------------------------------------------------ */

/**
 * The extra questions an admin has added to the member details form.
 *
 * Public, like `verificationQuestions`: it returns prompts and options, no
 * answers, and the form has to render before there is a profile to gate on.
 */
export const profileQuestions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_scope", (q) => q.eq("scope", "profile").eq("active", true))
      .collect();
    return rows.sort((a, b) => a.order - b.order).map(questionView);
  },
});

/** Every profile question including the retired ones, for the console. */
export const allProfileQuestions = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireRole(ctx, ["admin"]);
    } catch {
      // The panel renders an access notice rather than crashing.
      return [];
    }
    const rows = await ctx.db
      .query("questions")
      .filter((q) => q.eq(q.field("scope"), "profile"))
      .collect();
    return rows.sort((a, b) => a.order - b.order).map(questionView);
  },
});

export const answerProfileQuestions = mutation({
  args: { answers: answersArg },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    return saveScopedAnswers(ctx, "profile", email, args.answers);
  },
});

/** A member's own answers, so the details form reopens filled in. */
export const myProfileAnswers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return [];
    const email = normalise(identity.email);

    const rows = await ctx.db
      .query("questionAnswers")
      .withIndex("by_email_scope", (q) =>
        q.eq("email", email).eq("scope", "profile"),
      )
      .collect();
    return rows.map((row) => ({
      questionId: row.questionId,
      answer: row.answer,
      createdAt: row.createdAt,
    }));
  },
});

export const myVerificationAnswers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return [];
    const email = normalise(identity.email);

    const rows = await ctx.db
      .query("questionAnswers")
      .withIndex("by_email_scope", (q) =>
        q.eq("email", email).eq("scope", "verification"),
      )
      .collect();
    return rows.map((row) => ({
      questionId: row.questionId,
      answer: row.answer,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * One applicant's verification answers, for the admin reviewing their request.
 *
 * Admin only, and takes the address explicitly because the admin is by definition
 * asking about someone else — the one place in the portal where that is correct.
 */
export const verificationAnswersFor = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const email = normalise(args.email);

    const rows = await ctx.db
      .query("questionAnswers")
      .withIndex("by_email_scope", (q) =>
        q.eq("email", email).eq("scope", "verification"),
      )
      .collect();

    return Promise.all(
      rows.map(async (row) => {
        const question = await ctx.db.get(row.questionId);
        return {
          prompt: question?.prompt ?? "Question retired",
          answer: row.answer,
          createdAt: row.createdAt,
        };
      }),
    );
  },
});
