import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from "./_generated/server";
import { type Role, requireRole } from "./authz";

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
 * Everybody the portal knows about, for the terminal.
 *
 * WHY THIS IS A CLI FUNCTION AND NOT A PAGE. There is a chicken-and-egg the
 * console cannot solve: the admin panels are invisible to anyone without the
 * admin role, and the role is keyed on an email address. Somebody granted admin
 * on one address and signed in with another sees a guest's portal and has no
 * way to discover why. Answering that needs a view from outside the session,
 * which is exactly what the deploy key gives:
 *
 *   cd packages/backend
 *   npx convex run access:listMembers
 *
 * It lists every profile with its role and verification, plus every role row
 * that has no profile behind it yet — which is the case that matters, because a
 * role granted before somebody first signs in looks like nothing at all.
 */
export const listMembers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("alumni").collect();
    const roles = await ctx.db.query("memberRoles").collect();
    const roleByEmail = new Map(
      roles.map((row) => [row.email.trim().toLowerCase(), row.role]),
    );

    const members = profiles
      .map((row) => {
        const email = row.email.trim().toLowerCase();
        return {
          name: row.name,
          email,
          role: roleByEmail.get(email) ?? "guest (no explicit grant)",
          verified: row.verified,
          batch: row.batch,
          department: row.department,
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));

    const withProfiles = new Set(members.map((row) => row.email));
    const grantsWithoutProfile = roles
      .map((row) => row.email.trim().toLowerCase())
      .filter((email) => !withProfiles.has(email))
      .sort()
      .map((email) => ({ email, role: roleByEmail.get(email) ?? "guest" }));

    return {
      members,
      grantsWithoutProfile,
      counts: {
        profiles: members.length,
        verified: members.filter((row) => row.verified).length,
        admins: roles.filter((row) => row.role === "admin").length,
      },
    };
  },
});

/**
 * Marks a member verified, or takes it back. The admin's own button.
 *
 * WHY THIS EXISTS BESIDE `reviewVerification`. That one answers a REQUEST: it
 * needs a row in `verificationRequests` and refuses without one. The join form
 * that filed those rows is gone, so in practice there are none — and an admin
 * looking at a real member had no way to verify them at all. This works from
 * the member's profile instead, which is the record that carries the flag.
 *
 * A PUBLIC MUTATION GATED ON THE ROLE, and that is a deliberate promotion.
 * Every privileged write here used to be `internalMutation`, reachable only
 * through the CLI, precisely because `/admin` had no access gate and a public
 * mutation would have let any visitor verify themselves. `requireRole` is that
 * gate: the caller's address comes from the session token, the role is resolved
 * server-side, and `admin` is only ever granted by `setRole`, which is still
 * internal. So this cannot be self-served — the exact condition `adminOps.ts`
 * named as the prerequisite for promoting these.
 *
 * UN-VERIFYING LEAVES THE ROLE ALONE. Verification says whether the office has
 * checked a roll number; the alumni role is what opens the directory. Stripping
 * both on one click would quietly evict a member to correct a badge, so the
 * flag moves and the role stays. Use `setRole` when the role is the thing.
 */
async function applyVerified(
  ctx: MutationCtx,
  rawEmail: string,
  verified: boolean,
) {
  const email = rawEmail.trim().toLowerCase();
  const listing = await ctx.db
    .query("alumni")
    .filter((q) => q.eq(q.field("email"), email))
    .first();
  if (!listing) {
    throw new Error(
      `No directory profile for ${email}. A member is verified against their own record, so they have to fill in their details first.`,
    );
  }

  await ctx.db.patch(listing._id, { verified });

  if (verified) {
    // Approval also opens the directory, the same as reviewVerification.
    const existingRole = await ctx.db
      .query("memberRoles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!existingRole) {
      await ctx.db.insert("memberRoles", {
        email,
        role: "alumni",
        updatedAt: Date.now(),
      });
    } else if (existingRole.role === "guest") {
      // An admin or entrepreneur keeps what they have: verifying somebody must
      // never demote them.
      await ctx.db.patch(existingRole._id, {
        role: "alumni",
        updatedAt: Date.now(),
      });
    }

    // Keep any request row in step, so the queue stops showing them.
    const request = await ctx.db
      .query("verificationRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (request && request.status !== "approved") {
      await ctx.db.patch(request._id, {
        status: "approved",
        reviewedAt: Date.now(),
      });
    }
  }

  return { email, verified };
}

export const setVerified = mutation({
  args: { email: v.string(), verified: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    return applyVerified(ctx, args.email, args.verified);
  },
});

/**
 * The same thing from the terminal, for the bootstrap.
 *
 * `setVerified` needs an admin SESSION, which the CLI does not have — and the
 * first admin has to be able to verify somebody before anybody can use the
 * console, including themselves. `reviewVerification` cannot stand in for it:
 * that one answers a row in `verificationRequests`, and the join form that
 * filed those rows no longer exists, so it fails with "No verification request
 * for …" on every real member.
 *
 * Both call the same `applyVerified`, so the console button and this command
 * cannot drift into meaning different things.
 *
 *   npx convex run access:markVerified {"email":"…","verified":true}
 */
