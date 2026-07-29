import { v } from "convex/values";

import { internalMutation, query } from "./_generated/server";

/** Module 8 — fundraising, donor wall and the fund usage tracker. */
export const listCampaigns = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const rows = args.activeOnly
      ? await ctx.db
          .query("campaigns")
          .withIndex("by_active", (q) => q.eq("active", true))
          .collect()
      : await ctx.db.query("campaigns").collect();

    return rows
      .map((c) => ({
        ...c,
        // Clamped so a campaign that overshoots its goal never renders past 100%.
        progress: c.goalInr > 0 ? Math.min(1, c.raisedInr / c.goalInr) : 0,
        allocated: c.allocations.reduce((s, a) => s + a.amountInr, 0),
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.raisedInr - a.raisedInr);
  },
});

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique(),
});

/** Donor wall — anonymous gifts still count, but the name is withheld. */
export const donorWall = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("donations")
      .withIndex("by_created")
      .order("desc")
      .take(args.limit ?? 24);

    return rows.map((d) => ({
      _id: d._id,
      donorName: d.anonymous ? "Anonymous donor" : d.donorName,
      batch: d.anonymous ? null : (d.batch ?? null),
      amountInr: d.amountInr,
      message: d.message ?? null,
      createdAt: d.createdAt,
    }));
  },
});

export const givingTotals = query({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query("campaigns").collect();
    const donations = await ctx.db.query("donations").collect();
    return {
      raisedInr: campaigns.reduce((s, c) => s + c.raisedInr, 0),
      goalInr: campaigns.reduce((s, c) => s + c.goalInr, 0),
      donors: donations.length,
      activeCampaigns: campaigns.filter((c) => c.active).length,
    };
  },
});

/**
 * Records a gift and rolls the campaign totals forward.
 *
 * This is the ledger write only — it assumes the payment gateway has already
 * confirmed the charge.
 *
 * SECURITY: internal, not public. As a public mutation anyone could call it
 * directly against the deployment URL and forge donations — inflating
 * `raisedInr`, incrementing `donorCount`, and publishing a fabricated gift
 * attributed to a named alumnus on the donor wall. Money never moved, but the
 * association's published financial record did, with no audit trail to
 * reconstruct the true figures from.
 *
 * Call it from an HTTP action in http.ts that verifies the payment gateway's
 * webhook signature, and add an idempotency key on the gateway transaction id.
 */
export const recordDonation = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    donorName: v.string(),
    batch: v.optional(v.number()),
    amountInr: v.number(),
    method: v.union(
      v.literal("upi"),
      v.literal("card"),
      v.literal("netbanking"),
      v.literal("wallet"),
    ),
    anonymous: v.boolean(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.amountInr <= 0) throw new Error("Enter an amount greater than zero.");
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("That campaign no longer exists.");

    const id = await ctx.db.insert("donations", { ...args, createdAt: Date.now() });
    await ctx.db.patch(args.campaignId, {
      raisedInr: campaign.raisedInr + args.amountInr,
      donorCount: campaign.donorCount + 1,
    });
    return id;
  },
});
