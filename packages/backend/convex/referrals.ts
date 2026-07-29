import { v } from "convex/values";

import { mutation } from "./_generated/server";

/**
 * Module 4 — the referral half of "resume upload and referral system".
 *
 * WHAT THIS IS
 * ------------
 * `requestReferral` is the referral request itself: it takes the candidate's
 * details, checks them against the live job row, and returns the finished
 * request — recipient, subject, body, reference code — for the UI to hand to
 * the candidate's mail client. The alumnus receives one complete, consistently
 * formatted request instead of an empty `mailto:` with a subject line.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It writes nothing, because there is no table to write to. `schema.ts` has no
 * `referralRequests` table and this module is not allowed to add one, so a row
 * cannot be inserted anywhere honestly: `jobs` has no field for it, and
 * `mentorshipRequests` belongs to module 5 and keys on `alumni` ids, which a
 * job poster does not necessarily have.
 *
 * That is a deliberate, visible limitation, not a silent drop:
 *   - nothing is accepted under the pretence of being saved;
 *   - the return value carries `storedInPortal: false`, and the UI prints that
 *     fact next to the request before the candidate sends it;
 *   - the email the candidate sends is the only record, and it says so in its
 *     own footer.
 *
 * When a `referralRequests` table is added to the schema, this handler gains an
 * insert and flips `storedInPortal` — the argument list and the UI do not have
 * to change.
 *
 * WHY A MUTATION AND NOT A QUERY
 * ------------------------------
 * It is called once, imperatively, when the candidate submits the form. A query
 * would mean putting a name, an email and a covering note into a reactive
 * subscription that stays open in the client cache for the rest of the session.
 * A mutation is a one-shot RPC, which is what this actually is.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MIN = 40;
/** Keeps the composed body inside the length a `mailto:` href survives. */
const MESSAGE_MAX = 1200;

/** Human-quotable code so the poster, the candidate and RITAA cite one thing. */
function referenceCode(jobId: string, at: number) {
  const d = new Date(at);
  const stamp =
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}`;
  return `RITAA-REF-${stamp}-${jobId.slice(-6).toUpperCase()}`;
}

function row(label: string, value: string) {
  return `${label.padEnd(12, " ")}: ${value}`;
}

export const requestReferral = mutation({
  args: {
    jobId: v.id("jobs"),
    candidateName: v.string(),
    candidateEmail: v.string(),
    candidateBatch: v.optional(v.number()),
    /** Where the candidate is now — company, or college and year. */
    currentRole: v.optional(v.string()),
    /** A link the candidate already controls. The portal stores no files. */
    resumeUrl: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !job.active) {
      throw new Error(
        "That role has come off the board. Reload the page and pick another opening.",
      );
    }
    if (!job.referralOffered) {
      throw new Error(
        `${job.postedByName} has not offered a referral on this role — apply to it directly instead.`,
      );
    }

    const name = args.candidateName.trim();
    const email = args.candidateEmail.trim();
    const message = args.message.trim();
    const currentRole = args.currentRole?.trim() ?? "";
    const resumeUrl = args.resumeUrl?.trim() ?? "";

    if (name.length < 2) {
      throw new Error("Enter your full name — the referral goes forward under it.");
    }
    if (!EMAIL_RE.test(email)) {
      throw new Error("Enter a working email, for example you@example.com.");
    }
    if (message.length < MESSAGE_MIN) {
      throw new Error(
        "Write at least a couple of sentences on why you fit this role. A referral puts the alumnus's name on your application.",
      );
    }
    if (message.length > MESSAGE_MAX) {
      throw new Error(
        `Keep the note under ${MESSAGE_MAX} characters so it fits in one email.`,
      );
    }
    if (resumeUrl.length > 0 && !/^https?:\/\//i.test(resumeUrl)) {
      throw new Error(
        "Start the resume link with https:// — or leave it empty and attach the file to the email.",
      );
    }
    const thisYear = new Date().getUTCFullYear();
    if (
      args.candidateBatch !== undefined &&
      (args.candidateBatch < 1980 || args.candidateBatch > thisYear + 6)
    ) {
      throw new Error("Choose your graduating batch from the list.");
    }

    const requestedAt = Date.now();
    const reference = referenceCode(args.jobId, requestedAt);
    const needsResumeAttachment = resumeUrl.length === 0;

    const subject = `Referral request — ${job.title} at ${job.company} [${reference}]`;
    const body = [
      `Hello ${job.postedByName},`,
      "",
      `I am asking for your referral for ${job.title} at ${job.company}, which you posted on the RITAA career hub.`,
      "",
      "ROLE",
      row("Title", `${job.title} (${job.type})`),
      row("Company", job.company),
      row("Location", job.location),
      row("Experience", job.experience),
      row("Skills", job.skills.length > 0 ? job.skills.join(", ") : "not listed"),
      "",
      "CANDIDATE",
      row("Name", name),
      row("Email", email),
      row("Batch", args.candidateBatch ? String(args.candidateBatch) : "not given"),
      row("Currently", currentRole.length > 0 ? currentRole : "not given"),
      row(
        "Resume",
        needsResumeAttachment ? "attached to this email" : resumeUrl,
      ),
      "",
      "WHY I FIT THIS ROLE",
      message,
      "",
      row("Reference", reference),
      "Sent from the RITAA career hub. The portal does not store referral requests, so this email is the only record of it.",
    ].join("\n");

    return {
      reference,
      requestedAt,
      to: job.postedByEmail,
      subject,
      body,
      jobTitle: job.title,
      company: job.company,
      postedByName: job.postedByName,
      /** True only once the schema has somewhere to keep the request. */
      storedInPortal: false,
      /** How the request reaches the poster today. */
      delivery: "email" as const,
      /** No link was given, so the candidate must attach the PDF. */
      needsResumeAttachment,
    };
  },
});
