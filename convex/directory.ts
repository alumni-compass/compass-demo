import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";

/**
 * Contact fields are withheld unless the member has explicitly opted in.
 *
 * `hiddenFields` originally worked the other way round — absent meant published
 * — so a member who never opened the profile editor had their email and phone
 * returned to any caller. That inverts GDPR Art. 25 (protection by default) and
 * Art. 5(1)(c) (minimisation): a contact number should never be published
 * because someone failed to opt out.
 *
 * Reading it as opt-IN is also the safe direction for the existing rows: the
 * seeded members all carry a phone number and none of them consented to it being
 * public, so they are now private until each member chooses otherwise.
 */
const CONTACT_FIELDS = ["email", "phone", "linkedinUrl"] as const;

/**
 * Module 2 asks for per-field visibility. Redaction happens here rather than in
 * the browser, so a hidden phone number never leaves the backend.
 */
function publicView(alumnus: Doc<"alumni">) {
  const hidden = new Set(alumnus.hiddenFields ?? []);
  // Opt-in list. A field named here has been deliberately made public.
  const shared = new Set(alumnus.sharedFields ?? []);
  const isShared = (field: (typeof CONTACT_FIELDS)[number]) =>
    shared.has(field) && !hidden.has(field);

  return {
    _id: alumnus._id,
    name: alumnus.name,
    batch: alumnus.batch,
    department: alumnus.department,
    designation: alumnus.designation,
    company: hidden.has("company") ? null : alumnus.company,
    region: hidden.has("region") ? null : alumnus.region,
    email: isShared("email") ? alumnus.email : null,
    phone: isShared("phone") ? (alumnus.phone ?? null) : null,
    skills: alumnus.skills,
    industries: alumnus.industries,
    bio: alumnus.bio ?? null,
    avatarUrl: alumnus.avatarUrl ?? null,
    linkedinUrl: isShared("linkedinUrl") ? (alumnus.linkedinUrl ?? null) : null,
    verified: alumnus.verified,
    featured: alumnus.featured,
    openToMentor: alumnus.openToMentor,
    mentorTopics: alumnus.mentorTopics ?? [],
  };
}

export type DirectoryEntry = ReturnType<typeof publicView>;

/**
 * Smart search across the directory. `text` uses the full-text index when
 * present; otherwise we page the batch index, which keeps the common
 * "show me my batch" case cheap.
 */
export const search = query({
  args: {
    text: v.optional(v.string()),
    batch: v.optional(v.number()),
    department: v.optional(v.string()),
    region: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 60;
    const text = args.text?.trim();

    let rows: Doc<"alumni">[];
    if (text) {
      rows = await ctx.db
        .query("alumni")
        .withSearchIndex("search_alumni", (q) => {
          let search = q.search("name", text);
          if (args.batch !== undefined) search = search.eq("batch", args.batch);
          if (args.department) search = search.eq("department", args.department);
          if (args.region) search = search.eq("region", args.region);
          return search;
        })
        .take(limit);
    } else if (args.batch !== undefined) {
      rows = await ctx.db
        .query("alumni")
        .withIndex("by_batch", (q) => q.eq("batch", args.batch!))
        .take(limit * 2);
    } else if (args.department) {
      rows = await ctx.db
        .query("alumni")
        .withIndex("by_department", (q) => q.eq("department", args.department!))
        .take(limit * 2);
    } else {
      rows = await ctx.db.query("alumni").take(limit * 2);
    }

    // Filters the chosen index could not express.
    const filtered = rows.filter((r) => {
      if (args.batch !== undefined && r.batch !== args.batch) return false;
      if (args.department && r.department !== args.department) return false;
      if (args.region && r.region !== args.region) return false;
      return true;
    });

    return filtered.slice(0, limit).map(publicView);
  },
});

/** Cohort counts that drive the batch rail. */
export const batchCounts = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("alumni").collect();
    const counts = new Map<number, number>();
    for (const a of all) counts.set(a.batch, (counts.get(a.batch) ?? 0) + 1);
    return [...counts.entries()]
      .map(([batch, count]) => ({ batch, count }))
      .sort((a, b) => a.batch - b.batch);
  },
});

/** Department counts for the directory facet list. */
export const departmentCounts = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("alumni").collect();
    const counts = new Map<string, number>();
    for (const a of all) {
      counts.set(a.department, (counts.get(a.department) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count);
  },
});

/** Featured alumni highlight reel for the homepage. */
export const featured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("alumni")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .take(args.limit ?? 6);
    return rows.map(publicView);
  },
});

/** Headline numbers for the homepage. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const alumni = await ctx.db.query("alumni").collect();
    const ventures = await ctx.db.query("ventures").collect();
    const mentors = alumni.filter((a) => a.openToMentor).length;
    const batches = new Set(alumni.map((a) => a.batch));
    const companies = new Set(alumni.map((a) => a.company).filter(Boolean));
    return {
      alumni: alumni.length,
      batches: batches.size,
      mentors,
      companies: companies.size,
      ventures: ventures.filter((vv) => vv.approved).length,
    };
  },
});
