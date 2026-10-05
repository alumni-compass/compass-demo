import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";

/**
 * Module 8 — transparent reporting.
 *
 * `giving.ts` answers "what are we raising and who gave last?". This module
 * answers the questions people actually ask afterwards: where did it go, how
 * much has my batch given, and is the money still coming in. It is read-only by
 * construction — every export here is a `query`, there is no mutation, and
 * nothing in this file touches the donations ledger. The ledger write lives in
 * `giving.recordDonation` and belongs to a verified payment-gateway webhook.
 *
 * ANONYMITY IS ENFORCED IN ONE PLACE. Every donation row leaves this module
 * through `publicGift()`, which substitutes the same "Anonymous donor" label
 * `giving.donorWall` uses and drops the batch. Batch-level reporting is the
 * dangerous case: bucketing an anonymous gift under its real cohort would
 * re-identify the donor the moment that cohort has only one gift, so anonymous
 * gifts are counted in a separate withheld bucket instead. Amount, date and
 * payment rail are published for anonymous gifts — those are already on the
 * donor wall — but the name and the batch never leave the database.
 */

/**
 * Convex functions run in UTC. An Indian association reads its months in IST,
 * and a gift made at 11pm on the 31st belongs to that month, not the next one,
 * so timeline buckets are cut on the IST calendar.
 */
const IST_OFFSET_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Longest timeline a caller may ask for — three years of monthly buckets. */
const MAX_TIMELINE_MONTHS = 36;
const DEFAULT_TIMELINE_MONTHS = 12;

/** The label used for gifts whose donor asked not to be named. */
const ANONYMOUS_LABEL = "Anonymous donor";

/** The bucket anonymous gifts are counted under, so no cohort can be inferred. */
const WITHHELD_LABEL = "Batch withheld";

/**
 * The single redaction point for this module.
 *
 * An anonymous gift keeps its amount, date and payment rail — all three are
 * already public on the donor wall — and loses its name and its batch.
 */
function publicGift(d: Doc<"donations">) {
  return {
    _id: d._id,
    anonymous: d.anonymous,
    donorName: d.anonymous ? ANONYMOUS_LABEL : d.donorName,
    batch: d.anonymous ? null : (d.batch ?? null),
    amountInr: d.amountInr,
    method: d.method,
    message: d.message ?? null,
    createdAt: d.createdAt,
  };
}

function sum(values: readonly number[]) {
  return values.reduce((s, n) => s + n, 0);
}

/** Ratio guarded against a zero denominator — never NaN, never Infinity. */
function ratio(part: number, whole: number) {
  return whole > 0 ? part / whole : 0;
}

