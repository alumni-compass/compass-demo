import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";

/**
 * Module 9 — Entrepreneur Zone: the "Profile Viewing & Contacting" half of the
 * brief.
 *
 * `race.ts` covers the feed (list, facets, stats, submit). It has no single-row
 * read, so /race/[id] would otherwise have to pull the whole approved list into
 * the browser and find its row there. These queries add the reads that a real
 * profile page needs, and they add them with the approval gate applied on the
 * server rather than in the component:
 *
 *   byId          — one venture, and only if it has been approved.
 *   related       — other approved ventures in the same category, for discovery.
 *   helpDirectory — offersHelp inverted into topic → founders, server-side.
 *   openAsks      — lookingFor inverted into topic → who is asking.
 *
 * The last two exist so the supportive-community board does not need a
 * subscription to every venture document just to invert two string arrays.
 */

/** Ceiling on rows returned by the discovery rail. */
const RELATED_LIMIT = 6;

/**
 * A venture id arriving from a URL segment is untrusted text, so it is accepted
 * as a string and normalised here. `v.id("ventures")` would reject a malformed
 * segment with an argument-validation error — which reaches the browser as a
 * thrown exception rather than as a "no such profile" page — and it would still
 * not prove the row exists. `normalizeId` returns null for anything that is not
 * a well-formed id for this table, which is the same shape as "not found".
 */
function ventureIdOrNull(ctx: QueryCtx, raw: string): Id<"ventures"> | null {
  return ctx.db.normalizeId("ventures", raw.trim());
}

/** Approved rows only. Every read below starts here. */
async function approvedVentures(ctx: QueryCtx) {
  return ctx.db
    .query("ventures")
    .withIndex("by_approved", (q) => q.eq("approved", true))
    .collect();
}

/** The subset of a venture the community boards need to link and write to it. */
function founderSummary(row: Doc<"ventures">) {
  return {
    ventureId: row._id,
    founderName: row.founderName,
    founderEmail: row.founderEmail,
    founderBatch: row.founderBatch ?? null,
    businessName: row.businessName,
    category: row.category,
    location: row.location,
    stage: row.stage,
  };
}

/**
 * Deduplicates a founder's own topic list: whitespace-normalised, case-folded
 * for the key, first spelling kept for display.
 */
function topicKey(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * One venture, for the full profile page.
 *
 * Returns null unless `approved` is true. An unapproved submission is therefore
 * unreachable by URL even by someone who knows its id — the moderation gate in
 * `race.submitVenture` would be decorative otherwise, since a submitter learns
 * their own row id the moment the mutation resolves.
 *
 * null is used for every negative case — bad id, deleted row, unapproved row —
 * so the page cannot tell them apart and neither can a caller probing ids.
 */
export const byId = query({
  args: { ventureId: v.string() },
  handler: async (ctx, args) => {
    const id = ventureIdOrNull(ctx, args.ventureId);
    if (!id) return null;
    const row = await ctx.db.get(id);
    if (!row || !row.approved) return null;
    return row;
  },
});

/**
 * Other approved ventures in the same category — the brief's "explore peers",
 * carried onto the profile page so a visitor who arrived from a search has
 * somewhere to go next.
 *
 * Established businesses come first: an upcoming founder reading a peer's idea
 * is better served by the traders in that category than by more ideas.
 */
export const related = query({
  args: { ventureId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const id = ventureIdOrNull(ctx, args.ventureId);
    if (!id) return [];
    const self = await ctx.db.get(id);
    if (!self || !self.approved) return [];

    const rows = await ctx.db
      .query("ventures")
      .withIndex("by_category", (q) => q.eq("category", self.category))
      .collect();

    const cap = Math.max(1, Math.min(args.limit ?? RELATED_LIMIT, 24));

    return rows
      .filter((row) => row.approved && row._id !== self._id)
      .sort((a, b) => {
        if (a.stage !== b.stage) return a.stage === "established" ? -1 : 1;
        return b.createdAt - a.createdAt;
      })
      .slice(0, cap)
      .map((row) => ({
        ...founderSummary(row),
        description: row.description,
        website: row.website ?? null,
        offersHelp: row.offersHelp,
      }));
  },
});

/**
 * The supportive-community board: every distinct thing an approved founder has
 * offered to help with, mapped to the founders offering it.
 *
 * Inverted on the server so the page subscribes to one small derived list
 * instead of to every venture document. Ordered by how many founders can cover
 * a topic, so the deepest bench reads first.
 */
export const helpDirectory = query({
  args: {},
  handler: async (ctx) => {
    const rows = await approvedVentures(ctx);
    const topics = new Map<
      string,
      { topic: string; founders: ReturnType<typeof founderSummary>[] }
    >();

    for (const row of rows) {
      const seenHere = new Set<string>();
      for (const raw of row.offersHelp) {
        const topic = topicKey(raw);
        if (!topic) continue;
        const key = topic.toLowerCase();
        if (seenHere.has(key)) continue;
        seenHere.add(key);

        const entry = topics.get(key);
        if (entry) entry.founders.push(founderSummary(row));
        else topics.set(key, { topic, founders: [founderSummary(row)] });
      }
    }

    return [...topics.values()].sort(
      (a, b) =>
        b.founders.length - a.founders.length || a.topic.localeCompare(b.topic),
    );
  },
});

/**
 * The mirror image of `helpDirectory`: what the community is currently asking
 * for, and who is asking. Feeds the open-asks strip under the help board.
 */
export const openAsks = query({
  args: {},
  handler: async (ctx) => {
    const rows = await approvedVentures(ctx);
    const asks = new Map<
      string,
      { topic: string; askers: ReturnType<typeof founderSummary>[] }
    >();

    for (const row of rows) {
      const seenHere = new Set<string>();
      for (const raw of row.lookingFor) {
        const topic = topicKey(raw);
        if (!topic) continue;
        const key = topic.toLowerCase();
        if (seenHere.has(key)) continue;
        seenHere.add(key);

        const entry = asks.get(key);
        if (entry) entry.askers.push(founderSummary(row));
        else asks.set(key, { topic, askers: [founderSummary(row)] });
      }
    }

    return [...asks.values()]
      .map((entry) => ({ ...entry, count: entry.askers.length }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  },
});
