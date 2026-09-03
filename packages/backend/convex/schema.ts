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
   * Module 1 — RETIRED.
   *
   * Sign-in is Google and LinkedIn only, so there is no OTP challenge to store
   * and nothing writes to this table any more. The definition is kept so an
   * existing deployment can be pushed to without a destructive migration —
   * removing a table that still holds documents fails the push. Drop it once
   * `npx convex run --no-push` confirms the table is empty on every deployment.
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

  /**
   * The connection graph — one alumnus asking to be connected to another.
   *
   * KEYED ON EMAIL, not on an `alumni` id, for two reasons. A member has a
   * session before they have a directory profile, so a request must be able to
   * name someone who has not filled in their profile yet. And every other
   * member-keyed table here already keys on email (`memberRoles`,
   * `verificationRequests`, `jobs.postedByEmail`, `ventures.founderEmail`), so
   * an id here would make this the one table that disagrees. Addresses are
   * normalised to lowercase on write — see network.ts `normalise`.
   *
   * DIRECTION IS PRESERVED even after acceptance. `requesterEmail` is always the
   * person who asked, which is what lets the UI show "you asked" versus "they
   * asked" and what makes withdraw and decline different actions.
   *
   * `by_pair` is queried in both orders (a→b and b→a) before a request is
   * written, because a pair has no canonical direction while it is pending. Two
   * point lookups is the cost of not inventing a canonical ordering that
   * `status` would then have to be interpreted against.
   */
  connections: defineTable({
    requesterEmail: v.string(),
    recipientEmail: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    /** The note that came with the request. Read once, on the request card. */
    note: v.optional(v.string()),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_pair", ["requesterEmail", "recipientEmail"])
    .index("by_requester", ["requesterEmail", "status"])
    .index("by_recipient", ["recipientEmail", "status"]),

  /**
   * One thread between two connected members.
   *
   * The pair is stored SORTED — `participantA` is always the
   * lexicographically smaller address — so a thread has exactly one identity
   * and `by_pair` is a single lookup rather than a query in each direction.
   * Unlike `connections`, nothing here needs to know who started it, so there is
   * no direction to lose.
   *
   * `lastMessageAt` and `lastMessagePreview` are denormalised onto the row so the
   * inbox renders from one index scan instead of reading every thread's messages.
   */
  conversations: defineTable({
    participantA: v.string(),
    participantB: v.string(),
    lastMessageAt: v.number(),
    lastMessagePreview: v.string(),
    lastSenderEmail: v.string(),
    createdAt: v.number(),
  })
    .index("by_pair", ["participantA", "participantB"])
    .index("by_a", ["participantA", "lastMessageAt"])
    .index("by_b", ["participantB", "lastMessageAt"]),

  /**
   * Messages within a thread.
   *
   * `readAt` is per message rather than per thread so an unread count is a
   * filter on this index and never needs a second bookkeeping row that could
   * drift out of step with the messages themselves.
   */
  directMessages: defineTable({
    conversationId: v.id("conversations"),
    senderEmail: v.string(),
    body: v.string(),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  }).index("by_conversation", ["conversationId", "createdAt"]),

  /* ================================================================== */
  /* The student roster — the association's Excel import                 */
  /* ================================================================== */

  /**
   * One row of the association's standard student database spreadsheet.
   *
   * The column list is taken verbatim from the two files the association
   * supplied ("AIDS - Database 2022-2026 Batch Format.xlsx" and "CSE - Student
   * Database (2022-26 Batch).xlsx"). Both carry the identical 16-column header,
   * so that header is the format, and `roster.ts` validates against it rather
   * than guessing from whatever a given sheet happens to contain.
   *
   * WHY THIS IS NOT THE `alumni` TABLE. Two different things: `alumni` is a
   * profile a member wrote about themselves and controls the privacy of;
   * this is the college's record of who studied here, entered by the
   * association. Keeping them apart is what makes verification meaningful —
   * `access.reviewVerification` can check a claimed enrollment number against
   * this roster instead of against a self-declared field. Merging them would
   * mean a member could edit the very record used to verify them.
   *
   * PRIVACY. Every row holds a personal email, a phone number and a home
   * address for someone who has not consented to anything. `roster.ts` returns
   * the full row to admins only; the member-facing search returns a projection
   * carrying name, department and batch and nothing else.
   */
  studentRecords: defineTable({
    /** Column 1. Sheet ordering only — not an identifier. */
    slNo: v.optional(v.number()),
    firstName: v.string(),
    middleName: v.string(),
    lastName: v.string(),
    /** Column 5. The mandatory personal address, and the identity key. */
    personalEmail: v.string(),
    secondaryEmail: v.string(),
    phone: v.string(),
    secondaryPhone: v.string(),
    /** Column 9. The roll number — 12 digits in both supplied files. */
    enrollmentNumber: v.string(),
    degree: v.string(),
    /** Column 11 exactly as the sheet spelled it: "AI&DS", "Computer Science…". */
    departmentRaw: v.string(),
    /** The same department mapped onto the portal's codes: AIDS, CSE, … */
    department: v.string(),
    permanentAddress: v.string(),
    designation: v.string(),
    company: v.string(),
    yearOfPassing: v.number(),
    yearOfJoining: v.number(),

    /** Derived, not imported — see COLLEGE_EMAIL_DOMAIN in roster.ts. */
    collegeEmail: v.string(),
    /** First + middle + last, collapsed, for display and for search. */
    fullName: v.string(),
    /**
     * Name, enrollment number and both addresses in one field.
     *
     * One search index over this is what lets a single search box match a name,
     * a roll number or a college address — which is what the association asked
     * for. Convex tokenises it, so "953622104001" is a token that matches
     * exactly and also as a prefix.
     */
    searchText: v.string(),

    importedAt: v.number(),
    importedByEmail: v.string(),
    /** Groups every row that arrived from one upload, so it can be undone. */
    importBatchId: v.string(),
  })
    .index("by_enrollment", ["enrollmentNumber"])
    .index("by_personal_email", ["personalEmail"])
    .index("by_college_email", ["collegeEmail"])
    .index("by_department_passing", ["department", "yearOfPassing"])
    .index("by_import", ["importBatchId"])
    .searchIndex("search_students", {
      searchField: "searchText",
      filterFields: ["department", "yearOfPassing", "degree"],
    }),

  /** One upload. Kept so an import can be reported on, and reversed. */
  importBatches: defineTable({
    batchId: v.string(),
    fileName: v.string(),
    sheetName: v.string(),
    uploadedByEmail: v.string(),
    createdAt: v.number(),
    rowsSeen: v.number(),
    imported: v.number(),
    updated: v.number(),
    rejected: v.number(),
    /** True when the admin only asked for a validation report. */
    dryRun: v.boolean(),
  }).index("by_created", ["createdAt"]),

  /* ================================================================== */
  /* Communities                                                         */
  /* ================================================================== */

  /**
   * A community — a space with its own membership and its own feed.
   *
   * `visibility` is the whole distinction the association asked for: an `open`
   * community is joined instantly, an `approval` one holds the request until
   * whoever created the community accepts it. Nothing else differs between them,
   * which is why it is one field and not two kinds of table.
   */
  communities: defineTable({
    name: v.string(),
    slug: v.string(),
    tagline: v.string(),
    description: v.string(),
    visibility: v.union(v.literal("open"), v.literal("approval")),
    createdByEmail: v.string(),
    coverUrl: v.optional(v.string()),
    /** Optional narrowing, for a batch- or department-specific community. */
    scopeBatch: v.optional(v.number()),
    scopeDepartment: v.optional(v.string()),
    /** Denormalised so a directory of communities needs no per-row counting. */
    memberCount: v.number(),
    postCount: v.number(),
    archived: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_created", ["createdAt"])
    .index("by_creator", ["createdByEmail"]),

  /**
   * Membership, including the pending state.
   *
   * `role` and `status` are separate on purpose: a member can be an admin of a
   * community and still be removed from it, and collapsing the two would make
   * "pending admin" representable when it is not a real state.
   */
  communityMembers: defineTable({
    communityId: v.id("communities"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("moderator"), v.literal("member")),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("declined"),
      v.literal("removed"),
    ),
    /** What the requester said when asking to join, if anything. */
    note: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedByEmail: v.optional(v.string()),
  })
    .index("by_community_status", ["communityId", "status"])
    .index("by_community_email", ["communityId", "email"])
    .index("by_email_status", ["email", "status"]),

  /* ================================================================== */
  /* Questions — join screening, verification, and polls                 */
  /* ================================================================== */

  /**
   * One question, in one of three places.
   *
   * The association asked for admin-authored questions in three settings:
   * screening someone who wants to join a community, the alumni verification
   * form, and a poll attached to a feed post. They are one table because they
   * are the same shape — a prompt, an answer kind, and whether an answer is
   * required — and because a member answering any of them produces the same
   * `questionAnswers` row. Three tables would mean three near-identical
   * validators and three chances for them to disagree.
   *
   * `scope` decides which of `communityId` / `postId` is set:
   *   verification  — neither. The questions apply to every join request.
   *   communityJoin — `communityId`.
   *   poll          — `postId`.
   */
  questions: defineTable({
    scope: v.union(
      v.literal("verification"),
      v.literal("communityJoin"),
      v.literal("poll"),
      /** Asked on the member details form, after the fixed fields. */
      v.literal("profile"),
    ),
    communityId: v.optional(v.id("communities")),
    postId: v.optional(v.id("posts")),
    prompt: v.string(),
    kind: v.union(
      v.literal("text"),
      v.literal("longText"),
      v.literal("choice"),
    ),
    /** Non-empty for `choice`, and for every poll. */
    options: v.array(v.string()),
    required: v.boolean(),
    order: v.number(),
    active: v.boolean(),
    createdByEmail: v.string(),
    createdAt: v.number(),
  })
    .index("by_scope", ["scope", "active", "order"])
    .index("by_community", ["communityId", "order"])
    .index("by_post", ["postId", "order"]),

  /**
   * One answer to one question, by one member.
   *
   * A poll vote is an answer whose `answer` is the chosen option — same table,
   * because a vote is exactly "this person answered this question with this
   * option", and giving votes their own table would duplicate the one-per-person
   * rule that `by_question_email` already enforces here.
   */
  questionAnswers: defineTable({
    questionId: v.id("questions"),
    email: v.string(),
    scope: v.union(
      v.literal("verification"),
      v.literal("communityJoin"),
      v.literal("poll"),
      v.literal("profile"),
    ),
    communityId: v.optional(v.id("communities")),
    postId: v.optional(v.id("posts")),
    answer: v.string(),
    createdAt: v.number(),
  })
    .index("by_question", ["questionId"])
    .index("by_question_email", ["questionId", "email"])
    .index("by_email_scope", ["email", "scope"])
    .index("by_community_email", ["communityId", "email"]),

  /* ================================================================== */
  /* Posts — the general feed and each community's feed                  */
  /* ================================================================== */

  /**
   * A post.
   *
   * `communityId` absent means the general feed, which every signed-in member
   * can read — the association asked for one place where a post reaches every
   * batch and year. Present means the post belongs to that community and is
   * readable by its active members only. One table with a nullable scope, rather
   * than two, so the composer, the moderation path and the like/comment tables
   * do not each need a general and a community variant.
   */
  posts: defineTable({
    authorEmail: v.string(),
    communityId: v.optional(v.id("communities")),
    body: v.string(),
    kind: v.union(v.literal("text"), v.literal("poll")),
    imageUrls: v.array(v.string()),
    /**
     * Video, as URLs: a direct file, or a YouTube or Vimeo link the client
     * turns into an embed. Optional because every row predates the field.
     *
     * NOT UPLOADS. Nothing in this portal stores a video file — an association
     * recap is already on YouTube and a phone clip is already somewhere with a
     * URL, so this holds the address and the browser plays it. Adding upload
     * means Convex file storage, a size budget and a moderation queue for
     * bytes, none of which anyone has asked for.
     */
    videoUrls: v.optional(v.array(v.string())),
    /** Denormalised, so a feed of 50 posts is not 100 extra reads. */
    likeCount: v.number(),
    commentCount: v.number(),
    /**
     * How many times this post has been shared. Optional for the same reason
     * as `videoUrls`: the rows that predate sharing have no value to migrate,
     * and absent reads as zero.
     */
    shareCount: v.optional(v.number()),
    /**
     * Set when this post quotes another one — the share.
     *
     * A share is a post, not a join-table row, because it carries its own note
     * and its own comments and belongs in the feed on its own merits. Chains
     * are flattened in `feed.sharePost`: sharing a share quotes the original,
     * so the depth is always one and the feed never renders a matryoshka.
     */
    sharedFromId: v.optional(v.id("posts")),
    /** Moderation: hidden posts stay readable to their author and to admins. */
    hidden: v.boolean(),
    hiddenReason: v.optional(v.string()),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  })
    .index("by_created", ["createdAt"])
    .index("by_community", ["communityId", "createdAt"])
    .index("by_author", ["authorEmail", "createdAt"]),

  postLikes: defineTable({
    postId: v.id("posts"),
    email: v.string(),
    createdAt: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_post_email", ["postId", "email"]),

  postComments: defineTable({
    postId: v.id("posts"),
    authorEmail: v.string(),
    body: v.string(),
    hidden: v.boolean(),
    createdAt: v.number(),
  }).index("by_post", ["postId", "createdAt"]),


  /**
   * Answers from the outside world, kept so the same question is not asked
   * twice.
   *
   * WHY THIS EXISTS. Employer and job-title suggestions come from third-party
   * endpoints reached through a Convex action, and an action cannot be cached:
   * every keystroke that survived the debounce went out to the network and back
   * before the member saw a list. Typing "infosys" was six round trips to
   * somebody else's server, and it felt like it.
   *
   * A row here turns the second person to type the same prefix -- and the same
   * person backspacing -- into a local read over the socket that is already
   * open. The action still fetches on a miss, then writes the row, and the
   * reactive query the client is already watching delivers it.
   *
   * `query` is normalised lowercase, so "Infosys" and "infosys" are one row.
   * Nothing personal is stored: the key is a fragment of a company name and the
   * payload is a public answer about public companies.
   */
  lookupCache: defineTable({
    kind: v.union(v.literal("company"), v.literal("position")),
    query: v.string(),
    /** The result rows, as JSON. Shape belongs to lookups.ts, not the schema. */
    payload: v.string(),
    fetchedAt: v.number(),
  }).index("by_kind_query", ["kind", "query"]),

  /* ================================================================== */
  /* The member details form                                             */
  /* ================================================================== */

  /**
   * One row of the member details form, as the admin has configured it.
   *
   * WHY A CONFIG TABLE AND NOT ELEVEN MORE `questions` ROWS. The answers to
   * these eleven live in typed columns on `alumni`, because the portal reads
   * them: the directory filters on batch and department, the search index
   * covers company, mentorship reads the designation. An answer sitting in
   * `questionAnswers` as a string could not be indexed or filtered, so the
   * directory would stop working. What the admin actually needs to change is
   * the *presentation* — the label, the help text, whether it is required,
   * the order, and for the two dropdowns the list of options — and that is
   * exactly what this table holds. Anything genuinely new the admin wants to
   * ask goes in `questions` with scope `profile`, which has no such
   * constraint.
   *
   * `key` is the immutable join to the column on `alumni`. It is never
   * editable, because renaming it would silently orphan every answer.
   *
   * `locked` marks the fields the portal cannot work without — the two name
   * parts and the address the provider confirmed. Those can be relabelled but
   * not retired and not made optional; `profileFields.ts` enforces that on the
   * server, not just in the console.
   */
  profileFields: defineTable({
    key: v.string(),
    label: v.string(),
    help: v.optional(v.string()),
    /**
     * How the control behaves. Fixed per field, not admin-editable: a phone
     * number rendered as a dropdown, or a company rendered as a plain box with
     * no suggestions, is a worse form, not a configurable one.
     */
    kind: v.union(
      v.literal("text"),
      v.literal("email"),
      v.literal("phone"),
      v.literal("longText"),
      /** Admin-supplied options, and only those. */
      v.literal("select"),
      /** Live suggestions from a worldwide source, free text still accepted. */
      v.literal("company"),
      v.literal("position"),
      /** Detected from the browser with consent, editable by hand. */
      v.literal("location"),
    ),
    /** Meaningful for `select`. Admin-editable, and validated against on save. */
    options: v.array(v.string()),
    required: v.boolean(),
    active: v.boolean(),
    order: v.number(),
    locked: v.boolean(),
    updatedAt: v.number(),
    updatedByEmail: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_order", ["order"]),

  /** Module 2 + 3 — alumni profiles and the searchable directory. */
  alumni: defineTable({
    userId: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    /**
     * The two name parts, asked separately by the onboarding form.
     *
     * `name` stays as the single display string every other module already
     * reads, and is kept as `firstName + lastName` whenever both are known.
     * Storing all three is redundant on paper and correct in practice: a member
     * whose profile predates the split has only `name`, and a name is not
     * reliably splittable on a space.
     */
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    /** Graduating batch year, e.g. 2021. Doubles as the batch-rail key. */
    batch: v.number(),
    department: v.string(),
    designation: v.string(),
    company: v.string(),
    region: v.string(),
    /**
     * Where the member is now, in words: "Rajapalayam, Tamil Nadu, India".
     *
     * Distinct from `region`, which is one of nine coarse buckets the directory
     * filters on. This is the precise place, and it is what the browser detects
     * on sign-in when the member has consented; `region` is derived from it.
     *
     * WHICH COORDINATES ARE STORED, AND WHICH ARE NOT. The browser's own fix is
     * discarded inside the Convex action that receives it. What is kept below is
     * the centroid of the NAMED PLACE — the point Nominatim returns for
     * "Rajapalayam", not the point the device reported. That is what lets the
     * map plot a member at all, and it discloses nothing the label above does
     * not already say: everyone in the town shares one coordinate pair. A
     * device-precision trail is a movement history, and there still is not one
     * anywhere in this schema.
     */
    location: v.optional(v.string()),
    /** Centroid of `location`, as [lat, lng]. Town-level, never device-level. */
    locationLat: v.optional(v.number()),
    locationLng: v.optional(v.number()),
    /** Opt-in. False or absent means the browser is never asked for a fix. */
    locationConsent: v.optional(v.boolean()),
    locationUpdatedAt: v.optional(v.number()),
    /** `device` came from a consented browser fix; `manual` was typed. */
    locationSource: v.optional(v.union(v.literal("device"), v.literal("manual"))),
    /** Postal address. Never returned by directory.publicView. */
    address: v.optional(v.string()),
    /** The employer's primary domain, when the suggestion carried one. */
    companyDomain: v.optional(v.string()),
    /** Where they work — the office or city, not the same as `location`. */
    workLocation: v.optional(v.string()),
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
