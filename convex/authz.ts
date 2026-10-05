import type { Auth } from "convex/server";

import type { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Authorization helpers.
 *
 * Every Convex `query` and `mutation` is reachable by anyone who knows the
 * deployment URL — there is no implicit session. These helpers are the single
 * place that turns "the caller sent an email string" into "the caller proved who
 * they are", so handlers stop trusting caller-supplied identity.
 *
 * The rule throughout: never compare an argument against the session email —
 * DERIVE the email from the session and ignore the argument entirely. Comparing
 * still lets a caller probe for which addresses exist.
 */

export type Role = "alumni" | "entrepreneur" | "admin" | "guest";

type AnyCtx = QueryCtx | MutationCtx;

/** Throws unless the caller has a session. Returns the verified identity. */
export async function requireIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Sign in to continue.");
  }
  return identity;
}

/**
 * The same check, for an action.
 *
 * An action carries the caller's verified identity and no `db` at all, so it
 * cannot satisfy `AnyCtx`. This is a second function rather than a widening of
 * `requireIdentity`, because `chat.ts` types its own helper as
 * `Parameters<typeof requireIdentity>[0]` — widening that signature silently
 * strips `runQuery` from it and breaks a module that has nothing to do with
 * actions.
 */
export async function requireActionIdentity(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Sign in to continue.");
  }
  return identity;
}

/**
 * The caller's own email address, taken from the verified token.
 *
 * This is what handlers should key writes on. Never accept an email argument for
 * a write that touches someone's own record.
 */
export async function requireEmail(ctx: AnyCtx): Promise<string> {
  const identity = await requireIdentity(ctx);
  const email = identity.email;
  if (!email) {
    throw new Error("Your account has no email address attached.");
  }
  return email.trim().toLowerCase();
}

/** Resolves a role server-side. Mirrors access.roleFor but keyed on the session. */
export async function resolveRole(ctx: AnyCtx, email: string): Promise<Role> {
  const assigned = await ctx.db
    .query("memberRoles")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (assigned) return assigned.role;

  // Must be APPROVED — an unapproved submission would otherwise let anyone
  // self-assign the Entrepreneur role just by posting the form.
  const venture = await ctx.db
    .query("ventures")
    .filter((q) =>
      q.and(
        q.eq(q.field("founderEmail"), email),
        q.eq(q.field("approved"), true),
      ),
    )
    .first();
  if (venture) return "entrepreneur";

  const request = await ctx.db
    .query("verificationRequests")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (request?.status === "approved") return "alumni";

  return "guest";
}

/**
 * Gate for privileged operations. `admin` is only ever granted by
 * access.setRole, which is an internalMutation — so it cannot be self-assigned.
 */
export async function requireRole(ctx: AnyCtx, allowed: Role[]) {
  const email = await requireEmail(ctx);
  const role = await resolveRole(ctx, email);
  if (!allowed.includes(role)) {
    throw new Error("You do not have access to this.");
  }
  return { email, role };
}

/**
 * Gate for member-only reads such as the directory.
 *
 * The brief's access model puts alumni contact details behind membership, so
 * anything that returns another member's details must sit behind this.
 */
export async function requireMember(ctx: AnyCtx) {
  return requireRole(ctx, ["alumni", "entrepreneur", "admin"]);
}
