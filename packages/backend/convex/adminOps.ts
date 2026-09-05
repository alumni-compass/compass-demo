import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import { resolveRole } from "./authz";

/**
 * Soft admin check.
 *
 * Returns false instead of throwing: a Convex query that throws propagates into
 * the React render and takes the whole /admin route down. Since nothing grants
 * the admin role from a browser yet, throwing here would make the panel
 * permanently unreachable rather than merely empty. Callers return a
 * `{ authorized: false }` shape and the page renders a sign-in notice.
 */
async function isAdmin(ctx: Parameters<typeof resolveRole>[0]) {
  const identity = await ctx.auth.getUserIdentity();
  const email = identity?.email?.trim().toLowerCase();
  if (!email) return false;
  return (await resolveRole(ctx, email)) === "admin";
}

/**
 * Lets the panel distinguish "the queue is empty" from "you are not an admin".
 *
 * Without this the gated queues above return [] in both cases, and the page
 * would cheerfully report a clear moderation queue to someone who simply cannot
 * see it — the most dangerous kind of wrong, because it looks like good news.
 */
export const adminAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const email = identity?.email?.trim().toLowerCase() ?? null;
    const role = email ? await resolveRole(ctx, email) : null;
    return {
      signedIn: Boolean(email),
      role,
      isAdmin: role === "admin",
      /** Queues return empty rather than throwing when this is false. */
      queuesVisible: role === "admin",
    };
  },
});

/**
 * Module 10 — admin panel: the moderation queues.
 *
 * `race.ts` only ever reads the `by_approved` index with `approved: true`, which
 * is correct for the public RACE feed but means the *pending* queue — the whole
 * point of an admin panel — is invisible to every client. This module supplies
 * the missing reads, and nothing else.
 *
 * The read/write split here is deliberate, not incidental:
 *
 *   READS  are public `query`s. `/admin` is not access-gated yet, so anything
 *          exposed here is world-readable — including applicant roll numbers and
 *          email addresses. The panel says so in its access-control banner, and
 *          that gate is the blocking item before deployment.
 *
 *   WRITES are `internalMutation`. A public mutation that flipped `approved`
 *          would let any visitor publish anything into the RACE feed, and a
 *          public delete would let any visitor clear the queue. Neither is
 *          acceptable on an unauthenticated route, so approve and reject are
 *          reachable only through the Convex CLI / dashboard, which authenticate
 *          with the deployment's admin key:
 *
 *            cd packages/backend
 *            npx convex run adminOps:approveVenture '{"ventureId":"<id>"}'
 *            npx convex run adminOps:rejectVenture  '{"ventureId":"<id>"}'
 *
 *          Same posture as `access.ts reviewVerification`, for the same reason.
 *          Once `/admin` sits behind a real admin session these can be promoted
 *          to public mutations with a server-side role check; until that exists,
 *          the deploy key *is* the authentication.
 *
 * Both queues are inherently small — they hold only what has not been actioned —
 * so `collect()` is the honest read here rather than a paginated one.
 */

/* ------------------------------------------------------------------ */
/* Content moderation — ventures awaiting approval                     */
/* ------------------------------------------------------------------ */

/**
 * Ventures with `approved: false`, oldest first, because a review queue should
 * be first-in-first-out: the founder who has waited longest gets seen first.
 *
 * Uses the `by_approved` index, so this is an index scan of exactly the pending
 * rows rather than a full-table filter.
 */
export const pendingVentures = query({
  args: {},
  handler: async (ctx) => {
    // Admin only: unpublished business ideas and founder contact details.
    if (!(await isAdmin(ctx))) return [];
    const rows = await ctx.db
      .query("ventures")
      .withIndex("by_approved", (q) => q.eq("approved", false))
      .collect();

    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        _id: r._id,
        businessName: r.businessName,
        founderName: r.founderName,
        founderEmail: r.founderEmail,
        founderBatch: r.founderBatch ?? null,
        category: r.category,
        stage: r.stage,
        location: r.location,
        website: r.website ?? null,
        description: r.description,
        lookingFor: r.lookingFor,
        offersHelp: r.offersHelp,
        /** The URLs themselves are not needed to triage; the count is. */
        imageCount: r.productImageUrls.length,
        createdAt: r.createdAt,
      }));
  },
});

/**
 * Publishes a venture into the RACE feed.
 *
 * Internal on purpose — see the module comment. Idempotent: approving an already
 * approved venture reports that rather than throwing, so a repeated CLI call
 * during a review sitting is harmless.
 */
