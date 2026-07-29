import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { DatabaseReader } from "./_generated/server";
import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Module 7 — registration desk for events.
 *
 * `events.ts` owns listings and the RSVP write. This file owns everything the
 * organising committee and the members need *around* that write: the register of
 * who is coming, a member's own response, headcount arithmetic, and the
 * automated reminder.
 *
 * PRIVACY — the register is a public page. Email addresses are collected by the
 * RSVP form but are never returned by `attendeesFor`; a visitor only learns that
 * an attendee left a contact address (`hasEmail`), never what it is. `myRsvp`
 * answers only for an address the caller already typed in, and echoes no other
 * member's data.
 */

/** Reminders go out a day ahead — long enough to arrange travel. */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * `_scheduled_functions` rows are named `<module>.js:<function>`. Matching on the
 * suffix keeps the lookup working regardless of how the module path is spelled.
 */
const REMINDER_FN_SUFFIX = ":sendReminder";

/**
 * The scheduled-function system table carries no user-defined indexes, so
 * finding a queued reminder is a scan. It is bounded to the most recently
 * created jobs rather than reading an unbounded table: a reminder is always
 * queued at the moment someone RSVPs, so the row being looked for is recent.
 */
const REMINDER_SCAN_LIMIT = 500;

/**
 * ABUSE GUARD — `scheduleReminder` is public, because the browser calls it right
 * after `events.rsvp`. For an event inside the lead window the reminder is due
 * immediately, so without a throttle anyone who knows a registered address could
 * call this in a loop and turn it into a mail amplifier aimed at that address.
 *
 * One reminder per registration per hour caps that at a rate a real member would
 * never notice, and the pending-job check below makes the normal case a no-op.
 */
const REMINDER_THROTTLE_MS = 60 * 60 * 1000;

const STATUS_ORDER = { going: 0, maybe: 1, cancelled: 2 } as const;

/** Email delivery is configured on the deployment, not in code. */
function mailerConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

/** RSVPs are keyed by (event, email) in `events.rsvp`; read them back the same way. */
async function rsvpFor(db: DatabaseReader, eventId: Id<"events">, email: string) {
  return db
    .query("eventRsvps")
    .withIndex("by_event_email", (q) => q.eq("eventId", eventId).eq("email", email))
    .unique();
}

/** Every reminder job ever queued for one RSVP, newest first, in any state. */
async function remindersFor(db: DatabaseReader, rsvpId: Id<"eventRsvps">) {
  const jobs = await db.system
    .query("_scheduled_functions")
    .order("desc")
    .take(REMINDER_SCAN_LIMIT);

  return jobs.filter((job) => {
    if (!job.name.endsWith(REMINDER_FN_SUFFIX)) return false;
    const args = job.args[0] as { rsvpId?: string } | undefined;
    return args?.rsvpId === rsvpId;
  });
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/**
 * Who is coming to one event.
 *
 * Ordered going → maybe → cancelled, then by the order people registered, so the
 * list reads like a sign-in sheet. Deliberately returns no email addresses.
 */
export const attendeesFor = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    return rows
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt - b.createdAt,
      )
      .map((r) => ({
        id: r._id,
        name: r.name,
        batch: r.batch ?? null,
        status: r.status,
        guests: r.guests,
        createdAt: r.createdAt,
        /** Whether the committee can reach this attendee — not the address itself. */
        hasEmail: r.email.trim() !== "",
      }));
  },
});

/**
 * One member's own response, so the form can prefill and say "you are going"
 * instead of asking a second time. Answers only for the address supplied.
 */
export const myRsvp = query({
  args: { eventId: v.id("events"), email: v.string() },
  handler: async (ctx, args) => {
    const email = normaliseEmail(args.email);
    if (email === "") return null;

    const row = await rsvpFor(ctx.db, args.eventId, email);
    if (!row) return null;

    const jobs = await remindersFor(ctx.db, row._id);
    const reminder = jobs.find((job) => job.state.kind === "pending");

    return {
      name: row.name,
      batch: row.batch ?? null,
      guests: row.guests,
      status: row.status,
      createdAt: row.createdAt,
      /** Null when nothing is queued — an RSVP filed before reminders existed. */
      reminder: reminder ? { scheduledFor: reminder.scheduledTime } : null,
      /** False means a queued reminder will not leave the building yet. */
      mailerConfigured: mailerConfigured(),
    };
  },
});