/** IST calendar year and month index for an epoch timestamp. */
function istMonth(ts: number) {
  const shifted = new Date(ts + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month] ?? "?"} ${year}`;
}

/* ------------------------------------------------------------------ */
/* Fund-wide statement: raised against goal, spent against raised      */
/* ------------------------------------------------------------------ */

/**
 * The whole fund on one screen.
 *
 * Two different denominators matter and are kept apart deliberately:
 * `goalProgress` is raised against goal (how the appeal is going) and
 * `allocationShare` is allocated against raised (how much has actually been
 * spent). Both are guarded, so an unfunded campaign contributes zero rather
 * than a division by zero.
 *
 * `itemisedInr` is the sum of the donation rows — the gifts listed one by one on
 * the wall. `reportedRaisedInr` is the treasurer's figure on the campaign rows,
 * which also covers gifts received in bulk and never itemised. The difference is
 * returned as `aggregateInr` rather than hidden, because a reader who adds up the
 * donor wall and gets a smaller number deserves an explanation instead of a
 * discrepancy.
 */
export const fundUsageSummary = query({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query("campaigns").collect();
    const donations = await ctx.db.query("donations").collect();

    const reportedRaisedInr = sum(campaigns.map((c) => c.raisedInr));
    const goalInr = sum(campaigns.map((c) => c.goalInr));
    const allocatedInr = sum(
      campaigns.map((c) => sum(c.allocations.map((a) => a.amountInr))),
    );
    const itemisedInr = sum(donations.map((d) => d.amountInr));

    // Campaigns whose published spending exceeds what they took in. Named, not
    // just counted, so the page can point at them instead of raising a vague
    // alarm.
    const overAllocated = campaigns
      .map((c) => ({
        title: c.title,
        slug: c.slug,
        raisedInr: c.raisedInr,
        allocatedInr: sum(c.allocations.map((a) => a.amountInr)),
      }))
      .filter((c) => c.allocatedInr > c.raisedInr)
      .map((c) => ({ ...c, overByInr: c.allocatedInr - c.raisedInr }))
      .sort((a, b) => b.overByInr - a.overByInr);

    return {
      campaignCount: campaigns.length,
      activeCampaignCount: campaigns.filter((c) => c.active).length,
      batchCampaignCount: campaigns.filter((c) => c.batch !== undefined).length,
      goalInr,
      reportedRaisedInr,
      allocatedInr,
      /** Raised but not yet spent. Negative is impossible — see overAllocated. */
      unallocatedInr: Math.max(0, reportedRaisedInr - allocatedInr),
      goalProgress: ratio(reportedRaisedInr, goalInr),
      allocationShare: ratio(allocatedInr, reportedRaisedInr),
      itemisedInr,
      itemisedGiftCount: donations.length,
      /** Raised but not listed gift by gift — bulk and offline giving. */
      aggregateInr: Math.max(0, reportedRaisedInr - itemisedInr),
      overAllocated,
      allocationLineCount: sum(campaigns.map((c) => c.allocations.length)),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Giving by batch — the number batch representatives ask for          */
/* ------------------------------------------------------------------ */

/**
 * Total given and donor count per graduating batch.
 *
 * Anonymous gifts are counted under a single withheld bucket rather than under
 * the donor's real cohort. That is not tidiness: a batch with one gift, given
 * anonymously, would otherwise publish that donor's cohort and amount side by
 * side, which is exactly the thing they asked us not to do.
 *
 * `donorCount` de-duplicates by name within a batch, so two gifts from the same
 * alumnus count as one donor. Withheld gifts cannot be de-duplicated without
 * reading the name they asked us to withhold, so each is counted separately and
 * `donorCount` equals `giftCount` for that row.
 */
export const givingByBatch = query({
  args: {},
  handler: async (ctx) => {
    const donations = await ctx.db.query("donations").collect();

    const named = new Map<
      number,
      { totalInr: number; giftCount: number; donors: Set<string> }
    >();
    /** Gifts with no batch on record, but a donor who was happy to be named. */
    let unstatedInr = 0;
    let unstatedGifts = 0;
    const unstatedDonors = new Set<string>();
    let withheldInr = 0;
    let withheldGifts = 0;

    for (const d of donations) {
      if (d.anonymous) {
        withheldInr += d.amountInr;
        withheldGifts += 1;
        continue;
      }
      if (d.batch === undefined) {
        unstatedInr += d.amountInr;
        unstatedGifts += 1;
        unstatedDonors.add(d.donorName.trim().toLowerCase());
        continue;
      }
      const row = named.get(d.batch) ?? {
        totalInr: 0,
        giftCount: 0,
        donors: new Set<string>(),
      };
      row.totalInr += d.amountInr;
      row.giftCount += 1;
      row.donors.add(d.donorName.trim().toLowerCase());
      named.set(d.batch, row);
    }

    const totalInr = sum(donations.map((d) => d.amountInr));
    const peakInr = Math.max(
      0,
      ...[...named.values()].map((r) => r.totalInr),
      unstatedInr,
      withheldInr,
    );

    const batchRows = [...named.entries()]
      .map(([batch, row]) => ({
        key: String(batch),
        batch,
        label: `${batch} batch`,
        totalInr: row.totalInr,
        giftCount: row.giftCount,
        donorCount: row.donors.size,
        share: ratio(row.totalInr, totalInr),
        /** Bar length relative to the leading row, so the table can draw itself. */
        peakShare: ratio(row.totalInr, peakInr),
      }))
      .sort((a, b) => b.totalInr - a.totalInr || b.batch - a.batch);

    // Both catch-all rows sit at the bottom whatever they total: a reader
    // scanning cohorts should not trip over them mid-table.
    const tailRows = [
      unstatedGifts > 0
        ? {
            key: "unstated",
            batch: null,
            label: "Batch not stated",
            totalInr: unstatedInr,
            giftCount: unstatedGifts,
            donorCount: unstatedDonors.size,
            share: ratio(unstatedInr, totalInr),
            peakShare: ratio(unstatedInr, peakInr),
          }
        : null,
      withheldGifts > 0
        ? {
            key: "withheld",
            batch: null,
            label: WITHHELD_LABEL,
            totalInr: withheldInr,
            giftCount: withheldGifts,
            donorCount: withheldGifts,
            share: ratio(withheldInr, totalInr),
            peakShare: ratio(withheldInr, peakInr),
          }
        : null,
    ].filter((r) => r !== null);

    return {
      rows: [...batchRows, ...tailRows],
      totalInr,
      giftCount: donations.length,
      batchesRepresented: named.size,
      withheldInr,
      withheldGiftCount: withheldGifts,
      leadingBatch: batchRows[0]?.batch ?? null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Timeline — momentum, month by month                                 */
/* ------------------------------------------------------------------ */

/**
 * Donations aggregated into contiguous monthly buckets ending with the current
 * IST month, so a page can draw momentum from plain divs without a charting
 * dependency.
 *
 * Empty months are returned as zero-value buckets on purpose: a gap in giving is
 * information, and dropping the month would make the axis lie about the spacing.
 * `share` is measured against the peak month so bar heights need no further
 * arithmetic on the client. Gifts older than the window are reported separately
 * rather than silently dropped.
 */
export const givingTimeline = query({
  args: { months: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const asked = Math.trunc(args.months ?? DEFAULT_TIMELINE_MONTHS);
    const requested = Number.isFinite(asked) ? asked : DEFAULT_TIMELINE_MONTHS;
    const windowMonths = Math.max(1, Math.min(MAX_TIMELINE_MONTHS, requested));

    const donations = await ctx.db.query("donations").collect();

    const buckets = new Map<string, { totalInr: number; giftCount: number }>();
    const now = istMonth(Date.now());
    // Absolute month index makes "the last N months" a subtraction rather than
    // a calendar-rollover puzzle.
    const latestIndex = now.year * 12 + now.month;
    const earliestIndex = latestIndex - (windowMonths - 1);

    let beforeWindowInr = 0;
    let beforeWindowCount = 0;

    for (const d of donations) {
      const { year, month } = istMonth(d.createdAt);
      const index = year * 12 + month;
      if (index < earliestIndex) {
        beforeWindowInr += d.amountInr;
        beforeWindowCount += 1;
        continue;
      }
      // A gift dated in the future is not evidence of anything; fold it into the
      // current month rather than stretching the axis past today.
      const key =
        index > latestIndex
          ? monthKey(now.year, now.month)
          : monthKey(year, month);
      const bucket = buckets.get(key) ?? { totalInr: 0, giftCount: 0 };
      bucket.totalInr += d.amountInr;
      bucket.giftCount += 1;
      buckets.set(key, bucket);
    }

    const series = Array.from({ length: windowMonths }, (_, i) => {
      const index = earliestIndex + i;
      const year = Math.floor(index / 12);
      const month = index % 12;
      const key = monthKey(year, month);
      const bucket = buckets.get(key) ?? { totalInr: 0, giftCount: 0 };
      return {
        key,
        year,
        label: monthLabel(year, month),
        shortLabel: MONTH_NAMES[month] ?? "?",
        totalInr: bucket.totalInr,
        giftCount: bucket.giftCount,
      };
    });

    const peakInr = Math.max(0, ...series.map((m) => m.totalInr));
    const peak = series.find((m) => m.totalInr === peakInr && m.totalInr > 0);
    const timestamps = donations.map((d) => d.createdAt);

    return {
      windowMonths,
      months: series.map((m) => ({ ...m, share: ratio(m.totalInr, peakInr) })),
      totalInr: sum(series.map((m) => m.totalInr)),
      giftCount: sum(series.map((m) => m.giftCount)),
      peakInr,
      peakLabel: peak?.label ?? null,
      activeMonths: series.filter((m) => m.giftCount > 0).length,
      beforeWindowInr,
      beforeWindowCount,
      firstGiftAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
      lastGiftAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Per-campaign ledger — the full transparency record for one campaign */
/* ------------------------------------------------------------------ */

/**
 * Everything published about one campaign: the row itself, the gifts on its
 * ledger with anonymity applied, the allocation breakdown with shares, allocated
 * against raised, and the unallocated balance.
 *
 * Returns `null` for an unknown slug so a caller can tell "no such campaign"
 * apart from "still loading" — `undefined` from a Convex query already means the
 * latter.
 *
 * Every share is computed against `Math.max(raised, allocated, 1)`, so an
 * unfunded campaign cannot divide by zero and an over-committed one cannot draw
 * a bar past the end of its track. Over-allocation is reported as a signed fact
 * (`overAllocatedInr`) for the caller to warn about, not clamped away.
 */
export const campaignLedger = query({
  args: { slug: v.string(), giftLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const campaign = await ctx.db
      .query("campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!campaign) return null;

    const rows = await ctx.db
      .query("donations")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();

    const allocatedInr = sum(campaign.allocations.map((a) => a.amountInr));
    const raisedInr = campaign.raisedInr;
    const scale = Math.max(raisedInr, allocatedInr, 1);

    const allocations = campaign.allocations.map((line) => ({
      label: line.label,
      amountInr: line.amountInr,
      /** Share of the larger of raised/allocated — never exceeds 1. */
      share: ratio(line.amountInr, scale),
      /** Share of published spending, which is what a line item is really of. */
      shareOfSpend: ratio(line.amountInr, allocatedInr),
    }));

    const itemisedInr = sum(rows.map((d) => d.amountInr));
    const methodTotals = new Map<string, { giftCount: number; amountInr: number }>();
    for (const d of rows) {
      const entry = methodTotals.get(d.method) ?? { giftCount: 0, amountInr: 0 };
      entry.giftCount += 1;
      entry.amountInr += d.amountInr;
      methodTotals.set(d.method, entry);
    }

    const ordered = [...rows].sort((a, b) => b.createdAt - a.createdAt);
    const limit = Math.trunc(args.giftLimit ?? 0);
    const visible = limit > 0 ? ordered.slice(0, limit) : ordered;

    return {
      campaign: {
        _id: campaign._id,
        title: campaign.title,
        slug: campaign.slug,
        cause: campaign.cause,
        batch: campaign.batch ?? null,
        summary: campaign.summary,
        goalInr: campaign.goalInr,
        raisedInr,
        donorCount: campaign.donorCount,
        active: campaign.active,
        closesAt: campaign.closesAt ?? null,
      },
      /** Raised against goal, guarded and clamped, as `listCampaigns` does. */
      progress: Math.min(1, ratio(raisedInr, campaign.goalInr)),
      allocatedInr,
      /** Spent against raised. Zero when nothing has been raised yet. */
      allocationShare: ratio(allocatedInr, raisedInr),
      /** Raised and not yet committed. Zero rather than negative. */
      unallocatedInr: Math.max(0, raisedInr - allocatedInr),
      /** Committed beyond what arrived. Zero unless the campaign is over-spent. */
      overAllocatedInr: Math.max(0, allocatedInr - raisedInr),
      allocations,
      gifts: visible.map(publicGift),
      itemisedInr,
      itemisedGiftCount: rows.length,
      /** Counted toward the total but not listed gift by gift. */
      aggregateInr: Math.max(0, raisedInr - itemisedInr),
      anonymousGiftCount: rows.filter((d) => d.anonymous).length,
      /** Which rails gifts actually arrived on. No identity attached. */
      methodMix: [...methodTotals.entries()]
        .map(([method, entry]) => ({ method, ...entry }))
        .sort((a, b) => b.amountInr - a.amountInr),
    };
  },
});
