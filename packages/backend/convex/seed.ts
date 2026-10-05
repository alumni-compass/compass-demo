import { internalMutation } from "./_generated/server";

/**
 * Seeds the portal with REAL RITAA content only.
 *
 * Run with:  npx convex run seed:run
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS REAL HERE
 *
 * Only two sources are trusted:
 *   1. The RITAA website requirement brief (the association's own document) —
 *      its contact table gives three office bearers with designations, emails
 *      and phone numbers, plus the association's address and founding year.
 *   2. ritrjpm.ac.in — the college's own site, which is where the crest and the
 *      convocation photographs in apps/web/public came from.
 *
 * Everything else is left EMPTY on purpose. An earlier version of this file
 * seeded 28 invented alumni, 10 invented ventures, 8 invented job posts, 6
 * invented events, 7 invented articles and ~₹26 lakh of invented donations. It
 * looked convincing, which was exactly the problem: nothing distinguished it
 * from real member records, and three of those "alumni" were real named people
 * from the brief with fabricated employers and biographies attached.
 *
 * So the directory, careers board, mentorship roster, RACE feed, events
 * calendar, stories and campaigns all start empty and show their empty states
 * until the association enters real data. That is the correct starting point for
 * a portal that will hold real people's records.
 *
 * DO NOT add plausible-looking filler to this file. If a demo needs populating,
 * add a separate `demoSeed` mutation whose records are unmistakably labelled as
 * samples, and never attach invented details to a real person's name.
 * ---------------------------------------------------------------------------
 */

/**
 * The three office bearers named in the brief's contact table.
 *
 * Only the fields the brief actually states are filled in. Batch, department,
 * employer and biography are unknown to us, so they stay blank for the member to
 * complete from /profile — the association can also fill them in directly.
 */
const OFFICE_BEARERS = [
  {
    name: "Arunprasanth",
    designation: "Secretary, RITAA",
    email: "alumni@ritrjpm.ac.in",
    phone: "+91 70949 94736",
  },
  {
    name: "Thojesh Nandha",
    designation: "Vice President, RITAA",
    email: "Pro.alumni@ritrjpm.ac.in",
    phone: "+91 93841 91645",
  },
  {
    name: "Jothi Krishna",
    designation: "Coordinator - RACE",
    email: "race@ritrjpm.ac.in",
    phone: "+91 75988 59516",
  },
] as const;

/**
 * Photograph albums built from the college's own convocation images.
 *
 * The files are real and served from apps/web/public. Titles describe what the
 * photographs actually show — a convocation on the Rajapalayam campus — and
 * carry no invented attendance figures or dates.
 */
const ALBUMS = [
  {
    title: "Convocation — Rajapalayam campus",
    year: new Date("2025-01-01").getUTCFullYear(),
    eventName: "Convocation",
    coverUrl: "/campus-1.jpg",
    imageUrls: ["/campus-1.jpg", "/campus-2.jpg", "/campus-3.jpg"],
  },
  {
    title: "Degree day — graduating cohort",
    year: new Date("2025-01-01").getUTCFullYear(),
    eventName: "Convocation",
    coverUrl: "/campus-4.jpg",
    imageUrls: ["/campus-4.jpg", "/campus-5.jpg", "/campus-6.jpg"],
  },
];

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Clear everything this seed owns. The transactional tables are then left
    // empty rather than repopulated.
    for (const table of [
      "alumni",
      "events",
      "eventRsvps",
      "jobs",
      "mentorshipRequests",
      "stories",
      "albums",
      "campaigns",
      "donations",
      "ventures",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    }

    const now = Date.now();

    for (const person of OFFICE_BEARERS) {
      await ctx.db.insert("alumni", {
        name: person.name,
        email: person.email,
        phone: person.phone,
        // Unknown from the brief. 0 marks "not recorded" rather than guessing a
        // year; the profile editor asks the member for the real one.
        batch: 0,
        department: "",
        designation: person.designation,
        company: "",
        region: "Rajapalayam",
        skills: [],
        industries: [],
        bio: "Office bearer of the alumni association. Profile details to be completed by the member.",
        // Contact details for office bearers are published in the association's
        // own brief, so sharing them here matches what the association already
        // publishes. Every other member starts fully private.
        sharedFields: ["email", "phone"],
        verified: true,
        featured: false,
        openToMentor: false,
        joinedAt: now,
      });
    }

    for (const album of ALBUMS) {
      await ctx.db.insert("albums", album);
    }

    return {
      officeBearers: OFFICE_BEARERS.length,
      albums: ALBUMS.length,
      note: "Directory, careers, mentorship, RACE, events, stories and campaigns are intentionally empty — no invented records.",
    };
  },
});
