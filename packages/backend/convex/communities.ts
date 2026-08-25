import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail, requireMember } from "./authz";
import { fallbackLabel, normalise, profileIndex } from "./network";

/**
 * Communities — a space with its own membership and its own feed.
 *
 * TWO JOIN MODES, ONE FIELD. `open` admits anyone who asks, instantly.
 * `approval` holds the request until a community admin accepts it. Nothing else
 * differs between them, which is why `visibility` is one field rather than two
 * kinds of community: the feed, the member list and the moderation tools are
 * identical either way, and only the moment of admission moves.
 *
 * WHO CAN CREATE ONE. Any verified member. The creator becomes its first admin,
 * and admin of a community is scoped entirely to that community — it grants
 * nothing anywhere else in the portal. That is deliberate: a member should be
 * able to run their own batch group without the association handing out a
 * portal-wide role to do it.
 *
 * SCREENING QUESTIONS. An `approval` community's admins can author questions
 * (`questions.ts`, scope `communityJoin`). A join request answers them, and the
 * answers are what the admin reads when deciding. Questions on an `open`
 * community are accepted but never asked, because there is no decision to inform
 * — the UI says so rather than silently collecting answers nobody reads.
 *
 * NO EMAIL ADDRESSES LEAVE THIS MODULE, for the same reason as network.ts: an
 * address is a contact detail and module 2 makes those opt-in. Members are named
 * and linked by their directory id; every action is keyed on a `communityId` plus
 * the session, or on a `membershipId`.
 */

const MAX_NAME = 80;
const MAX_TAGLINE = 160;
const MAX_DESCRIPTION = 4000;
const MAX_NOTE = 600;
/** A member cannot run an unbounded number of spaces. */
const MAX_OWNED = 20;

type Visibility = "open" | "approval";

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Membership helpers                                                  */
/* ------------------------------------------------------------------ */

async function membershipOf(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  email: string,
) {
  return ctx.db
    .query("communityMembers")
    .withIndex("by_community_email", (q) =>
      q.eq("communityId", communityId).eq("email", email),
    )
    .first();
}

/** The caller's standing in one community, as the UI needs to render it. */
export type Standing =
  | "guest"
  | "pending"
  | "member"
  | "moderator"
  | "admin"
  | "declined"
  | "removed";

function standingOf(row: Doc<"communityMembers"> | null): Standing {
  if (!row) return "guest";
  if (row.status === "pending") return "pending";
  if (row.status === "declined") return "declined";
  if (row.status === "removed") return "removed";
  return row.role;
}

function canModerate(standing: Standing) {
  return standing === "admin" || standing === "moderator";
}

/**
 * Refuses unless the caller can moderate this community.
 *
 * Portal admins are deliberately NOT included. A community is its creator's to
 * run, and a portal-wide admin quietly holding moderator rights in every private
 * group is a different product from the one the association asked for. Association
 * oversight belongs in a documented, auditable place — see the note in
 * `hidePost` — not as an invisible capability here.
 */
async function requireModerator(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
) {
  const email = await requireEmail(ctx);
  const membership = await membershipOf(ctx, communityId, email);
  const standing = standingOf(membership);
  if (!canModerate(standing)) {
    throw new ConvexError(
      "Only this community's admins can do that. Ask whoever created it.",
    );
  }
  return { email, membership: membership!, standing };
}

/** Exported for feed.ts, which gates posting on active membership. */
export async function activeMembership(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  email: string,
) {
  const row = await membershipOf(ctx, communityId, email);
  if (!row || row.status !== "active") return null;
  return row;
}

export { canModerate, membershipOf, standingOf };

/* ------------------------------------------------------------------ */
/* Create                                                             */
/* ------------------------------------------------------------------ */

/**
 * Creates a community and makes the caller its first admin.
 *
 * The two writes are one transaction — a community with no admin would be
 * unmoderatable and unjoinable in `approval` mode, with nobody able to fix it.
 */
