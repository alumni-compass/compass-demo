import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";

/**
 * Module 1 — user roles, access and verification.
 *
 * Covers the two parts of the brief that need server state: role-based access,
 * and alumni verification for authenticity. Sign-in itself is Google and
 * LinkedIn, configured in auth.ts, not here.
 *
 * The OTP challenge that used to live in this file is gone. It only ever proved
 * control of an email address — it could not open a session, because the
 * better-auth server here has no OTP sign-in plugin — and with sign-in reduced
 * to two providers that already confirm the address, it was a second
 * verification step that verified something the provider had verified first.
 * `schema.ts` keeps the now-unwritten `otpChallenges` table so an existing
 * deployment can still be pushed to; see the comment there.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Alumni verification
// ---------------------------------------------------------------------------

/**
 * Submits a join request for the association to check against college records.
 * Re-submitting from the same address updates the pending request rather than
 * queueing a duplicate; an already-approved member cannot silently reset their
 * own verified status.
 */
export const requestVerification = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    batch: v.number(),
    department: v.string(),
    rollNumber: v.string(),
    graduationYear: v.number(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
    if (!args.rollNumber.trim()) throw new Error("Enter your roll number.");

    const existing = await ctx.db
      .query("verificationRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing?.status === "approved") {
      return { status: "approved" as const, alreadyVerified: true };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        batch: args.batch,
        department: args.department,
        rollNumber: args.rollNumber.trim(),
        graduationYear: args.graduationYear,
        status: "pending",
        createdAt: Date.now(),
      });
      return { status: "pending" as const, alreadyVerified: false };
    }

    await ctx.db.insert("verificationRequests", {
      name: args.name,
      email,
      batch: args.batch,
      department: args.department,
      rollNumber: args.rollNumber.trim(),
      graduationYear: args.graduationYear,
      status: "pending",
      createdAt: Date.now(),
    });
    return { status: "pending" as const, alreadyVerified: false };
  },
});

/** Lets a member see where their own request stands. */
export const verificationFor = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("verificationRequests")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!row) return null;
    return {
      status: row.status,
      reviewNote: row.reviewNote ?? null,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt ?? null,
    };
  },
});

/** Counts for the admin dashboard. */
export const verificationQueue = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("verificationRequests").collect();
    return {
      pending: rows.filter((r) => r.status === "pending").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    };
  },
});

/**
 * Approve or reject a request.
 *
 * Internal on purpose: this is the authenticity gate, so it must not be callable
 * from a browser. Run it from the Convex dashboard or CLI until the admin route
 * is behind a real admin session:
 *   npx convex run access:reviewVerification '{"email":"…","decision":"approved"}'
 */
export const reviewVerification = internalMutation({
  args: {
    email: v.string(),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const row = await ctx.db
      .query("verificationRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!row) throw new Error(`No verification request for ${email}.`);

    await ctx.db.patch(row._id, {
      status: args.decision,
      reviewNote: args.reviewNote,
      reviewedAt: Date.now(),
    });

    if (args.decision === "approved") {
      // Grant the alumni role and flip the directory listing to verified.
      const existingRole = await ctx.db
        .query("memberRoles")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (existingRole) {
        await ctx.db.patch(existingRole._id, { role: "alumni", updatedAt: Date.now() });
      } else {
        await ctx.db.insert("memberRoles", {
          email,
          role: "alumni",
          updatedAt: Date.now(),
        });
      }

      const listing = await ctx.db
        .query("alumni")
        .filter((q) => q.eq(q.field("email"), email))
        .unique();
      if (listing) await ctx.db.patch(listing._id, { verified: true });
    }

    return { status: args.decision };
  },
});

// ---------------------------------------------------------------------------
// Role-based access
// ---------------------------------------------------------------------------

/**
 * Resolves the effective role for an email.
 *
 * Anyone unknown is a Guest — the brief's four roles are Alumni, Entrepreneurs,
 * Admins and Guests, and defaulting to the least privileged is the safe default.
 */
export const roleFor = query({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.email) return { role: "guest" as const, source: "no-session" };
    const email = args.email.trim().toLowerCase();

    const assigned = await ctx.db
      .query("memberRoles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (assigned) return { role: assigned.role, source: "assigned" };

    /*
     * A founder with an APPROVED venture is an Entrepreneur even without an
     * explicit grant, which is how the RACE zone stays self-service.
     *
     * The approval condition matters: without it, submitting the form was enough
     * to hold the role, so anyone could self-assign Entrepreneur by posting a
     * venture that the coordinator never approved and that stays invisible in
     * the feed. Role and visibility now flip at the same moment.
     */
    const venture = await ctx.db
      .query("ventures")
      .filter((q) =>
        q.and(
          q.eq(q.field("founderEmail"), email),
          q.eq(q.field("approved"), true),
        ),
      )
      .first();
    if (venture) return { role: "entrepreneur" as const, source: "venture" };

    const request = await ctx.db
      .query("verificationRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (request?.status === "approved") {
      return { role: "alumni" as const, source: "verified" };
    }

    return { role: "guest" as const, source: "unverified" };
  },
});

export const setRole = internalMutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("alumni"),
      v.literal("entrepreneur"),
      v.literal("admin"),
      v.literal("guest"),
    ),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("memberRoles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("memberRoles", {
        email,
        role: args.role,
        updatedAt: Date.now(),
      });
    }
    return { email, role: args.role };
  },
});
