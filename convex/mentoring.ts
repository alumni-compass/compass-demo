import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireEmail } from "./authz";

/**
 * Module 5 — Mentorship Network: the booking lifecycle.
 *
 * `careers.requestMentorship` writes the booking; everything that happens to it
 * afterwards lives here. The brief asks for "booking system with feedback and
 * follow-up tracking", which means a request has to be readable by both sides,
 * movable through a status, and closable with a rating — not just insertable.
 *
 * A mentorship request is sensitive. It carries a help-seeking message written by
 * a named person, whether they are a current student, the address they read, and
 * afterwards their opinion of a named alumnus. So every function here answers two
 * questions, and a correct answer to the first is worthless without the second:
 *
 *   1. Is this move legal for the request?  → the ALLOWED table below.
 *   2. Is this caller a party to it?        → requireEmail plus the ownership
 *                                             helpers below.
 *
 * Identity is always DERIVED from the verified session token via
 * `authz.requireEmail`. No handler accepts an email, a name or a role as an
 * argument and believes it. Where a caller does pass an id — `mentorId`,
 * `requestId` — the row it points at is loaded and that row's own stored email is
 * compared against the session, so an argument selects a record but never
 * establishes who is asking.
 *
 * Refusals use ConvexError rather than Error on purpose. A thrown Error is
 * redacted to "Server Error" on a production deployment, and these messages are
 * the whole point — the page shows them to the person who clicked the button.
 */

type RequestDoc = Doc<"mentorshipRequests">;
type Status = RequestDoc["status"];
type AnyCtx = QueryCtx | MutationCtx;

/** Status a mentor can move a request to. "requested" is the insert-time state. */
const mentorAction = v.union(
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("completed"),
);

/**
 * The whole state machine, in one place.
 *
 * requested → accepted | declined
 * accepted  → completed
 * completed | declined → nothing (terminal)
 */
const ALLOWED: Record<Status, readonly Status[]> = {
  requested: ["accepted", "declined"],
  accepted: ["completed"],
  completed: [],
  declined: [],
};

/** Returns null when the move is legal, otherwise the message to show a human. */
function transitionProblem(from: Status, to: Status): string | null {
  if (ALLOWED[from].includes(to)) return null;
  if (from === to) return `This request is already marked ${to}.`;
  if (from === "completed")
    return "This session is already completed. A completed session cannot be reopened — ask the seeker to book again.";
  if (from === "declined")
    return "This request was declined. The seeker has to send a fresh request before anything else can happen to it.";
  if (from === "requested" && to === "completed")
    return "Accept the request before completing it. A session can only be completed after it was accepted.";
  if (from === "accepted")
    return `This request was already accepted, so it can only be marked completed — not ${to}.`;
  return `A request cannot move from ${from} to ${to}.`;
}

const MAX_NOTE = 800;

/**
 * The caller's own alumni row, found by their session email.
 *
 * `alumni` has no by_email index and the schema is owned elsewhere, so this
 * scans — the same shape as authz.resolveRole's venture lookup. Emails are
 * compared case-folded because profiles and login providers disagree about case.
 */
async function callerAlumnus(ctx: AnyCtx, email: string) {
  const rows = await ctx.db.query("alumni").collect();
  return rows.find((row) => row.email.trim().toLowerCase() === email) ?? null;
}

/**
 * Refuses unless the session belongs to the mentor named on `mentorId`.
 *
 * This is the check that stops `careers.listMentors` from being an index of
 * readable inboxes: it hands out every mentor's `_id`, which is fine for booking
 * and useless for reading, because the id only says which row — the session says
 * who is asking.
 */
async function assertIsMentor(
  ctx: AnyCtx,
  mentorId: Id<"alumni">,
  callerEmail: string,
) {
  const mentor = await ctx.db.get(mentorId);
  if (!mentor) {
    throw new ConvexError("That mentor is no longer listed.");
  }
  if (mentor.email.trim().toLowerCase() !== callerEmail) {
    throw new ConvexError(
      "These are not your mentorship requests. A mentor can only open their own inbox.",
    );
  }
  return mentor;
}