export const markVerified = internalMutation({
  args: { email: v.string(), verified: v.boolean() },
  handler: async (ctx, args) => applyVerified(ctx, args.email, args.verified),
});

/**
 * The one normal form for an address a role is granted to.
 *
 * WHY THIS EXISTS. `setRole` is run by hand from a terminal, and it used to
 * accept whatever was typed after a trim and a lowercase. A mistyped address
 * therefore created a SECOND role row that no sign-in could ever match — a
 * phantom admin that reads as granted and can never be used. That happened
 * with `alumni@ritrjpm.ac.in.`, one trailing dot.
 *
 * The dot is stripped rather than refused: a trailing dot is a legal
 * fully-qualified domain, no OAuth provider ever returns one, and the address
 * the operator meant is unambiguous. Anything that is still not an address is
 * refused loudly, because the alternative is a grant that silently does
 * nothing.
 */
function roleEmail(raw: string): string {
  const email = raw.trim().toLowerCase().replace(/\.+$/, "");
  if (!EMAIL_RE.test(email)) {
    throw new Error(
      `"${raw}" is not an email address, so a role granted to it could never be used. Check the spelling.`,
    );
  }
  return email;
}

/**
 * Revokes a role, by removing the row entirely.
 *
 * `setRole` to "guest" is not the same thing: it leaves an explicit grant of
 * the least-privileged role, which `resolveRole` already returns by default —
 * so the row says something is decided when nothing is. This deletes it, and
 * the address falls back to whatever its verification and ventures imply.
 *
 *   npx convex run access:clearRole {"email":"someone@example.com"}
 *
 * Also the way to clean up a mistyped grant, which is what it was added for.
 */
export const clearRole = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Not `roleEmail`: a row created before that validation existed may hold a
    // malformed address, and refusing to delete it would be a trap.
    const email = args.email.trim().toLowerCase();
    const row = await ctx.db
      .query("memberRoles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!row) return { deleted: false, email };
    await ctx.db.delete(row._id);
    return { deleted: true, email };
  },
});

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

const roleValidator = v.union(
  v.literal("alumni"),
  v.literal("entrepreneur"),
  v.literal("admin"),
  v.literal("guest"),
);

/**
 * Writes a role, or removes the row when the role is `guest`.
 *
 * GUEST IS AN ABSENCE, not a value. `resolveRole` already answers guest for an
 * address with no grant, so storing an explicit guest row asserts a decision
 * nobody made — and worse, it would pin someone to guest even after their
 * verification would otherwise have made them an alumnus. Deleting the row lets
 * the derived answer take over again, which is what "no special role" means.
 */
async function applyRole(ctx: MutationCtx, email: string, role: Role) {
  const existing = await ctx.db
    .query("memberRoles")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();

  if (role === "guest") {
    if (existing) await ctx.db.delete(existing._id);
    return { email, role, removed: existing !== null };
  }

  if (existing) {
    await ctx.db.patch(existing._id, { role, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("memberRoles", { email, role, updatedAt: Date.now() });
  }
  return { email, role, removed: false };
}

/**
 * Sets or removes a member's role, from the admin console.
 *
 * WHAT THIS CHANGES ABOUT THE TRUST MODEL, stated plainly. Role granting was
 * CLI-only precisely so admin could not be self-assigned from a browser. The
 * important half of that is kept — `requireRole` means only an existing admin
 * reaches this at all, and the FIRST admin still has to be granted from the
 * terminal by whoever holds the deploy key. What is new is that admins can now
 * appoint and remove each other without a shell.
 *
 * ONE GUARD, and it is the one that matters: THE LAST ADMIN CANNOT BE DEMOTED.
 * Not by somebody else, and not by themselves. Without it a single click
 * empties the console for everyone, and the only way back is the deploy key —
 * which the person clicking may not have. Better Auth refuses to unlink a
 * member's last account for exactly this reason.
 *
 * Stepping down IS allowed once another admin exists, including on your own
 * row. An admin leaving the committee should not need somebody else to do it
 * for them, and the guard above already makes the dangerous version impossible.
 */
export const assignRole = mutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const email = roleEmail(args.email);

    if (args.role !== "admin") {
      const current = await ctx.db
        .query("memberRoles")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();

      if (current?.role === "admin") {
        const rows = await ctx.db.query("memberRoles").collect();
        const admins = rows.filter((row) => row.role === "admin");
        if (admins.length <= 1) {
          throw new Error(
            "That is the only admin left. Appoint another one first, or nobody can reach the console.",
          );
        }
      }
    }

    return applyRole(ctx, email, args.role);
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
    // No guard here on purpose. This is the terminal, reachable only with the
    // deploy key, and it is both how the first admin is appointed and how the
    // console is recovered if it has locked everybody out.
    return applyRole(ctx, roleEmail(args.email), args.role);
  },
});
