import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail } from "./authz";
import { DEPARTMENTS } from "./schema";

/**
 * Module 2 — Alumni Profiles.
 *
 * The brief asks for three things: an editable profile carrying academic,
 * personal and professional details; tagging for skills, location and
 * industries; and visibility settings per field (public/private).
 *
 * Division of labour with directory.ts: this file is the *owner's* view of the
 * record, so `byEmail` deliberately returns the row unredacted — a member must
 * be able to see and edit the phone number they have chosen to hide. Everything
 * other members see still goes through `directory.publicView`, which is the only
 * place redaction happens. `hiddenFields` is the shared contract between the two.
 *
 * IMPORTANT — `verified` and `featured` are not editable here, and no mutation
 * in this file accepts them as an argument or writes them. Verification is the
 * authenticity gate for the whole directory, so it is granted only by
 * `access.ts:reviewVerification` (an internalMutation, callable from the Convex
 * dashboard or CLI, never from a browser). A member creating their own profile
 * therefore starts unverified and unfeatured and cannot self-promote; a member
 * editing an existing profile cannot clear or claim either flag by re-saving.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** RITAA was established in 2017, so there is no earlier alumni cohort. */
const FIRST_BATCH = 2017;

/**
 * The fields a member may mark private.
 *
 * This list is exactly what `directory.ts:publicView` knows how to redact. It is
 * deliberately not "every field": allowing a member to hide, say, their
 * department would put a promise in the UI that the directory would quietly
 * break, and a privacy control that does not actually hide anything is worse
 * than no control at all. Extending this list means extending publicView first.
 */
export const HIDEABLE_FIELDS = [
  "company",
  "region",
  "email",
  "phone",
  "linkedinUrl",
] as const;

export type HideableField = (typeof HIDEABLE_FIELDS)[number];

function isHideable(field: string): field is HideableField {
  return (HIDEABLE_FIELDS as readonly string[]).includes(field);
}

/** One normal form for addresses, so lookups and saves always agree. */
function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

/**
 * Tag cleanup for skills / industries / mentor topics.
 *
 * Trims, drops blanks, and de-duplicates case-insensitively while keeping the
 * casing the member typed first — "React" and "react" are one tag, not two.
 */
function cleanTags(tags: string[] | undefined) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const value = tag.trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Optional free text: an empty box means "unset", not an empty string. */
function optionalText(raw: string | undefined) {
  const value = raw?.trim();
  return value ? value : undefined;
}

/**
 * The alumni table has no by_email index (batch, department, mentor, featured
 * and the name search index are what the directory needs), so an owner lookup
 * is a filtered scan. `first` rather than `unique` on purpose: nothing enforces
 * one row per address at the database level, and a member must still be able to
 * open their own profile if a duplicate ever gets seeded.
 */
async function findByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<"alumni"> | null> {
  return ctx.db
    .query("alumni")
    .filter((q) => q.eq(q.field("email"), email))
    .first();
}

// ---------------------------------------------------------------------------
// Read — the owner's own edit view
// ---------------------------------------------------------------------------

/**
 * The full, unredacted row for one address, or null if the member has not
 * created a profile yet.
 *
 * This is the edit view, which is why nothing is stripped: hiding a field from
 * the directory must not hide it from the person who owns it.
 *
 * SECURITY: the address comes from the session, never from an argument. When it
 * was an argument this query returned any member's unredacted row — including
 * the phone number they had marked private — to any anonymous caller, which
 * defeated the per-field visibility control that `directory.search` enforces.
 */
export const byEmail = query({
  args: {},
  handler: async (ctx) => {
    const email = await requireEmail(ctx);
    if (!email) return null;
    const row = await findByEmail(ctx, email);
    if (!row) return null;
    return {
      ...row,
      // Normalised so the form never has to reason about absent arrays.
      mentorTopics: row.mentorTopics ?? [],
      hiddenFields: row.hiddenFields ?? [],
    };
  },
});

// ---------------------------------------------------------------------------
// Write — create or edit the profile
// ---------------------------------------------------------------------------

/**
 * Creates or updates a profile, keyed on email.
 *
 * Only the fields the brief calls editable are accepted. `verified`, `featured`,
 * `userId`, `avatarUrl` and `joinedAt` are absent from the argument list by
 * design, so a re-save can neither grant a badge nor reset the join date.
 */