/**
 * Requests carry a mentorId, not a mentor name, so both list queries join the
 * alumni row. The derived flags keep the same rules on every surface: the page
 * never has to re-decide when feedback is open.
 *
 * The mentor's own email is deliberately not part of this shape. A seeker gets
 * the name and employer, which is what the directory already shows them.
 */
async function decorate(ctx: QueryCtx, row: RequestDoc) {
  const mentor = await ctx.db.get(row.mentorId);
  return {
    _id: row._id,
    mentorId: row.mentorId,
    mentorName: mentor?.name ?? "Mentor no longer listed",
    mentorDepartment: mentor?.department ?? null,
    mentorBatch: mentor?.batch ?? null,
    mentorCompany: mentor?.company ?? null,
    mentorTopics: mentor?.mentorTopics ?? [],
    seekerName: row.seekerName,
    seekerEmail: row.seekerEmail,
    seekerKind: row.seekerKind,
    topic: row.topic,
    message: row.message,
    preferredSlot: row.preferredSlot ?? null,
    status: row.status,
    feedbackRating: row.feedbackRating ?? null,
    feedbackNote: row.feedbackNote ?? null,
    createdAt: row.createdAt,
    /** Follow-up tracking: this one is still sitting on a mentor's desk. */
    awaitingMentor: row.status === "requested",
    /** Feedback is open exactly once, and only after the session closed. */
    feedbackOpen: row.status === "completed" && row.feedbackRating === undefined,
    hasFeedback: row.feedbackRating !== undefined,
    /** What the mentor is allowed to do next, so buttons match the backend. */
    nextStatuses: ALLOWED[row.status],
  };
}

export type MentorshipRequestView = Awaited<ReturnType<typeof decorate>>;

/**
 * Is the signed-in member on the mentor roster, and if so, which row are they?
 *
 * The inbox needs the caller's own alumni `_id` to read, and nothing else in the
 * portal exposes it. Derived from the session, so the answer is only ever about
 * the caller — there is no argument to point it at somebody else.
 */
export const myMentorProfile = query({
  args: {},
  handler: async (ctx) => {
    const email = await requireEmail(ctx);
    const me = await callerAlumnus(ctx, email);
    if (!me) return null;
    return {
      alumniId: me._id,
      name: me.name,
      designation: me.designation,
      company: me.company,
      department: me.department,
      batch: me.batch,
      verified: me.verified,
      openToMentor: me.openToMentor,
      mentorTopics: me.mentorTopics ?? [],
    };
  },
});

/**
 * Mentor side of the booking system — one mentor's incoming requests.
 *
 * Requires a session and refuses any `mentorId` that is not the caller's own
 * alumni row. Without that check, every message any student ever sent is one
 * public id away.
 */
export const requestsForMentor = query({
  args: { mentorId: v.id("alumni") },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    await assertIsMentor(ctx, args.mentorId, email);

    const rows = await ctx.db
      .query("mentorshipRequests")
      .withIndex("by_mentor", (q) => q.eq("mentorId", args.mentorId))
      .collect();

    rows.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(rows.map((row) => decorate(ctx, row)));
  },
});

/**
 * Seeker side — "track your requests".
 *
 * The address is taken from the session, never from an argument. An email
 * argument here would let anyone read anyone's requests by guessing, and even
 * comparing an argument against the session would still confirm which addresses
 * exist. Matching is case-folded because the booking form stays open to people
 * without an account, who type their address however they like.
 *
 * There is no by_seekerEmail index (the schema is owned elsewhere), so this
 * scans the table.
 */
export const requestsForSeeker = query({
  args: {},
  handler: async (ctx) => {
    const email = await requireEmail(ctx);

    const rows = await ctx.db.query("mentorshipRequests").collect();
    const mine = rows.filter((r) => r.seekerEmail.trim().toLowerCase() === email);

    mine.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(mine.map((row) => decorate(ctx, row)));
  },
});

/**
 * The mentor accepting, declining or closing a booking.
 *
 * Two gates, in this order: the caller must be the mentor named on the row, and
 * only then is the transition checked. Ownership first means a stranger learns
 * nothing about a request's state, and it closes the obvious attack — walking
 * every `requested` booking to `declined`, which ALLOWED makes terminal, so every
 * student who asked for help is refused by nobody.
 */
