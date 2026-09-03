import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail } from "./authz";
import { activeFields, optionsFor } from "./profileFields";

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

/* ------------------------------------------------------------------ */
/* The eleven configured fields                                        */
/* ------------------------------------------------------------------ */

/**
 * Splits a provider-supplied display name into two parts.
 *
 * Only ever used to prefill, never to decide anything. Names do not reliably
 * split on a space — "Ravi Kumar Subramanian" and "Van der Berg" both break it
 * — which is why the form asks for the two parts separately and stores what the
 * member confirms rather than what this guessed.
 */
export function splitName(full: string) {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 0 || parts[0] === "") return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/**
 * The value a configured field currently holds on a profile row.
 *
 * One place, so the required-field check, the completeness query and the form
 * prefill all read a field the same way. Returns "" for absent, which is what
 * "unanswered" means for every one of these.
 */
function fieldValue(row: Doc<"alumni"> | null, key: string): string {
  if (!row) return "";
  switch (key) {
    case "firstName":
      return (row.firstName ?? splitName(row.name).first).trim();
    case "lastName":
      return (row.lastName ?? splitName(row.name).last).trim();
    case "email":
      return row.email.trim();
    case "phone":
      return (row.phone ?? "").trim();
    case "location":
      return (row.location ?? "").trim();
    case "address":
      return (row.address ?? "").trim();
    case "batch":
      return row.batch ? String(row.batch) : "";
    case "department":
      return (row.department ?? "").trim();
    case "company":
      return (row.company ?? "").trim();
    case "workLocation":
      return (row.workLocation ?? "").trim();
    case "designation":
      return (row.designation ?? "").trim();
    default:
      return "";
  }
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
      sharedFields: row.sharedFields ?? [],
      // The two name parts, derived for a profile that predates the split so
      // the details form is never blank for someone who already has a name.
      firstName: row.firstName ?? splitName(row.name).first,
      lastName: row.lastName ?? splitName(row.name).last,
      location: row.location ?? "",
      address: row.address ?? "",
      companyDomain: row.companyDomain ?? "",
      workLocation: row.workLocation ?? "",
      locationConsent: row.locationConsent ?? false,
      locationLat: row.locationLat ?? null,
      locationLng: row.locationLng ?? null,
      locationUpdatedAt: row.locationUpdatedAt ?? null,
      locationSource: row.locationSource ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Write — create or edit the profile
// ---------------------------------------------------------------------------

/**
 * Creates or updates a profile, keyed on the address in the session.
 *
 * PATCH SEMANTICS, and why they changed. Every argument is optional now, and
 * only the ones actually supplied are written. Two forms edit this row: the
 * member details form, which owns the eleven fields the association configured,
 * and the directory extras on /profile, which owns the bio, the tags and the
 * mentorship offer. With an all-or-nothing write, whichever of the two saved
 * second would blank everything the other had set — `cleanTags(undefined)` is
 * an empty array, and an empty array overwrites. So: an absent argument means
 * leave it alone, and an empty string means clear it.
 *
 * THE OPTION LISTS ARE ENFORCED HERE. Batch and department are checked against
 * `profileFields`, not against a constant in this file, because an admin edits
 * those lists from the console and adding next year's batch has to work without
 * a deploy. The check has to be on this side: a dropdown is a suggestion made
 * to a browser, and a crafted call would otherwise write any value it liked.
 *
 * `verified`, `featured`, `userId`, `avatarUrl` and `joinedAt` are still absent
 * from the argument list by design, so a re-save can neither grant a badge nor
 * reset a join date.
 */
export const upsertProfile = mutation({
  args: {
    /* The eleven configured fields, less `email`: that is the identity key and
       it comes from the session, so it is never an argument. */
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    address: v.optional(v.string()),
    batch: v.optional(v.number()),
    department: v.optional(v.string()),
    company: v.optional(v.string()),
    companyDomain: v.optional(v.string()),
    workLocation: v.optional(v.string()),
    designation: v.optional(v.string()),

    /* The directory extras. Still sent as a block by the /profile editor. */
    name: v.optional(v.string()),
    region: v.optional(v.string()),
    bio: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    industries: v.optional(v.array(v.string())),
    linkedinUrl: v.optional(v.string()),
    openToMentor: v.optional(v.boolean()),
    mentorTopics: v.optional(v.array(v.string())),
    hiddenFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    /*
     * SECURITY: the row is keyed on the session email, not on an argument.
     * While this was caller-supplied, anyone could overwrite any member's
     * profile — name, company, phone, even the LinkedIn URL, which could be
     * repointed at a phishing page on a verified member's record.
     */
    const email = await requireEmail(ctx);
    const existing = await findByEmail(ctx, email);

    const patch: Record<string, unknown> = {};
    const tidy = (raw: string) => raw.trim().replace(/\s+/g, " ");

    /* ---- The two name parts, and the display name they compose ---------- */
    if (args.firstName !== undefined) patch.firstName = tidy(args.firstName);
    if (args.lastName !== undefined) patch.lastName = tidy(args.lastName);

    if (args.firstName !== undefined || args.lastName !== undefined) {
      const first =
        args.firstName !== undefined
          ? tidy(args.firstName)
          : (existing?.firstName ?? splitName(existing?.name ?? "").first);
      const last =
        args.lastName !== undefined
          ? tidy(args.lastName)
          : (existing?.lastName ?? splitName(existing?.name ?? "").last);
      const composed = [first, last].filter(Boolean).join(" ").trim();
      if (!composed) {
        throw new ConvexError("Enter your name — it is how members find you.");
      }
      patch.name = composed;
    }

    if (args.name !== undefined) {
      const name = tidy(args.name);
      if (!name) {
        throw new ConvexError("Enter your name — it is how members find you.");
      }
      patch.name = name;
      // Keep the parts in step when only the single field was sent, so the
      // details form does not reopen showing a stale first name.
      if (args.firstName === undefined && args.lastName === undefined) {
        const parts = splitName(name);
        patch.firstName = parts.first;
        patch.lastName = parts.last;
      }
    }

    /* ---- Batch and department, against the admin's own lists ----------- */
    if (args.batch !== undefined) {
      if (!Number.isInteger(args.batch)) {
        throw new ConvexError("A graduating batch is a year, like 2021.");
      }
      const { options } = await optionsFor(ctx, "batch");
      if (options.length > 0 && !options.includes(String(args.batch))) {
        const shown = options.slice(0, 12).join(", ");
        throw new ConvexError(
          `Choose one of the batches the association lists: ${shown}${options.length > 12 ? ", and so on" : ""}.`,
        );
      }
      patch.batch = args.batch;
    }

    if (args.department !== undefined) {
      const wanted = args.department.trim();
      const { options } = await optionsFor(ctx, "department");
      const match = options.find(
        (option) => option.toLowerCase() === wanted.toLowerCase(),
      );
      if (options.length > 0 && !match) {
        throw new ConvexError(
          `Choose one of these departments: ${options.join(", ")}.`,
        );
      }
      // Stored with the casing the admin listed, so the directory facets do
      // not split into "CSE" and "cse".
      patch.department = match ?? wanted.toUpperCase();
    }

    /* ---- The rest of the eleven ---------------------------------------- */
    if (args.phone !== undefined) patch.phone = optionalText(args.phone);
    if (args.address !== undefined) patch.address = optionalText(args.address);
    if (args.company !== undefined) patch.company = args.company.trim();
    if (args.companyDomain !== undefined) {
      patch.companyDomain = optionalText(args.companyDomain);
    }
    if (args.workLocation !== undefined) {
      patch.workLocation = optionalText(args.workLocation);
    }
    if (args.designation !== undefined) {
      patch.designation = args.designation.trim();
    }

    if (args.location !== undefined) {
      const location = optionalText(args.location);
      patch.location = location;
      // Typing over a detected place makes it a manual answer, and the next
      // sign-in must not quietly overwrite it — see applyDetectedLocation.
      if (location) {
        patch.locationSource = "manual";
        patch.locationUpdatedAt = Date.now();
      }
    }

    /* ---- The directory extras ------------------------------------------ */
    if (args.region !== undefined) patch.region = args.region.trim();
    if (args.bio !== undefined) patch.bio = optionalText(args.bio);
    if (args.skills !== undefined) patch.skills = cleanTags(args.skills);
    if (args.industries !== undefined) {
      patch.industries = cleanTags(args.industries);
    }

    if (args.linkedinUrl !== undefined) {
      const linkedinUrl = optionalText(args.linkedinUrl);
      if (linkedinUrl && !/^https?:\/\/\S+$/i.test(linkedinUrl)) {
        throw new ConvexError(
          "The LinkedIn link must be a full web address starting with https://.",
        );
      }
      patch.linkedinUrl = linkedinUrl;
    }

    if (args.openToMentor !== undefined) {
      patch.openToMentor = args.openToMentor;
      // Topics only mean something for a member who is offering to mentor.
      patch.mentorTopics = args.openToMentor
        ? cleanTags(args.mentorTopics ?? existing?.mentorTopics)
        : [];
    } else if (args.mentorTopics !== undefined) {
      patch.mentorTopics = (existing?.openToMentor ?? false)
        ? cleanTags(args.mentorTopics)
        : [];
    }

    if (args.hiddenFields !== undefined) {
      // Rejected here as well as in setFieldVisibility: a save must not be
      // able to store a hidden field the directory does not know how to
      // redact, or the UI would promise a privacy it cannot keep.
      const hiddenFields = cleanTags(args.hiddenFields);
      for (const field of hiddenFields) {
        if (!isHideable(field)) {
          throw new ConvexError(
            `"${field}" cannot be made private. Only these can: ${HIDEABLE_FIELDS.join(", ")}.`,
          );
        }
      }
      patch.hiddenFields = hiddenFields;
    }

    /* ---- Update ---------------------------------------------------------
       Note the absence of verified / featured: an edit never touches them. */
    if (existing) {
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return {
        _id: existing._id as Id<"alumni">,
        created: false,
        verified: existing.verified,
      };
    }

    /* ---- Create ---------------------------------------------------------
       A first save has to satisfy the form the admin configured, so the
       required check happens here and nowhere else: an edit of one section
       must not be refused because a different section is blank. */
    const fields = await activeFields(ctx);
    const proposed = (key: string): string => {
      const value = patch[key];
      if (typeof value === "string") return value.trim();
      if (typeof value === "number") return String(value);
      return "";
    };

    for (const field of fields) {
      // The address is the session's, so it is never missing.
      if (!field.required || field.key === "email") continue;
      if (!proposed(field.key)) {
        throw new ConvexError(`${field.label} is required.`);
      }
    }

    // Two of the eleven are also structurally required by the table, and the
    // directory indexes both. They are marked locked in profileFields so an
    // admin cannot make them optional; this is the matching guard.
    if (typeof patch.batch !== "number") {
      throw new ConvexError("Choose your graduating batch.");
    }
    if (typeof patch.department !== "string" || !patch.department) {
      throw new ConvexError("Choose your department.");
    }

    const first = (patch.firstName as string | undefined) ?? "";
    const last = (patch.lastName as string | undefined) ?? "";
    const name =
      (patch.name as string | undefined) ??
      [first, last].filter(Boolean).join(" ").trim();
    if (!name) {
      throw new ConvexError("Enter your name — it is how members find you.");
    }

    const _id = await ctx.db.insert("alumni", {
      name,
      email,
      firstName: first || undefined,
      lastName: last || undefined,
      phone: patch.phone as string | undefined,
      location: patch.location as string | undefined,
      locationSource: patch.locationSource as "device" | "manual" | undefined,
      locationUpdatedAt: patch.locationUpdatedAt as number | undefined,
      address: patch.address as string | undefined,
      batch: patch.batch,
      department: patch.department,
      designation: (patch.designation as string | undefined) ?? "",
      company: (patch.company as string | undefined) ?? "",
      companyDomain: patch.companyDomain as string | undefined,
      workLocation: patch.workLocation as string | undefined,
      region: (patch.region as string | undefined) ?? "",
      skills: (patch.skills as string[] | undefined) ?? [],
      industries: (patch.industries as string[] | undefined) ?? [],
      bio: patch.bio as string | undefined,
      linkedinUrl: patch.linkedinUrl as string | undefined,
      // A new profile is always unverified and unfeatured. Verification is
      // granted only by access.ts:reviewVerification after the office checks
      // the member's roll number against college records.
      verified: false,
      featured: false,
      openToMentor: (patch.openToMentor as boolean | undefined) ?? false,
      mentorTopics: (patch.mentorTopics as string[] | undefined) ?? [],
      hiddenFields: (patch.hiddenFields as string[] | undefined) ?? [],
      joinedAt: Date.now(),
    });
    return { _id, created: true, verified: false };
  },
});

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

/**
 * Which required fields this member has not answered yet.
 *
 * Drives the nudge on the dashboard and the "finish this" state on the details
 * form. Derived from the admin's configuration on every read rather than stored
 * as a flag, so making a field required in the console immediately reopens the
 * form for everyone who never answered it — a stored `profileComplete: true`
 * would have frozen them as complete for a form that no longer exists.
 */
export const completeness = query({
  args: {},
  handler: async (ctx) => {
    const email = await requireEmail(ctx);
    const row = await findByEmail(ctx, email);
    const fields = await activeFields(ctx);

    const missing = fields
      .filter((field) => field.required && field.key !== "email")
      .filter((field) => !fieldValue(row, field.key))
      .map((field) => ({ key: field.key, label: field.label }));

    return {
      hasProfile: row !== null,
      complete: row !== null && missing.length === 0,
      missing,
      answered: fields.filter((field) => Boolean(fieldValue(row, field.key)))
        .length,
      total: fields.length,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Location                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turns the per-sign-in location refresh on or off.
 *
 * Consent is stored on the member's own row, server side, rather than in the
 * browser: the question is whether the association may hold this, and a
 * localStorage flag answers a different question — whether this browser feels
 * like asking. Withdrawing consent also clears the detected place, because
 * keeping it would mean the member had said stop and the record had not.
 */
export const setLocationConsent = mutation({
  args: { consent: v.boolean() },
  handler: async (ctx, args) => {
    const email = await requireEmail(ctx);
    const row = await findByEmail(ctx, email);
    if (!row) {
      throw new ConvexError(
        "Fill in your details first — there is no profile to attach this to yet.",
      );
    }

    if (args.consent) {
      await ctx.db.patch(row._id, { locationConsent: true });
      return { consent: true, cleared: false };
    }

    // Withdrawn. Drop the detected value unless the member typed it themselves.
    const detected = (row.locationSource ?? "device") === "device";
    await ctx.db.patch(row._id, {
      locationConsent: false,
      ...(detected
        ? { location: undefined, locationUpdatedAt: undefined, locationSource: undefined }
        : {}),
    });
    return { consent: false, cleared: detected };
  },
});

/**
 * Writes a place name detected from the browser.
 *
 * Internal, and reached only from `lookups.resolveLocation`, which is what
 * holds the coordinates — they are used to look the place up and then dropped,
 * so nothing here or anywhere else stores where a member physically was.
 *
 * THE CONSENT CHECK IS HERE because this is the only function that writes the
 * field. Putting it in the action instead would leave the write reachable
 * without it the first time anyone added a second caller.
 *
 * A manual answer is never overwritten. A member who typed "Chennai" while
 * travelling should not find it rewritten to the airport they signed in from;
 * the automatic refresh only maintains a place it detected itself.
 */
export const applyDetectedLocation = internalMutation({
  args: {
    email: v.string(),
    location: v.string(),
    region: v.optional(v.string()),
    /** Centroid of the named place, not the browser fix. See lookups.ts. */
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const row = await findByEmail(ctx, email);
    if (!row) return { saved: false, reason: "no-profile" };
    if (row.locationConsent !== true) return { saved: false, reason: "no-consent" };
    if ((row.locationSource ?? "device") === "manual") {
      return { saved: false, reason: "manual-location" };
    }

    const location = args.location.trim();
    if (!location) return { saved: false, reason: "empty" };

    await ctx.db.patch(row._id, {
      location,
      locationSource: "device",
      locationUpdatedAt: Date.now(),
      // The coarse bucket the directory filters on, kept in step when the
      // detected place maps onto one of the nine. Left alone when it does not.
      ...(args.region ? { region: args.region } : {}),
      // Only written together: a label with a stale centroid would put a
      // member on the map in the town they left.
      ...(args.lat !== undefined && args.lng !== undefined
        ? { locationLat: args.lat, locationLng: args.lng }
        : {}),
    });
    return { saved: true, reason: undefined as string | undefined };
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

/**
 * Records the centroid for a location the member TYPED.
 *
 * Separate from `applyDetectedLocation` because the two answer to different
 * permissions. The detected path is automatic, so it is gated on consent and
 * refuses to overwrite a manual answer. This one runs because the member typed
 * a place and pressed save — there is nothing to consent to, and the value it
 * writes is the one they just gave. It is what puts a member who never turned
 * on detection onto the map at all.
 *
 * Internal: reached only from `lookups.locateTypedLocation`, which is what
 * holds the forward geocoder.
 */
export const applyTypedCentroid = internalMutation({
  args: {
    email: v.string(),
    location: v.string(),
    lat: v.number(),
    lng: v.number(),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const row = await findByEmail(ctx, email);
    if (!row) return { saved: false, reason: "no-profile" };

    const location = args.location.trim();
    if (!location) return { saved: false, reason: "empty" };

    // Only place them if this is still the location on the record. A save that
    // raced with another edit must not attach the old town's coordinates to
    // the new town's name.
    if ((row.location ?? "").trim().toLowerCase() !== location.toLowerCase()) {
      return { saved: false, reason: "location-changed" };
    }

    await ctx.db.patch(row._id, {
      locationLat: args.lat,
      locationLng: args.lng,
      locationSource: "manual",
      locationUpdatedAt: Date.now(),
      ...(args.region ? { region: args.region } : {}),
    });
    return { saved: true, reason: undefined as string | undefined };
  },
});