export const createCommunity = mutation({
  args: {
    name: v.string(),
    tagline: v.string(),
    description: v.string(),
    visibility: v.union(v.literal("open"), v.literal("approval")),
    scopeBatch: v.optional(v.number()),
    scopeDepartment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verified members only. An unverified account creating spaces is how a
    // members' portal turns into an open forum.
    const { email } = await requireMember(ctx);

    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > MAX_NAME) {
      throw new ConvexError(
        `Give the community a name between 3 and ${MAX_NAME} characters.`,
      );
    }
    const tagline = args.tagline.trim().replace(/\s+/g, " ");
    if (tagline.length === 0 || tagline.length > MAX_TAGLINE) {
      throw new ConvexError(
        `Write a one-line tagline, up to ${MAX_TAGLINE} characters — it is what members read in the list.`,
      );
    }
    const description = args.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      throw new ConvexError(
        `Keep the description under ${MAX_DESCRIPTION} characters.`,
      );
    }

    const owned = await ctx.db
      .query("communities")
      .withIndex("by_creator", (q) => q.eq("createdByEmail", email))
      .collect();
    if (owned.filter((row) => !row.archived).length >= MAX_OWNED) {
      throw new ConvexError(
        `You already run ${MAX_OWNED} communities. Archive one before creating another.`,
      );
    }

    const base = slugify(name);
    if (base.length === 0) {
      throw new ConvexError(
        "That name has no letters or numbers in it, so it cannot form a web address.",
      );
    }
    // A slug is a URL, so it has to be unique. Suffix rather than refuse: two
    // batches naming a group "Placements" is entirely reasonable.
    let slug = base;
    for (let n = 2; n < 50; n += 1) {
      const clash = await ctx.db
        .query("communities")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!clash) break;
      slug = `${base}-${n}`;
    }

    const now = Date.now();
    const communityId = await ctx.db.insert("communities", {
      name,
      slug,
      tagline,
      description,
      visibility: args.visibility,
      createdByEmail: email,
      scopeBatch: args.scopeBatch,
      scopeDepartment: args.scopeDepartment,
      memberCount: 1,
      postCount: 0,
      archived: false,
      createdAt: now,
    });

    await ctx.db.insert("communityMembers", {
      communityId,
      email,
      role: "admin",
      status: "active",
      createdAt: now,
      decidedAt: now,
      decidedByEmail: email,
    });

    return { communityId, slug };
  },
});

/* ------------------------------------------------------------------ */
/* Joining                                                            */
/* ------------------------------------------------------------------ */

/**
 * Asks to join, answering the community's screening questions if it has any.
 *
 * An `open` community admits immediately; an `approval` one records a pending
 * request. The return value says which happened rather than leaving the page to
 * infer it from the community's own visibility — the two could disagree if an
 * admin changed the mode while the form was open.
 *
 * Required questions are enforced HERE and not only in the form, because a
 * request that arrives with a required answer missing is exactly what a screening
 * admin cannot act on.
 */
