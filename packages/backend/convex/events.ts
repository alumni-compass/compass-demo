import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

/** Module 7 — event listings, split around "now" so the UI never has to guess. */
export const list = query({
  args: { window: v.optional(v.union(v.literal("upcoming"), v.literal("past"))) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const all = await ctx.db
      .query("events")
      .withIndex("by_start")
      .order("asc")
      .collect();
    const published = all.filter((e) => e.published);

    const rows =
      args.window === "past"
        ? published.filter((e) => e.startsAt < now).reverse()
        : args.window === "upcoming"
          ? published.filter((e) => e.startsAt >= now)
          : published;

    // RSVP counts are read per event so the card can show remaining seats.
    return Promise.all(
      rows.map(async (e) => {
        const rsvps = await ctx.db
          .query("eventRsvps")
          .withIndex("by_event", (q) => q.eq("eventId", e._id))
          .collect();
        const going = rsvps.filter((r) => r.status === "going");
        const attending = going.reduce((sum, r) => sum + 1 + r.guests, 0);
        return {
          ...e,
          attending,
          seatsLeft: e.capacity ? Math.max(0, e.capacity - attending) : null,
        };
      }),
    );
  },
});

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique(),
});

/**
 * RSVP is idempotent per email so a member changing their mind updates their
 * existing response instead of inflating the headcount.
 */
export const rsvp = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    email: v.string(),
    batch: v.optional(v.number()),
    guests: v.optional(v.number()),
    status: v.union(v.literal("going"), v.literal("maybe"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("That event no longer exists.");

    /*
     * `guests` is a raw number from the caller, so it needs bounding here and
     * not only in the form. Unchecked, one RSVP with `guests: 600` consumed the
     * whole capacity of an event, and a negative value corrupted every headcount
     * that sums `1 + guests`.
     */
    const guestCount = args.guests ?? 0;
    if (!Number.isInteger(guestCount) || guestCount < 0 || guestCount > 6) {
      throw new Error("Bring between 0 and 6 guests.");
    }

    const existing = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event_email", (q) =>
        q.eq("eventId", args.eventId).eq("email", args.email),
      )
      .unique();

    const guests = args.guests ?? 0;

    if (existing) {
      await ctx.db.patch(existing._id, { status: args.status, guests });
      return existing._id;
    }

    if (event.capacity && args.status === "going") {
      const rsvps = await ctx.db
        .query("eventRsvps")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .collect();
      const attending = rsvps
        .filter((r) => r.status === "going")
        .reduce((sum, r) => sum + 1 + r.guests, 0);
      if (attending + 1 + guests > event.capacity) {
        throw new Error("This event is full. Join the waitlist by emailing RITAA.");
      }
    }

    return ctx.db.insert("eventRsvps", {
      eventId: args.eventId,
      name: args.name,
      email: args.email,
      batch: args.batch,
      guests,
      status: args.status,
      createdAt: Date.now(),
    });
  },
});
