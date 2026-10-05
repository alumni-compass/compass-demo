import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

/** Module 4 — career hub: jobs and internships posted by alumni. */
export const listJobs = query({
  args: {
    type: v.optional(
      v.union(v.literal("full-time"), v.literal("internship"), v.literal("contract")),
    ),
    referralOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("jobs")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    return rows
      .filter((j) => (args.type ? j.type === args.type : true))
      .filter((j) => (args.referralOnly ? j.referralOffered : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const postJob = mutation({
  args: {
    title: v.string(),
    company: v.string(),
    location: v.string(),
    type: v.union(
      v.literal("full-time"),
      v.literal("internship"),
      v.literal("contract"),
    ),
    experience: v.string(),
    description: v.string(),
    skills: v.array(v.string()),
    applyUrl: v.optional(v.string()),
    postedByName: v.string(),
    postedByEmail: v.string(),
    postedByBatch: v.optional(v.number()),
    referralOffered: v.boolean(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("jobs", { ...args, active: true, createdAt: Date.now() }),
});

/** Module 5 — mentors are alumni who opted in, so there is no second profile. */
export const listMentors = query({
  args: { topic: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("alumni")
      .withIndex("by_mentor", (q) => q.eq("openToMentor", true))
      .collect();

    const filtered = args.topic
      ? rows.filter((m) => (m.mentorTopics ?? []).includes(args.topic!))
      : rows;

    return filtered.map((m) => ({
      _id: m._id,
      name: m.name,
      batch: m.batch,
      department: m.department,
      designation: m.designation,
      company: m.company,
      region: m.region,
      avatarUrl: m.avatarUrl ?? null,
      bio: m.bio ?? null,
      verified: m.verified,
      mentorTopics: m.mentorTopics ?? [],
    }));
  },
});

/** Distinct mentor topics, used to build the matching filter. */
export const mentorTopics = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("alumni")
      .withIndex("by_mentor", (q) => q.eq("openToMentor", true))
      .collect();
    const counts = new Map<string, number>();
    for (const m of rows) {
      for (const t of m.mentorTopics ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);
  },
});

export const requestMentorship = mutation({
  args: {
    mentorId: v.id("alumni"),
    seekerName: v.string(),
    seekerEmail: v.string(),
    seekerKind: v.union(v.literal("student"), v.literal("alumnus")),
    topic: v.string(),
    message: v.string(),
    preferredSlot: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("mentorshipRequests", {
      ...args,
      status: "requested",
      createdAt: Date.now(),
    }),
});
