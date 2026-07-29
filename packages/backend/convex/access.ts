import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

/**
 * Module 1 — user roles, access and verification.
 *
 * Covers the three parts of the brief that need server state: OTP verification,
 * role-based access, and alumni verification for authenticity. Social login is
 * configured in auth.ts, not here.
 */

const OTP_TTL_MS = 10 * 60 * 1000; // Ten minutes.
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SHA-256 hex. Codes are only ever stored hashed. */
async function hashCode(email: string, code: string) {
  // The email is mixed in so an identical code for two members hashes differently.
  const data = new TextEncoder().encode(`${email.toLowerCase()}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Six digits, drawn from a CSPRNG rather than Math.random. */
function generateCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

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

// ---------------------------------------------------------------------------
// OTP verification
// ---------------------------------------------------------------------------

export const _latestChallenge = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("otpChallenges")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .order("desc")
      .first(),
});

export const _putChallenge = internalMutation({
  args: {
    email: v.string(),
    codeHash: v.string(),
    purpose: v.union(v.literal("signup"), v.literal("signin")),
  },
  handler: async (ctx, args) => {
    // Drop any earlier codes for this address so only the newest one works.
    const old = await ctx.db
      .query("otpChallenges")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    await Promise.all(old.map((row) => ctx.db.delete(row._id)));

    const now = Date.now();
    return ctx.db.insert("otpChallenges", {
      email: args.email,
      codeHash: args.codeHash,
      purpose: args.purpose,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      createdAt: now,
    });
  },
});

export const _consumeChallenge = internalMutation({
  args: { email: v.string(), codeHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("otpChallenges")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .order("desc")
      .first();

    if (!row) return { ok: false, reason: "Request a code first." };
    if (row.consumedAt) {
      return { ok: false, reason: "That code was already used. Request a new one." };
    }
    if (Date.now() > row.expiresAt) {
      return { ok: false, reason: "That code has expired. Request a new one." };
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: "Too many attempts. Request a new code." };
    }

    if (row.codeHash !== args.codeHash) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      const left = OTP_MAX_ATTEMPTS - (row.attempts + 1);
      return {
        ok: false,
        reason:
          left > 0
            ? `That code is not right. ${left} ${left === 1 ? "attempt" : "attempts"} left.`
            : "Too many attempts. Request a new code.",
      };
    }

    await ctx.db.patch(row._id, { consumedAt: Date.now() });
    return { ok: true, reason: null, purpose: row.purpose };
  },
});

/**
 * Issues an OTP and emails it.
 *
 * Delivery goes through Resend. Set the key on the deployment with:
 *   npx convex env set RESEND_API_KEY re_xxx
 *   npx convex env set OTP_FROM_EMAIL "RITAA <alumni@ritrjpm.ac.in>"
 * Without a key this throws a plain message instead of pretending a mail was
 * sent — a code the member never receives is worse than a clear failure.
 */
export const startOtp = action({
  args: {
    email: v.string(),
    purpose: v.union(v.literal("signup"), v.literal("signin")),
  },
  handler: async (ctx, args): Promise<{ sent: true; expiresInMinutes: number }> => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");

    const previous = await ctx.runQuery(internal.access._latestChallenge, { email });
    if (previous && Date.now() - previous.createdAt < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (Date.now() - previous.createdAt)) / 1000,
      );
      throw new Error(`Wait ${wait}s before requesting another code.`);
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Email delivery is not configured yet, so a code cannot be sent. Set RESEND_API_KEY on the Convex deployment, or sign in with a password.",
      );
    }

    const code = generateCode();
    await ctx.runMutation(internal.access._putChallenge, {
      email,
      codeHash: await hashCode(email, code),
      purpose: args.purpose,
    });

    const from = process.env.OTP_FROM_EMAIL ?? "RITAA <onboarding@resend.dev>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `${code} is your RITAA verification code`,
        text: [
          `Your RITAA verification code is ${code}.`,
          "",
          "It expires in 10 minutes. If you did not request it, ignore this email.",
          "",
          "Ramco Institute of Technology Alumni Association",
        ].join("\n"),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `The code could not be emailed (${response.status}). ${detail.slice(0, 180)}`,
      );
    }

    return { sent: true, expiresInMinutes: OTP_TTL_MS / 60000 };
  },
});

/** Checks a submitted code. Returns a reason rather than throwing on a wrong code. */
export const confirmOtp = action({
  args: { email: v.string(), code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reason: string | null }> => {
    const email = args.email.trim().toLowerCase();
    const code = args.code.trim();
    if (!/^\d{6}$/.test(code)) {
      return { ok: false, reason: "Enter the six digits from the email." };
    }

    const result = await ctx.runMutation(internal.access._consumeChallenge, {
      email,
      codeHash: await hashCode(email, code),
    });
    return { ok: result.ok, reason: result.reason };
  },
});