export const upsertProfile = mutation({
  args: {
    // Personal. `email` is deliberately NOT an argument — it is the identity
    // key and comes from the session, so a caller cannot target another member.
    name: v.string(),
    phone: v.optional(v.string()),
    region: v.string(),
    bio: v.optional(v.string()),
    // Academic
    batch: v.number(),
    department: v.string(),
    // Professional
    designation: v.string(),
    company: v.string(),
    industries: v.array(v.string()),
    linkedinUrl: v.optional(v.string()),
    // Tagging + mentorship
    skills: v.array(v.string()),
    openToMentor: v.boolean(),
    mentorTopics: v.optional(v.array(v.string())),
    // Per-field visibility
    hiddenFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    /*
     * SECURITY: the row is keyed on the session's email, not on args.email.
     * While this was caller-supplied, anyone could overwrite any member's
     * profile — name, company, phone, even the LinkedIn URL, which could be
     * repointed at a phishing page on a verified member's record.
     */
    const email = await requireEmail(ctx);

    /* ---- Validation. Every message names the field and the fix. -------- */
    const name = args.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Enter your name — it is how members find you.");

    const maxBatch = new Date().getFullYear() + 1;
    if (!Number.isInteger(args.batch) || args.batch < FIRST_BATCH || args.batch > maxBatch) {
      throw new Error(
        `Choose a graduating batch between ${FIRST_BATCH} and ${maxBatch}.`,
      );
    }

    const department = args.department.trim().toUpperCase();
    if (!(DEPARTMENTS as readonly string[]).includes(department)) {
      throw new Error(
        `Choose one of these departments: ${DEPARTMENTS.join(", ")}.`,
      );
    }

    const linkedinUrl = optionalText(args.linkedinUrl);
    if (linkedinUrl && !/^https?:\/\/\S+$/i.test(linkedinUrl)) {
      throw new Error(
        "The LinkedIn link must be a full web address starting with https://.",
      );
    }

    // Reject unsupported privacy fields here too, not only in
    // setFieldVisibility — otherwise a save could store a hidden field the
    // directory does not redact, which would promise privacy it cannot keep.
    const hiddenFields = cleanTags(args.hiddenFields);
    for (const field of hiddenFields) {
      if (!isHideable(field)) {
        throw new Error(
          `"${field}" cannot be made private. Only these can: ${HIDEABLE_FIELDS.join(", ")}.`,
        );
      }
    }

    const openToMentor = args.openToMentor;
    const editable = {
      name,
      email,
      phone: optionalText(args.phone),
      batch: args.batch,
      department,
      designation: args.designation.trim(),
      company: args.company.trim(),
      region: args.region.trim(),
      skills: cleanTags(args.skills),
      industries: cleanTags(args.industries),
      bio: optionalText(args.bio),
      linkedinUrl,
      openToMentor,
      // Topics only mean something for a member who is offering to mentor.
      mentorTopics: openToMentor ? cleanTags(args.mentorTopics) : [],
      hiddenFields,
    };

    /* ---- Upsert -------------------------------------------------------- */
    const existing = await findByEmail(ctx, email);

    if (existing) {
      // Note the absence of verified / featured: an edit never touches them.
      await ctx.db.patch(existing._id, editable);
      return {
        _id: existing._id as Id<"alumni">,
        created: false,
        verified: existing.verified,
      };
    }

    const _id = await ctx.db.insert("alumni", {
      ...editable,
      // A new profile is always unverified and unfeatured. Verification is
      // granted only by access.ts:reviewVerification after the office checks
      // the member's roll number against college records.
      verified: false,
      featured: false,
      joinedAt: Date.now(),
    });
    return { _id, created: true, verified: false };
  },
});

/**
 * Flips one field between public and private.
 *
 * Kept separate from `upsertProfile` so a toggle takes effect immediately,
 * without asking the member to re-submit the whole form, and so the allow-list
 * check sits on the single path the UI uses for privacy.
 */
export const setFieldVisibility = mutation({
  args: {
    field: v.string(),
    /** true = private (redacted from the directory for everyone). */
    hidden: v.boolean(),
  },
  handler: async (ctx, args) => {
    /*
     * SECURITY: session-keyed. As a caller-supplied argument this let anyone
     * un-hide every member's phone and email in a single sweep, silently and
     * with no notification to the members whose choices were reversed.
     */
    const email = await requireEmail(ctx);
    if (!EMAIL_RE.test(email)) {
      throw new Error("Your account has no usable email address.");
    }

    const field = args.field.trim();
    if (!isHideable(field)) {
      throw new Error(
        `"${field}" has no privacy setting. The directory can only hide: ${HIDEABLE_FIELDS.join(", ")}.`,
      );
    }

    const row = await findByEmail(ctx, email);
    if (!row) {
      throw new Error(
        `No profile found for ${email}. Save your profile first, then set what stays private.`,
      );
    }

    const current = new Set(row.hiddenFields ?? []);
    if (args.hidden) current.add(field);
    else current.delete(field);

    const hiddenFields = HIDEABLE_FIELDS.filter((f) => current.has(f));
    await ctx.db.patch(row._id, { hiddenFields });

    return { field, hidden: args.hidden, hiddenFields };
  },
});
