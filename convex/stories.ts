import { v } from "convex/values";

import { query } from "./_generated/server";

/** Module 6 — news, success stories, event recaps and the newsletter archive. */
export const list = query({
  args: {
    category: v.optional(
      v.union(
        v.literal("success"),
        v.literal("achievement"),
        v.literal("recap"),
        v.literal("newsletter"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("stories")
      .withIndex("by_published")
      .order("desc")
      .collect();
    const filtered = args.category
      ? rows.filter((s) => s.category === args.category)
      : rows;
    return filtered.slice(0, args.limit ?? 50);
  },
});

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("stories")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique(),
});

export const featured = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("stories")
      .withIndex("by_published")
      .order("desc")
      .collect();
    return rows.filter((s) => s.featured).slice(0, 3);
  },
});

/** Media gallery, newest year first. */
export const albums = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("albums").withIndex("by_year").collect();
    return rows.sort((a, b) => b.year - a.year);
  },
});