/** Response counts and the real headcount, guests included. */
export const rsvpSummary = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    const rows = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const going = rows.filter((r) => r.status === "going");
    const maybe = rows.filter((r) => r.status === "maybe");
    const cancelled = rows.filter((r) => r.status === "cancelled");

    const guests = going.reduce((sum, r) => sum + r.guests, 0);
    const headcount = going.length + guests;
    const maybeHeadcount = maybe.reduce((sum, r) => sum + 1 + r.guests, 0);
    const capacity = event?.capacity ?? null;

    return {
      responses: rows.length,
      going: going.length,
      maybe: maybe.length,
      cancelled: cancelled.length,
      /** Extra seats booked by members bringing family. */
      guests,
      /** Confirmed seats: everyone going, plus their guests. */
      headcount,
      /** Ceiling if every maybe turns up — what catering should be told. */
      headcountIfMaybes: headcount + maybeHeadcount,
      capacity,
      seatsLeft: capacity === null ? null : Math.max(0, capacity - headcount),
    };
  },
});

// ---------------------------------------------------------------------------
// Automated reminders
// ---------------------------------------------------------------------------

/**
 * Queues the reminder for one RSVP. Called straight after `events.rsvp`.
 *
 * Idempotent: a registration that already has a reminder waiting keeps it rather
 * than booking a second one. That is safe because `sendReminder` re-reads the
 * RSVP when it runs, so a member who changed their response — or withdrew it —
 * still gets an email that describes the response they actually hold, or none.
 *
 * The scheduling itself is real and durable — Convex holds the job and runs it —
 * but delivery is a separate question, answered by `mailerConfigured`.
 */
export const scheduleReminder = mutation({
  args: { eventId: v.id("events"), email: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("That event no longer exists.");

    const email = normaliseEmail(args.email);
    const rsvp = await rsvpFor(ctx.db, args.eventId, email);
    if (!rsvp) {
      throw new Error("No RSVP is on file for that email address yet.");
    }

    const deliverable = mailerConfigured();
    const now = Date.now();
    const jobs = await remindersFor(ctx.db, rsvp._id);
    const pending = jobs.filter((job) => job.state.kind === "pending");

    if (rsvp.status === "cancelled") {
      // Withdrawn: drop the queued reminder rather than leaving a job to wake up
      // and decide it has nothing to do.
      for (const job of pending) await ctx.scheduler.cancel(job._id);
      return {
        queued: false,
        scheduledFor: null,
        deliverable,
        reason: "Your response is cancelled, so no reminder is queued.",
      };
    }

    if (event.startsAt <= now) {
      return {
        queued: false,
        scheduledFor: null,
        deliverable,
        reason: "This event has already started, so there is no reminder to send.",
      };
    }

    // Already waiting: leave it alone. This is the normal path for anyone who
    // submits the form more than once, and it is what keeps a repeat caller from
    // stacking up jobs.
    const waiting = pending[0];
    if (waiting) {
      return {
        queued: true,
        scheduledFor: waiting.scheduledTime,
        deliverable,
        reason: deliverable
          ? "A reminder email is already queued for this registration."
          : "A reminder is already queued on the server. It will only be emailed once RESEND_API_KEY is set on the Convex deployment.",
      };
    }

    // Nothing waiting, but one ran recently — an event inside the lead window
    // sends immediately, so this is the case a caller could otherwise repeat.
    const recent = jobs.find((job) => now - job._creationTime < REMINDER_THROTTLE_MS);
    if (recent) {
      return {
        queued: false,
        scheduledFor: null,
        deliverable,
        // Deliberately says "queued", not "sent" — the recent job may have run,
        // been cancelled, or failed, and this must not assert a delivery.
        reason:
          "A reminder for this registration was already queued within the last hour. Your response is saved; check that inbox before asking for another.",
      };
    }

    // An event less than a day away gets its reminder immediately.
    const runAt = Math.max(event.startsAt - REMINDER_LEAD_MS, now);
    await ctx.scheduler.runAt(runAt, internal.eventAdmin.sendReminder, {
      rsvpId: rsvp._id,
    });

    return {
      queued: true,
      scheduledFor: runAt,
      deliverable,
      reason: deliverable
        ? "A reminder email is queued and will send automatically."
        : "A reminder is queued on the server. It will only be emailed once RESEND_API_KEY is set on the Convex deployment.",
    };
  },
});