export const requestToJoin = mutation({
  args: {
    communityId: v.id("communities"),
    note: v.optional(v.string()),
    answers: v.optional(
      v.array(v.object({ questionId: v.id("questions"), answer: v.string() })),
    ),
  },
  handler: async (ctx, args) => {
    const { email } = await requireMember(ctx);

    const community = await ctx.db.get(args.communityId);
    if (!community) throw new ConvexError("That community no longer exists.");
    if (community.archived) {
      throw new ConvexError("That community has been archived.");
    }

    const existing = await membershipOf(ctx, args.communityId, email);
    if (existing?.status === "active") {
      return { status: "active" as const, alreadyIn: true };
    }
    if (existing?.status === "pending") {
      return { status: "pending" as const, alreadyIn: false };
    }
    if (existing?.status === "removed") {
      throw new ConvexError(
        "You were removed from this community, so you cannot rejoin it without an admin adding you back.",
      );
    }

    const note = args.note?.trim() ?? "";
    if (note.length > MAX_NOTE) {
      throw new ConvexError(`Keep the note under ${MAX_NOTE} characters.`);
    }

    /* ---- Screening questions ---------------------------------------- */
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const live = questions.filter((row) => row.active);
    const supplied = new Map(
      (args.answers ?? []).map((a) => [a.questionId, a.answer.trim()]),
    );

    if (community.visibility === "approval") {
      for (const question of live) {
        const answer = supplied.get(question._id) ?? "";
        if (question.required && answer.length === 0) {
          throw new ConvexError(`Answer "${question.prompt}" to send your request.`);
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
    }

    const now = Date.now();
    const admitted = community.visibility === "open";

    if (existing) {
      // A previously declined request is re-opened on the same row, so a pair
      // never accumulates history rows.
      await ctx.db.patch(existing._id, {
        status: admitted ? "active" : "pending",
        role: "member",
        note: note.length > 0 ? note : undefined,
        createdAt: now,
        decidedAt: admitted ? now : undefined,
        decidedByEmail: undefined,
      });
    } else {
      await ctx.db.insert("communityMembers", {
        communityId: args.communityId,
        email,
        role: "member",
        status: admitted ? "active" : "pending",
        note: note.length > 0 ? note : undefined,
        createdAt: now,
        decidedAt: admitted ? now : undefined,
      });
    }

    if (admitted) {
      await ctx.db.patch(args.communityId, {
        memberCount: community.memberCount + 1,
      });
    }

    /*
     * Answers are stored for an approval community only. Collecting them for an
     * open one would mean holding a member's answers to questions nobody will
     * ever read to make a decision that was never taken.
     */
    if (community.visibility === "approval") {
      for (const question of live) {
        const answer = supplied.get(question._id) ?? "";
        if (answer.length === 0) continue;
        const prior = await ctx.db
          .query("questionAnswers")
          .withIndex("by_question_email", (q) =>
            q.eq("questionId", question._id).eq("email", email),
          )
          .first();
        if (prior) {
          await ctx.db.patch(prior._id, { answer, createdAt: now });
        } else {
          await ctx.db.insert("questionAnswers", {
            questionId: question._id,
            email,
            scope: "communityJoin",
            communityId: args.communityId,
            answer,
            createdAt: now,
          });
        }
      }
    }

    return {
      status: admitted ? ("active" as const) : ("pending" as const),
      alreadyIn: false,
    };
  },
});

/** Accept or decline a pending request. Community admins and moderators only. */
export const reviewJoinRequest = mutation({
  args: {
    membershipId: v.id("communityMembers"),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.membershipId);
    if (!row) throw new ConvexError("That request no longer exists.");

    const { email } = await requireModerator(ctx, row.communityId);

    if (row.status !== "pending") {
      throw new ConvexError(
        row.status === "active"
          ? "They are already a member."
          : "That request has already been answered.",
      );
    }

    const now = Date.now();
    await ctx.db.patch(args.membershipId, {
      status: args.decision === "accepted" ? "active" : "declined",
      decidedAt: now,
      decidedByEmail: email,
    });

    if (args.decision === "accepted") {
      const community = await ctx.db.get(row.communityId);
      if (community) {
        await ctx.db.patch(row.communityId, {
          memberCount: community.memberCount + 1,
        });
      }
    }

    return { status: args.decision };
  },
});

/** Leave a community. An admin cannot leave while they are the only one. */
export const leaveCommunity = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const row = await membershipOf(ctx, args.communityId, email);
    if (!row || row.status !== "active") {
      throw new ConvexError("You are not a member of that community.");
    }

    if (row.role === "admin") {
      const admins = await ctx.db
        .query("communityMembers")
        .withIndex("by_community_status", (q) =>
          q.eq("communityId", args.communityId).eq("status", "active"),
        )
        .collect();
      if (admins.filter((m) => m.role === "admin").length <= 1) {
        throw new ConvexError(
          "You are the only admin. Make someone else an admin first, or archive the community.",
        );
      }
    }

    await ctx.db.delete(row._id);
    const community = await ctx.db.get(args.communityId);
    if (community) {
      await ctx.db.patch(args.communityId, {
        memberCount: Math.max(0, community.memberCount - 1),
      });
    }
    return { left: true };
  },
});

