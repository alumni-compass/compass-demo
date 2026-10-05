import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

/**
 * Module 9 — Entrepreneur Zone, powered by RACE.
 *
 * The brief splits founders into two user types: established founders who
 * publish a full business profile, and upcoming founders who submit an idea and
 * ask for guidance. Both live in one table so the community feed can mix them.
 */
export const listVentures = query({
  args: {
    stage: v.optional(v.union(v.literal("established"), v.literal("upcoming"))),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ventures")
      .withIndex("by_approved", (q) => q.eq("approved", true))
      .collect();

    return rows
      .filter((r) => (args.stage ? r.stage === args.stage : true))
      .filter((r) => (args.category ? r.category === args.category : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Category facets for the industry/domain filter. */
export const categories = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("ventures")
      .withIndex("by_approved", (q) => q.eq("approved", true))
      .collect();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  },
});

export const raceStats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("ventures")
      .withIndex("by_approved", (q) => q.eq("approved", true))
      .collect();
    return {
      total: rows.length,
      established: rows.filter((r) => r.stage === "established").length,
      upcoming: rows.filter((r) => r.stage === "upcoming").length,
      categories: new Set(rows.map((r) => r.category)).size,
      mentoringOffered: rows.filter((r) => r.offersHelp.length > 0).length,
    };
  },
});

/**
 * Submissions land unapproved — the admin panel moderates before a venture
 * appears in the public feed.
 */
export const submitVenture = mutation({
  args: {
    founderName: v.string(),
    founderEmail: v.string(),
    founderBatch: v.optional(v.number()),
    age: v.optional(v.number()),
    contact: v.optional(v.string()),
    businessName: v.string(),
    category: v.string(),
    website: v.optional(v.string()),
    description: v.string(),
    productImageUrls: v.optional(v.array(v.string())),
    stage: v.union(v.literal("established"), v.literal("upcoming")),
    lookingFor: v.optional(v.array(v.string())),
    offersHelp: v.optional(v.array(v.string())),
    location: v.string(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("ventures", {
      ...args,
      productImageUrls: args.productImageUrls ?? [],
      lookingFor: args.lookingFor ?? [],
      offersHelp: args.offersHelp ?? [],
      approved: false,
      createdAt: Date.now(),
    }),
});