/** Everything `sendReminder` needs, read in one transaction at send time. */
export const _reminderPayload = internalQuery({
  args: { rsvpId: v.id("eventRsvps") },
  handler: async (ctx, args) => {
    const rsvp = await ctx.db.get(args.rsvpId);
    if (!rsvp) return null;
    const event = await ctx.db.get(rsvp.eventId);
    if (!event) return null;

    return {
      name: rsvp.name,
      email: rsvp.email,
      guests: rsvp.guests,
      status: rsvp.status,
      title: event.title,
      slug: event.slug,
      startsAt: event.startsAt,
      venue: event.venue,
      mode: event.mode,
      ticketPriceInr: event.ticketPriceInr,
    };
  },
});

/**
 * Sends the reminder. Runs from the scheduler, never from a browser.
 *
 * Delivery goes through Resend, the same provider access.ts uses for OTP codes:
 *   npx convex env set RESEND_API_KEY re_xxx
 *   npx convex env set EVENT_FROM_EMAIL "RITAA <alumni@ritrjpm.ac.in>"
 * With no key this throws instead of returning quietly, so the job is recorded
 * as failed with the reason on the Convex dashboard. A reminder nobody receives
 * must not look like a reminder that was sent.
 */
export const sendReminder = internalAction({
  args: { rsvpId: v.id("eventRsvps") },
  handler: async (ctx, args): Promise<{ sent: boolean; reason: string }> => {
    const rsvp = await ctx.runQuery(internal.eventAdmin._reminderPayload, {
      rsvpId: args.rsvpId,
    });

    // The RSVP or the event may have gone since the job was queued.
    if (!rsvp) return { sent: false, reason: "The RSVP no longer exists." };
    if (rsvp.status === "cancelled") {
      return { sent: false, reason: "The member cancelled their RSVP." };
    }
    if (rsvp.startsAt < Date.now()) {
      return { sent: false, reason: "The event has already started." };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        `Email delivery is not configured, so the reminder for "${rsvp.title}" could not be sent to ${rsvp.email}. Set RESEND_API_KEY on the Convex deployment and re-queue it.`,
      );
    }

    const when = new Date(rsvp.startsAt).toLocaleString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });

    const from =
      process.env.EVENT_FROM_EMAIL ??
      process.env.OTP_FROM_EMAIL ??
      "RITAA <onboarding@resend.dev>";

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [rsvp.email],
        subject: `Tomorrow: ${rsvp.title}`,
        text: [
          `Hello ${rsvp.name},`,
          "",
          `This is your reminder for ${rsvp.title}.`,
          "",
          `When:  ${when} IST`,
          `Where: ${rsvp.venue} (${rsvp.mode})`,
          `Your response: ${rsvp.status}${
            rsvp.guests > 0
              ? ` with ${rsvp.guests} guest${rsvp.guests === 1 ? "" : "s"}`
              : ""
          }`,
          rsvp.ticketPriceInr > 0
            ? `Entry:  Rs ${rsvp.ticketPriceInr.toLocaleString("en-IN")} per head, collected at the registration desk.`
            : "Entry:  Free.",
          "",
          "Cannot make it after all? Update your RSVP with the same email address and the register corrects itself.",
          "",
          "Ramco Institute of Technology Alumni Association",
        ].join("\n"),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `The reminder for "${rsvp.title}" could not be emailed (${response.status}). ${detail.slice(0, 180)}`,
      );
    }

    return { sent: true, reason: `Reminder emailed for ${rsvp.title}.` };
  },
});
