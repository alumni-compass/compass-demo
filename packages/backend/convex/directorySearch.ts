import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { DirectoryEntry } from "./directory";

/**
 * Module 3 — the company filter, moved onto the server.
 *
 * `directory.search` takes batch, department and region but not company, so the
 * directory page used to fetch a capped page and drop non-matching rows in the
 * browser. That is wrong in a way the member cannot see: the cap is applied
 * *before* the company test, so an alumnus at the company being searched for
 * simply never arrives once the association passes the cap.
 *
 * Everything here filters before it counts. `schema.ts` already declares
 * `company` as a filter field on the `search_alumni` search index, so a name
 * query narrows inside the index; without a name query the chosen index is
 * streamed and matching stops as soon as the page is full. Either way the rows
 * returned are `limit` *matches*, not `limit` candidates.
 *
 * `directory.ts` is left untouched — the profile route reads from it.
 */

/** Hard ceiling on one response, whatever the caller asks for. */
const MAX_LIMIT = 500;

/**
 * Same redaction as `directory.publicView`, which is not exported. The
 * `DirectoryEntry` return annotation is what keeps the two shapes identical:
 * this stops compiling if the directory's public view ever changes.
 */
function publicView(alumnus: Doc<"alumni">): DirectoryEntry {
  const hidden = new Set(alumnus.hiddenFields ?? []);
  /*
   * Contact fields are opt-IN, matching directory.ts publicView. This file keeps
   * its own copy of the projection, so the two must agree — if they drift, the
   * looser one becomes the leak and the stricter one gives false assurance.
   */
  const shared = new Set(alumnus.sharedFields ?? []);
  const isShared = (field: "email" | "phone" | "linkedinUrl") =>
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

/**
 * Module 2's per-field visibility has to hold here too. If a member hid their
 * company, returning them in a company-filtered list republishes the value they
 * hid — the filter itself becomes the answer. So a hidden field cannot be
 * filtered on, and the same rule applies to region.
 */
function shares(alumnus: Doc<"alumni">, field: string) {
  return !(alumnus.hiddenFields ?? []).includes(field);
}

/**
 * Streams a query and stops at the first `limit` rows that pass `keep`, so the
 * page limit lands on matches instead of truncating the candidate set.
 */
async function takeMatching(
  source: AsyncIterable<Doc<"alumni">>,
  keep: (row: Doc<"alumni">) => boolean,
  limit: number,
) {
  const kept: Doc<"alumni">[] = [];
  for await (const row of source) {
    if (!keep(row)) continue;
    kept.push(row);
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Smart search for the directory: name text plus batch, department, company and
 * region, all combining, all resolved on the server.
 */
export const search = query({
  args: {
    text: v.optional(v.string()),
    batch: v.optional(v.number()),
    department: v.optional(v.string()),
    region: v.optional(v.string()),
    company: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 60, 1), MAX_LIMIT);
    const text = args.text?.trim();
    const batch = args.batch;
    const department = args.department?.trim();
    const region = args.region?.trim();
    const company = args.company?.trim();

    const keep = (row: Doc<"alumni">) => {
      if (batch !== undefined && row.batch !== batch) return false;
      if (department && row.department !== department) return false;
      if (region && (row.region !== region || !shares(row, "region"))) return false;
      if (company && (row.company !== company || !shares(row, "company"))) {
        return false;
      }
      return true;
    };

    if (text) {
      // Every narrowing is a declared filter field, so the index does the work
      // and only the visibility rule is left to apply while streaming.
      const found = await takeMatching(
        ctx.db.query("alumni").withSearchIndex("search_alumni", (q) => {
          let search = q.search("name", text);
          if (batch !== undefined) search = search.eq("batch", batch);
          if (department) search = search.eq("department", department);
          if (region) search = search.eq("region", region);
          if (company) search = search.eq("company", company);
          return search;
        }),
        keep,
        limit,
      );
      // Relevance ordering belongs to the index; leave it as it arrives.
      return found.map(publicView);
    }

    // No name query: walk the most selective index available. With no cohort or
    // department chosen, `by_batch` descending means the page limit keeps the
    // newest cohorts, which is the order the list is displayed in anyway.
    const source =
      batch !== undefined
        ? ctx.db.query("alumni").withIndex("by_batch", (q) => q.eq("batch", batch))
        : department
          ? ctx.db
              .query("alumni")
              .withIndex("by_department", (q) => q.eq("department", department))
          : ctx.db.query("alumni").withIndex("by_batch").order("desc");

    const found = await takeMatching(source, keep, limit);
    found.sort((a, b) => b.batch - a.batch || a.name.localeCompare(b.name));
    return found.map(publicView);
  },
});

/**
 * The employers behind the company filter, largest first.
 *
 * Building the option list from the table is what makes the filter honest: a
 * member can only pick a company that someone actually works at, so the filter
 * never needs a "no such company" state. Members who hid their company are left
 * out, which keeps these counts equal to what the filter will return.
 */
export const companyCounts = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("alumni").collect();
    const counts = new Map<string, number>();
    for (const alumnus of all) {
      if (!shares(alumnus, "company")) continue;
      const name = alumnus.company.trim();
      if (name.length === 0) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
  },
});