export const updateStatus = mutation({
  args: {
    requestId: v.id("mentorshipRequests"),
    status: mentorAction,
  },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);

    const row = await ctx.db.get(args.requestId);
    if (!row) throw new ConvexError("That mentorship request no longer exists.");
    await assertIsMentor(ctx, row.mentorId, email);

    const problem = transitionProblem(row.status, args.status);
    if (problem) throw new ConvexError(problem);

    await ctx.db.patch(args.requestId, { status: args.status });
    return { requestId: args.requestId, status: args.status };
  },
});

/**
 * Follow-up: a rating and a couple of lines, once, after the session happened.
 *
 * Only the person who booked it may rate it. Feedback is write-once and feeds
 * `mentorshipStats.averageRating`, so an unauthorised write would permanently
 * brand a named alumnus with a stranger's score and a stranger's words.
 *
 * Feedback on a request nobody has held yet would be noise, and a second
 * submission would silently overwrite the first, so both are refused too.
 */
export const leaveFeedback = mutation({
  args: {
    requestId: v.id("mentorshipRequests"),
    rating: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);

    const row = await ctx.db.get(args.requestId);
    if (!row) throw new ConvexError("That mentorship request no longer exists.");

    if (row.seekerEmail.trim().toLowerCase() !== email) {
      throw new ConvexError(
        "This session was not booked from your account. Only the person who asked for the session can rate it.",
      );
    }

    if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
      throw new ConvexError("Give the session a whole-number rating from 1 to 5.");
    }

    const note = args.note?.trim() ?? "";
    if (note.length > MAX_NOTE) {
      throw new ConvexError(
        `Keep the note under ${MAX_NOTE} characters — it is a summary, not a transcript.`,
      );
    }

    if (row.status === "requested") {
      throw new ConvexError(
        "The mentor has not accepted this request yet, so there is no session to rate.",
      );
    }
    if (row.status === "accepted") {
      throw new ConvexError(
        "This session is not closed yet. Feedback opens once the mentor marks it completed.",
      );
    }
    if (row.status === "declined") {
      throw new ConvexError(
        "This request was declined, so there is no session to rate.",
      );
    }
    if (row.feedbackRating !== undefined) {
      throw new ConvexError(
        "Feedback is already recorded for this session. Write to the association if it needs correcting.",
      );
    }

    await ctx.db.patch(args.requestId, {
      feedbackRating: args.rating,
      feedbackNote: note.length > 0 ? note : undefined,
    });
    return { requestId: args.requestId, rating: args.rating };
  },
});

/**
 * Headline numbers for the mentorship lifecycle, for the page's stat row.
 *
 * The one function here that stays open, deliberately: it returns counts and one
 * rounded average, never a name, an address, a message or a single row, so it
 * discloses nothing about an individual. It is also what a visitor without an
 * account sees, which is the point of publishing it.
 */
export const mentorshipStats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("mentorshipRequests").collect();

    const byStatus: Record<Status, number> = {
      requested: 0,
      accepted: 0,
      completed: 0,
      declined: 0,
    };
    for (const r of rows) byStatus[r.status] += 1;

    const rated = rows.filter((r) => typeof r.feedbackRating === "number");
    const ratingTotal = rated.reduce((sum, r) => sum + (r.feedbackRating ?? 0), 0);
    const completed = rows.filter((r) => r.status === "completed");
    const completedWithFeedback = completed.filter(
      (r) => typeof r.feedbackRating === "number",
    ).length;

    return {
      total: rows.length,
      byStatus,
      /** Null rather than 0 — "no ratings yet" is not the same as a bad score. */
      averageRating:
        rated.length > 0 ? Math.round((ratingTotal / rated.length) * 10) / 10 : null,
      ratedCount: rated.length,
      completedCount: completed.length,
      completedWithFeedback,
      /** Both directions the brief names, counted. */
      fromStudents: rows.filter((r) => r.seekerKind === "student").length,
      fromAlumni: rows.filter((r) => r.seekerKind === "alumnus").length,
      mentorsEngaged: new Set(rows.map((r) => r.mentorId)).size,
    };
  },
});