/** Remove someone, or change their role. Community admins only. */
export const setMemberRole = mutation({
  args: {
    membershipId: v.id("communityMembers"),
    role: v.union(
      v.literal("admin"),
      v.literal("moderator"),
      v.literal("member"),
      v.literal("removed"),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.membershipId);
    if (!row) throw new ConvexError("That member is no longer listed.");

    const { standing } = await requireModerator(ctx, row.communityId);
    if (standing !== "admin") {
      throw new ConvexError("Only an admin of this community can change roles.");
    }

    if (args.role === "removed") {
      await ctx.db.patch(args.membershipId, {
        status: "removed",
        decidedAt: Date.now(),
      });
      const community = await ctx.db.get(row.communityId);
      if (community) {
        await ctx.db.patch(row.communityId, {
          memberCount: Math.max(0, community.memberCount - 1),
        });
      }
      return { role: "removed" as const };
    }

    await ctx.db.patch(args.membershipId, { role: args.role, status: "active" });
    return { role: args.role };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

function communityCard(
  row: Doc<"communities">,
  standing: Standing,
  creatorName: string,
) {
  return {
    _id: row._id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    visibility: row.visibility as Visibility,
    scopeBatch: row.scopeBatch ?? null,
    scopeDepartment: row.scopeDepartment ?? null,
    memberCount: row.memberCount,
    postCount: row.postCount,
    createdAt: row.createdAt,
    createdByName: creatorName,
    /** The caller's own standing, so the card renders the right button. */
    standing,
  };
}

/**
 * Every community, newest first, each carrying the caller's own standing.
 *
 * One query rather than a list plus a membership lookup per card: the caller's
 * memberships are read once by `by_email_status` and joined in memory, so the cost
 * does not grow with how many communities are on screen.
 */
export const listCommunities = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.email ? normalise(identity.email) : null;

    const rows = (await ctx.db.query("communities").withIndex("by_created").order("desc").collect())
      .filter((row) => !row.archived);

    const standings = new Map<string, Standing>();
    if (me) {
      const mine = await ctx.db
        .query("communityMembers")
        .withIndex("by_email_status", (q) => q.eq("email", me))
        .collect();
      for (const row of mine) standings.set(row.communityId, standingOf(row));
    }

    const profiles = await profileIndex(ctx);
    const nameFor = (email: string) =>
      profiles.byEmail.get(normalise(email))?.name ?? fallbackLabel(email);

    return {
      signedIn: me !== null,
      rows: rows.map((row) =>
        communityCard(
          row,
          standings.get(row._id) ?? "guest",
          nameFor(row.createdByEmail),
        ),
      ),
    };
  },
});

/**
 * One community in full, plus what the caller may do with it.
 *
 * `slug` and not an id, because this is a URL. Returns null for an unknown slug so
 * the page can tell "no such community" from "still loading" — a Convex query
 * already returns `undefined` for the latter.
 */
export const communityBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.email ? normalise(identity.email) : null;

    const community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim()))
      .first();
    if (!community) return null;

    const membership = me ? await membershipOf(ctx, community._id, me) : null;
    const standing = standingOf(membership);

    const questions = (
      await ctx.db
        .query("questions")
        .withIndex("by_community", (q) => q.eq("communityId", community._id))
        .collect()
    )
      .filter((row) => row.active)
      .sort((a, b) => a.order - b.order)
      .map((row) => ({
        _id: row._id,
        prompt: row.prompt,
        kind: row.kind,
        options: row.options,
        required: row.required,
      }));

    const profiles = await profileIndex(ctx);

    return {
      _id: community._id,
      name: community.name,
      slug: community.slug,
      tagline: community.tagline,
      description: community.description,
      visibility: community.visibility as Visibility,
      scopeBatch: community.scopeBatch ?? null,
      scopeDepartment: community.scopeDepartment ?? null,
      memberCount: community.memberCount,
      postCount: community.postCount,
      createdAt: community.createdAt,
      createdByName:
        profiles.byEmail.get(normalise(community.createdByEmail))?.name ??
        fallbackLabel(community.createdByEmail),
      standing,
      membershipId: membership?._id ?? null,
      canModerate: canModerate(standing),
      /** Asked only by an approval community; see requestToJoin. */
      joinQuestions: community.visibility === "approval" ? questions : [],
      /** True once the caller may read and write the feed. */
      canPost: standing === "member" || canModerate(standing),
    };
  },
});

