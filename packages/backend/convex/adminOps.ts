import { v } from "convex/values";

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
