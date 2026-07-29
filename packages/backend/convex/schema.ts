import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * RITAA — Ramco Institute of Technology Alumni Association.
 *
 * Table layout follows the twelve modules in the RITAA web portal brief:
 * profiles + directory, career hub, mentorship, news/stories, gallery,
 * events, fundraising, and the RACE entrepreneur zone.
 */

export const DEPARTMENTS = [
  "CSE",
  "IT",
  "ECE",
  "EEE",
  "MECH",
  "CIVIL",
  "AIDS",
] as const;

export const REGIONS = [
  "Rajapalayam",
  "Madurai",
  "Chennai",
  "Coimbatore",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Delhi NCR",
  "Overseas",
] as const;

export default defineSchema({
  /**
   * Module 1 — alumni verification for authenticity.
   *
   * A join request sits here as `pending` until the association checks the roll
   * number against college records. Approval is what flips the member's
   * directory listing to verified, so this is the gate for authenticity.
   */
  verificationRequests: defineTable({
    userId: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    batch: v.number(),
    department: v.string(),
    rollNumber: v.string(),
    graduationYear: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  /** Module 1 — role-based access: Alumni, Entrepreneurs, Admins, Guests. */
  memberRoles: defineTable({
    email: v.string(),
    role: v.union(
      v.literal("alumni"),
      v.literal("entrepreneur"),
      v.literal("admin"),
      v.literal("guest"),
    ),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  /**
   * Module 1 — OTP verification.
   *
   * Only a hash of the code is stored, never the code itself, so a database
   * read cannot be replayed as a login. Rows carry an expiry and an attempt
   * counter to make brute-forcing a six-digit code impractical.
   */
  otpChallenges: defineTable({
    email: v.string(),
    codeHash: v.string(),
    purpose: v.union(v.literal("signup"), v.literal("signin")),
    expiresAt: v.number(),
    attempts: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  /** Module 2 + 3 — alumni profiles and the searchable directory. */
  alumni: defineTable({
    userId: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    /** Graduating batch year, e.g. 2021. Doubles as the batch-rail key. */
    batch: v.number(),
    department: v.string(),
    designation: v.string(),
    company: v.string(),
    region: v.string(),
    skills: v.array(v.string()),
    industries: v.array(v.string()),
    bio: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    /** Module 1 — alumni verification for authenticity. */
    verified: v.boolean(),
    featured: v.boolean(),
    /** Module 5 — appears in the mentorship network when true. */
    openToMentor: v.boolean(),
    mentorTopics: v.optional(v.array(v.string())),
    /**
     * Module 2 — per-field visibility.
     *
     * Two lists, because the two kinds of field want opposite defaults:
     *  - `hiddenFields` is opt-OUT, for low-sensitivity fields (company, region)
     *    that are public unless the member hides them.
     *  - `sharedFields` is opt-IN, for contact details (email, phone,
     *    linkedinUrl) which stay private until the member publishes them.
     *
     * Contact details must not be published merely because someone never opened
     * the profile editor, so absence means private for those. See
     * directory.ts publicView, which is the single place this is enforced.
     */
    hiddenFields: v.optional(v.array(v.string())),
    sharedFields: v.optional(v.array(v.string())),
    joinedAt: v.number(),
  })
    .index("by_batch", ["batch"])
    .index("by_department", ["department"])
    .index("by_mentor", ["openToMentor"])
    .index("by_featured", ["featured"])
    .searchIndex("search_alumni", {
      searchField: "name",
      filterFields: ["batch", "department", "region", "company"],
    }),

  /** Module 7 — event management. */
  events: defineTable({
    title: v.string(),
    slug: v.string(),
    kind: v.union(
      v.literal("reunion"),
      v.literal("webinar"),
      v.literal("sports"),
      v.literal("networking"),
      v.literal("convocation"),
    ),
    summary: v.string(),
    description: v.string(),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    mode: v.union(v.literal("onsite"), v.literal("online"), v.literal("hybrid")),
    venue: v.string(),
    capacity: v.optional(v.number()),
    /** Zero means free entry — the brief lists ticketing as conditional. */
    ticketPriceInr: v.number(),
    coverUrl: v.optional(v.string()),
    published: v.boolean(),
  })
    .index("by_start", ["startsAt"])
    .index("by_slug", ["slug"]),

  /** Module 7 — RSVP with reminder scheduling. */
  eventRsvps: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    email: v.string(),
    batch: v.optional(v.number()),
    guests: v.number(),
    status: v.union(v.literal("going"), v.literal("maybe"), v.literal("cancelled")),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_email", ["eventId", "email"]),

  /** Module 4 — career hub. */
  jobs: defineTable({
    title: v.string(),
    company: v.string(),
    location: v.string(),
    type: v.union(
      v.literal("full-time"),
      v.literal("internship"),
      v.literal("contract"),
    ),
    experience: v.string(),
    description: v.string(),
    skills: v.array(v.string()),
    applyUrl: v.optional(v.string()),
    postedByName: v.string(),
    postedByEmail: v.string(),
    postedByBatch: v.optional(v.number()),
    /** Referral system — poster is willing to refer applicants internally. */
    referralOffered: v.boolean(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_type", ["type"]),

  /** Module 5 — mentorship bookings with feedback follow-up. */
  mentorshipRequests: defineTable({
    mentorId: v.id("alumni"),
    seekerName: v.string(),
    seekerEmail: v.string(),
    seekerKind: v.union(v.literal("student"), v.literal("alumnus")),
    topic: v.string(),
    message: v.string(),
    preferredSlot: v.optional(v.string()),
    status: v.union(
      v.literal("requested"),
      v.literal("accepted"),
      v.literal("completed"),
      v.literal("declined"),
    ),
    feedbackRating: v.optional(v.number()),
    feedbackNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_mentor", ["mentorId"])
    .index("by_status", ["status"]),

  /** Module 6 — success stories, achievements, event recaps, newsletters. */
  stories: defineTable({
    title: v.string(),
    slug: v.string(),
    category: v.union(
      v.literal("success"),
      v.literal("achievement"),
      v.literal("recap"),
      v.literal("newsletter"),
    ),
    excerpt: v.string(),
    body: v.string(),
    authorName: v.string(),
    authorBatch: v.optional(v.number()),
    coverUrl: v.optional(v.string()),
    /** Newsletter issues expose a downloadable PDF. */
    downloadUrl: v.optional(v.string()),
    featured: v.boolean(),
    publishedAt: v.number(),
  })
    .index("by_published", ["publishedAt"])
    .index("by_category", ["category"])
    .index("by_slug", ["slug"]),

  /** Module 6 — media gallery. */
  albums: defineTable({
    title: v.string(),
    year: v.number(),
    eventName: v.string(),
    coverUrl: v.string(),
    imageUrls: v.array(v.string()),
    videoUrl: v.optional(v.string()),
  }).index("by_year", ["year"]),

  /** Module 8 — fundraising campaigns with a transparent usage tracker. */
  campaigns: defineTable({
    title: v.string(),
    slug: v.string(),
    cause: v.string(),
    /** Batch-specific campaigns, e.g. the 2019 batch scholarship fund. */
    batch: v.optional(v.number()),
    summary: v.string(),
    goalInr: v.number(),
    raisedInr: v.number(),
    donorCount: v.number(),
    coverUrl: v.optional(v.string()),
    /** Fund usage tracker — where the money actually went. */
    allocations: v.array(
      v.object({ label: v.string(), amountInr: v.number() }),
    ),
    active: v.boolean(),
    closesAt: v.optional(v.number()),
  })
    .index("by_active", ["active"])
    .index("by_slug", ["slug"]),

  /** Module 8 — donor wall. */
  donations: defineTable({
    campaignId: v.id("campaigns"),
    donorName: v.string(),
    batch: v.optional(v.number()),
    amountInr: v.number(),
    method: v.union(
      v.literal("upi"),
      v.literal("card"),
      v.literal("netbanking"),
      v.literal("wallet"),
    ),
    anonymous: v.boolean(),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_created", ["createdAt"]),

  /** Module 9 — Entrepreneur Zone, powered by RACE. */
  ventures: defineTable({
    founderName: v.string(),
    founderEmail: v.string(),
    founderBatch: v.optional(v.number()),
    age: v.optional(v.number()),
    contact: v.optional(v.string()),
    businessName: v.string(),
    category: v.string(),
    website: v.optional(v.string()),
    description: v.string(),
    productImageUrls: v.array(v.string()),
    /** The brief's two user types. */
    stage: v.union(v.literal("established"), v.literal("upcoming")),
    /** What this founder wants from the community. */
    lookingFor: v.array(v.string()),
    /** Established founders can also offer help to upcoming ones. */
    offersHelp: v.array(v.string()),
    location: v.string(),
    approved: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_stage", ["stage"])
    .index("by_category", ["category"])
    .index("by_approved", ["approved"]),
});