/** The member list. Active members are visible to any active member. */
export const membersOf = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const mine = await membershipOf(ctx, args.communityId, email);
    if (standingOf(mine) === "guest" || mine?.status !== "active") {
      throw new ConvexError("Join this community to see who else is in it.");
    }

    const rows = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_status", (q) =>
        q.eq("communityId", args.communityId).eq("status", "active"),
      )
      .collect();

    const profiles = await profileIndex(ctx);
    const ROLE_ORDER = { admin: 0, moderator: 1, member: 2 } as const;

    return rows
      .map((row) => {
        const profile = profiles.byEmail.get(normalise(row.email));
        return {
          membershipId: row._id,
          role: row.role,
          joinedAt: row.decidedAt ?? row.createdAt,
          name: profile?.name ?? fallbackLabel(row.email),
          alumniId: profile?._id ?? null,
          batch: profile?.batch ?? null,
          department: profile?.department ?? null,
          designation: profile?.designation ?? null,
          company: profile?.company ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          verified: profile?.verified ?? false,
          isYou: normalise(row.email) === email,
        };
      })
      .sort(
        (a, b) =>
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
          a.name.localeCompare(b.name),
      );
  },
});

/**
 * The pending queue, with each requester's answers to the screening questions.
 *
 * Moderators only — a join request carries a note and answers written by a named
 * member, addressed to whoever decides. Returns `[]` rather than throwing for a
 * non-moderator so a community page can render without the queue instead of
 * failing entirely.
 */
export const joinRequests = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.email ? normalise(identity.email) : null;
    if (!me) return [];

    const mine = await membershipOf(ctx, args.communityId, me);
    if (!canModerate(standingOf(mine))) return [];

    const rows = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_status", (q) =>
        q.eq("communityId", args.communityId).eq("status", "pending"),
      )
      .collect();

    const questions = await ctx.db
      .query("questions")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const promptById = new Map(questions.map((q) => [q._id, q.prompt]));

    const profiles = await profileIndex(ctx);

    return Promise.all(
      rows
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async (row) => {
          const answers = await ctx.db
            .query("questionAnswers")
            .withIndex("by_community_email", (q) =>
              q.eq("communityId", args.communityId).eq("email", row.email),
            )
            .collect();
          const profile = profiles.byEmail.get(normalise(row.email));
          return {
            membershipId: row._id,
            askedAt: row.createdAt,
            note: row.note ?? null,
            name: profile?.name ?? fallbackLabel(row.email),
            alumniId: profile?._id ?? null,
            batch: profile?.batch ?? null,
            department: profile?.department ?? null,
            designation: profile?.designation ?? null,
            company: profile?.company ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            verified: profile?.verified ?? false,
            answers: answers.map((answer) => ({
              prompt: promptById.get(answer.questionId) ?? "Question removed",
              answer: answer.answer,
            })),
          };
        }),
    );
  },
});

/** The communities the caller belongs to, for their own sidebar. */
export const myCommunities = query({
  args: {},
  handler: async (ctx) => {
    const email = await requireEmail(ctx);
    const mine = await ctx.db
      .query("communityMembers")
      .withIndex("by_email_status", (q) => q.eq("email", email))
      .collect();

    const rows = await Promise.all(
      mine
        .filter((row) => row.status === "active" || row.status === "pending")
        .map(async (row) => {
          const community = await ctx.db.get(row.communityId);
          if (!community || community.archived) return null;
          return {
            _id: community._id,
            name: community.name,
            slug: community.slug,
            tagline: community.tagline,
            visibility: community.visibility as Visibility,
            memberCount: community.memberCount,
            postCount: community.postCount,
            standing: standingOf(row),
          };
        }),
    );

    const live = rows.filter((row) => row !== null);
    return {
      rows: live,
      pending: live.filter((row) => row.standing === "pending").length,
    };
  },
});

/** How many requests are waiting on the caller, across every space they run. */
export const moderationCount = query({
  args: {},
  handler: async (ctx) => {
    const email = await requireEmail(ctx);
    const mine = await ctx.db
      .query("communityMembers")
      .withIndex("by_email_status", (q) => q.eq("email", email).eq("status", "active"))
      .collect();

    const counts = await Promise.all(
      mine
        .filter((row) => canModerate(row.role))
        .map(async (row) => {
          const pending = await ctx.db
            .query("communityMembers")
            .withIndex("by_community_status", (q) =>
              q.eq("communityId", row.communityId).eq("status", "pending"),
            )
            .collect();
          return pending.length;
        }),
    );

    return counts.reduce((sum, n) => sum + n, 0);
  },
});