export const approveVenture = internalMutation({
  args: { ventureId: v.id("ventures") },
  handler: async (ctx, args) => {
    const venture = await ctx.db.get(args.ventureId);
    if (!venture) throw new Error("That venture no longer exists.");

    if (venture.approved) {
      return {
        businessName: venture.businessName,
        founderEmail: venture.founderEmail,
        approved: true,
        alreadyApproved: true,
      };
    }

    await ctx.db.patch(args.ventureId, { approved: true });
    return {
      businessName: venture.businessName,
      founderEmail: venture.founderEmail,
      approved: true,
      alreadyApproved: false,
    };
  },
});

/**
 * Rejects a submission by deleting the row.
 *
 * Deletion rather than a flag, because the `ventures` table models publication
 * as a single `approved: boolean` — there is no third "rejected" state to move a
 * row into. A rejected row left in place would therefore sit in the pending
 * queue forever and be re-reviewed at every sitting, which is worse than losing
 * it. The full row is echoed back in the return value so the reviewer's terminal
 * holds the record, and the founder's email comes back with it so they can be
 * told why.
 *
 * The permanent fix is a `status` field on `ventures` plus an admin action log —
 * both schema changes, and `schema.ts` is not this module's to edit.
 */
export const rejectVenture = internalMutation({
  args: { ventureId: v.id("ventures"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const venture = await ctx.db.get(args.ventureId);
    if (!venture) throw new Error("That venture no longer exists.");
    if (venture.approved) {
      throw new Error(
        "That venture is already published. Unpublishing a live venture is not this mutation's job.",
      );
    }

    await ctx.db.delete(args.ventureId);

    return {
      deleted: true,
      reason: args.reason ?? null,
      /** Keep the terminal output as the audit record until a log table exists. */
      snapshot: {
        businessName: venture.businessName,
        founderName: venture.founderName,
        founderEmail: venture.founderEmail,
        category: venture.category,
        stage: venture.stage,
        location: venture.location,
        description: venture.description,
        submittedAt: venture.createdAt,
      },
    };
  },
});

/* ------------------------------------------------------------------ */
/* Member management — alumni waiting on verification                  */
/* ------------------------------------------------------------------ */

/**
 * Join requests still sitting at `pending`, oldest first.
 *
 * `access.ts verificationQueue` returns only the three counts; the panel also
 * needs to know *who* is waiting, so an admin can check a roll number against
 * college records and then action it with:
 *   npx convex run access:reviewVerification '{"email":"…","decision":"approved"}'
 *
 * Reads the `by_status` index, so it touches only pending rows.
 */
export const pendingVerifications = query({
  args: {},
  handler: async (ctx) => {
    /*
     * SECURITY: admin only. The roll number is the single secret in the
     * authenticity gate — verification means matching it against college
     * records. Published openly, an attacker could harvest a real applicant's
     * roll number and re-submit it under their own address, producing a request
     * the office cannot distinguish from the genuine one.
     */
    if (!(await isAdmin(ctx))) return [];
    const rows = await ctx.db
      .query("verificationRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        _id: r._id,
        name: r.name,
        email: r.email,
        batch: r.batch,
        department: r.department,
        rollNumber: r.rollNumber,
        graduationYear: r.graduationYear,
        createdAt: r.createdAt,
      }));
  },
});

/**
 * Everybody who has ever signed in, with the flag an admin is here to change.
 *
 * WHY IT READS THE AUTH COMPONENT AND NOT JUST `alumni`. The first version
 * listed the `alumni` table, which is everyone who has completed the DETAILS
 * FORM — so a member who signed in and never opened it did not appear at all,
 * and an admin could not verify the very people most likely to need chasing.
 * The account list lives in the Better Auth component; `adapter.findMany` is a
 * public query on it, so this reads the `user` model directly and then joins on
 * whatever profile exists.
 *
 * THE JOIN IS THE POINT. Three states matter and they look different here:
 *   signed in, no profile   — nothing to verify against yet, and it says so.
 *   signed in, profile      — verifiable; this is the normal row.
 *   profile, no account     — the seeded office bearers, who have never logged
 *                             in. Kept, because they are real members of the
 *                             association and hiding them would be a lie of
 *                             omission.
 *
 * Unverified first, because that is what an admin came to act on.
 */
export const membersForVerification = query({
  args: { text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await isAdmin(ctx))) {
      return {
        authorized: false as const,
        rows: [],
        counts: { total: 0, verified: 0, signedIn: 0, withoutProfile: 0, shown: 0 },
      };
    }

    /* Every account the portal has issued. Paginated by the component, so a
       page is asked for explicitly rather than assuming a small table. */
    const accounts = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "user",
        paginationOpts: { numItems: 500, cursor: null },
      },
    );

    const signedIn = new Map<string, { name: string | null; createdAt: number | null }>();
    for (const row of accounts.page) {
      const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      if (!email) continue;
      signedIn.set(email, {
        name: typeof row.name === "string" ? row.name : null,
        createdAt:
          typeof row.createdAt === "number"
            ? row.createdAt
            : typeof row._creationTime === "number"
              ? row._creationTime
              : null,
      });
    }

    const profiles = await ctx.db.query("alumni").collect();
    const profileByEmail = new Map(
      profiles.map((row) => [row.email.trim().toLowerCase(), row]),
    );

    const roles = await ctx.db.query("memberRoles").collect();
    const roleByEmail = new Map(
      roles.map((row) => [row.email.trim().toLowerCase(), row.role]),
    );

    /* The union: every account, plus every profile without one. */
    const emails = new Set<string>([...signedIn.keys(), ...profileByEmail.keys()]);

    const all = [...emails].map((email) => {
      const profile = profileByEmail.get(email);
      const account = signedIn.get(email);
      return {
        email,
        name: profile?.name ?? account?.name ?? email,
        hasAccount: account !== undefined,
        hasProfile: profile !== undefined,
        verified: profile?.verified ?? false,
        role: roleByEmail.get(email) ?? "guest",
        batch: profile?.batch ?? null,
        department: profile?.department ?? null,
        joinedAt: profile?.joinedAt ?? account?.createdAt ?? null,
      };
    });

    const needle = (args.text ?? "").trim().toLowerCase();
    const matched = needle
      ? all.filter(
          (row) =>
            row.name.toLowerCase().includes(needle) ||
            row.email.includes(needle) ||
            (row.department ?? "").toLowerCase().includes(needle) ||
            String(row.batch ?? "").includes(needle),
        )
      : all;

    const rows = matched
      .sort(
        (a, b) =>
          Number(a.verified) - Number(b.verified) ||
          Number(b.hasProfile) - Number(a.hasProfile) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 200);

    return {
      authorized: true as const,
      rows,
      counts: {
        total: all.length,
        verified: all.filter((row) => row.verified).length,
        signedIn: signedIn.size,
        withoutProfile: all.filter((row) => row.hasAccount && !row.hasProfile).length,
        shown: rows.length,
      },
    };
  },
});

/**
 * The general feed, as a moderation queue.
 *
 * HIDDEN FIRST, then newest. A hidden post is the one an admin may want to
 * reconsider, and it is invisible to everyone else — so it is the row most
 * easily forgotten and belongs at the top.
 *
 * NO DELETE IS OFFERED, here or in the mutation behind it. Hiding keeps the
 * post readable to its author and to admins, so a decision can be argued with
 * and reversed; a delete cannot. That is the same reasoning the schema comment
 * on `posts.hidden` gives, and an admin who genuinely needs a row gone can
 * still do it from the CLI.
 *
 * Community posts are excluded. Their own moderators handle them, and
 * `feed.setPostHidden` refuses a portal admin there on purpose.
 */
export const postsForModeration = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return { authorized: false as const, rows: [], counts: { total: 0, hidden: 0 } };
    }

    const recent = await ctx.db
      .query("posts")
      .withIndex("by_created")
      .order("desc")
      .take(120);
    const general = recent.filter((post) => post.communityId === undefined);

    const profiles = await ctx.db.query("alumni").collect();
    const nameByEmail = new Map(
      profiles.map((row) => [row.email.trim().toLowerCase(), row.name]),
    );

    const rows = general
      .sort(
        (a, b) =>
          Number(b.hidden) - Number(a.hidden) || b.createdAt - a.createdAt,
      )
      .slice(0, 60)
      .map((post) => ({
        postId: post._id,
        authorEmail: post.authorEmail,
        authorName:
          nameByEmail.get(post.authorEmail.trim().toLowerCase()) ??
          post.authorEmail,
        body: post.body.length > 240 ? `${post.body.slice(0, 240)}…` : post.body,
        kind: post.kind,
        hasMedia:
          post.imageUrls.length > 0 || (post.videoUrls ?? []).length > 0,
        isShare: post.sharedFromId !== undefined,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        hidden: post.hidden,
        hiddenReason: post.hiddenReason ?? null,
        createdAt: post.createdAt,
      }));

    return {
      authorized: true as const,
      rows,
      counts: {
        total: general.length,
        hidden: general.filter((post) => post.hidden).length,
      },
    };
  },
});
