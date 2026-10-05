import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireEmail } from "./authz";

/**
 * The connection graph — the thing that turns a directory into a network.
 *
 * A directory answers "who exists". A network answers "who will take my call",
 * and that is a different data structure: a mutual, accepted, two-party edge.
 * Everything here exists to make that edge real — request it, answer it,
 * withdraw it, and read the graph back as degrees and named mutuals.
 *
 * IDENTITY IS ALWAYS THE SESSION. No handler accepts the caller's own address as
 * an argument. See authz.ts for why comparing an argument against the session is
 * not good enough.
 *
 * NO EMAIL ADDRESS EVER LEAVES THIS MODULE.
 *
 * That constraint decides the whole public API, so it is worth being explicit
 * about. `alumni.email` is a contact detail, and module 2 makes contact details
 * opt-IN: `directory.publicView` withholds an address unless the member listed it
 * in `sharedFields`. If this module returned emails so the browser could name who
 * to connect to, every private address in the association would be one network
 * card away — and the opt-in would be decorative.
 *
 * So the client never handles an address. It handles:
 *   - an `alumniId`, to ask someone new to connect;
 *   - a `connectionId`, to answer, withdraw, remove, or open a thread.
 * Both are resolved to an address on the server. Emails are stored on the edge
 * because that is what keys a member across the rest of the schema, but they are
 * an implementation detail of the table, not part of its interface.
 *
 * WHY NAMED MUTUALS AND NOT "2nd degree". LinkedIn shows an abstract degree
 * because it has no shared context to offer beyond it. This association does:
 * two RIT graduates share a batch, a department, and usually a named person who
 * knows them both. `mutualNames` is what the UI puts on the card, because
 * "Priya '21 CSE knows you both" is the actual reason an introduction works and
 * "2nd" is not.
 */

export type ConnectionStatus = "pending" | "accepted" | "declined";

/** What the caller's relationship to another member is, from their side. */
export type EdgeState =
  | "self"
  | "none"
  | "connected"
  /** The caller sent it; it is waiting on the other member. */
  | "outgoing"
  /** The other member sent it; it is waiting on the caller. */
  | "incoming"
  /** The caller was declined, or declined them. Re-requestable. */
  | "declined";

const MAX_NOTE = 300;

/**
 * How many of the caller's own connections are walked to find mutuals.
 *
 * The walk is 2 + 2N indexed lookups, so it is bounded rather than free. Past
 * this ceiling the mutual names are incomplete, and every query that can be
 * truncated returns `mutualsComplete: false` so a page can say so instead of
 * quietly under-reporting who knows whom.
 */
const MAX_MUTUAL_WALK = 250;

/** Suggestions are a prompt, not a feed. */
const SUGGESTION_LIMIT = 12;

function normalise(email: string) {
  return email.trim().toLowerCase();
}

function preview(text: string, max = 140) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/* ------------------------------------------------------------------ */
/* Profile lookups                                                     */
/* ------------------------------------------------------------------ */

/**
 * The `alumni` table indexed both ways, from one scan.
 *
 * `alumni` carries no by_email index — the directory needs batch, department,
 * mentor and the name search index — so an address lookup is a scan. Doing it
 * once per request and reusing both maps is what keeps that honest, and it is the
 * same approach `mentoring.callerAlumnus` already takes.
 */
async function profileIndex(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("alumni").collect();
  const byEmail = new Map<string, Doc<"alumni">>();
  const byId = new Map<string, Doc<"alumni">>();
  for (const row of rows) {
    byId.set(row._id, row);
    const key = normalise(row.email);
    // First wins: nothing enforces one row per address, and the directory
    // already shows the first match, so agree with it rather than disagreeing.
    if (!byEmail.has(key)) byEmail.set(key, row);
  }
  return { byEmail, byId };
}

/* ------------------------------------------------------------------ */
/* Reading the graph                                                   */
/* ------------------------------------------------------------------ */

/** Every edge touching one address, in either direction. */
async function edgesFor(ctx: QueryCtx | MutationCtx, email: string) {
  const [asRequester, asRecipient] = await Promise.all([
    ctx.db
      .query("connections")
      .withIndex("by_requester", (q) => q.eq("requesterEmail", email))
      .collect(),
    ctx.db
      .query("connections")
      .withIndex("by_recipient", (q) => q.eq("recipientEmail", email))
      .collect(),
  ]);
  return [...asRequester, ...asRecipient];
}

/** The accepted neighbours of one address. */
async function neighboursOf(ctx: QueryCtx | MutationCtx, email: string) {
  const [asRequester, asRecipient] = await Promise.all([
    ctx.db
      .query("connections")
      .withIndex("by_requester", (q) =>
        q.eq("requesterEmail", email).eq("status", "accepted"),
      )
      .collect(),
    ctx.db
      .query("connections")
      .withIndex("by_recipient", (q) =>
        q.eq("recipientEmail", email).eq("status", "accepted"),
      )
      .collect(),
  ]);
  return new Set([
    ...asRequester.map((e) => normalise(e.recipientEmail)),
    ...asRecipient.map((e) => normalise(e.requesterEmail)),
  ]);
}

/**
 * The one edge between two addresses, whichever direction it was created in.
 *
 * Two point lookups rather than one, because a pending pair has no canonical
 * ordering — inventing one would mean `status` had to be read against a
 * direction the table does not record.
 */
async function edgeBetween(
  ctx: QueryCtx | MutationCtx,
  a: string,
  b: string,
): Promise<Doc<"connections"> | null> {
  const [forward, backward] = await Promise.all([
    ctx.db
      .query("connections")
      .withIndex("by_pair", (q) =>
        q.eq("requesterEmail", a).eq("recipientEmail", b),
      )
      .first(),
    ctx.db
      .query("connections")
      .withIndex("by_pair", (q) =>
        q.eq("requesterEmail", b).eq("recipientEmail", a),
      )
      .first(),
  ]);
  return forward ?? backward;
}

/** How `viewer` stands relative to `other`, read off one edge. */
function edgeState(
  edge: Doc<"connections"> | null,
  viewer: string,
  other: string,
): EdgeState {
  if (viewer === other) return "self";
  if (!edge) return "none";
  if (edge.status === "accepted") return "connected";
  if (edge.status === "declined") return "declined";
  return normalise(edge.requesterEmail) === viewer ? "outgoing" : "incoming";
}

/**
 * The public card for one member of the network.
 *
 * Deliberately carries no email address — see the module note. `alumniId` is the
 * handle for everything the client can do with this person, and it is null only
 * for a member who signed in but never filled in a directory profile. Those
 * members are unreachable by design: there is no surface that offers to connect
 * to someone who is not in the directory.
 */
function memberCard(profile: Doc<"alumni"> | undefined, fallbackName: string) {
  return {
    name: profile?.name ?? fallbackName,
    /** Null means this member has not filled in a directory profile yet. */
    alumniId: profile?._id ?? null,
    batch: profile?.batch ?? null,
    department: profile?.department ?? null,
    designation: profile?.designation ?? null,
    company: profile?.company ?? null,
    region: profile?.region ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    verified: profile?.verified ?? false,
    openToMentor: profile?.openToMentor ?? false,
    hasProfile: profile !== undefined,
  };
}

export type MemberCard = ReturnType<typeof memberCard>;

/**
 * A member who has signed in but has no directory row still has to be shown
 * *something*. The local part of their address is the least revealing label that
 * is still recognisable to the person who asked to connect to them — and it is
 * only ever reached for a pending or accepted edge, never for a stranger.
 */
function fallbackLabel(email: string) {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : "A member";
}

/* ------------------------------------------------------------------ */
/* Writes — the request lifecycle                                      */
/* ------------------------------------------------------------------ */

/**
 * Ask to connect, naming the member by their directory id.
 *
 * The id rather than an address, so the browser never needs to know the address
 * of someone it is asking to connect to — which is what lets a member keep their
 * email private and still be reachable. The address is resolved here.
 *
 * The interesting case is a crossing request: they already asked you, and before
 * answering you asked them. Two people who have each asked to be connected are,
 * by any reasonable reading, connected — so the crossing request accepts the
 * existing edge instead of writing a second one. Without that, the pair holds two
 * pending rows pointing opposite ways and both members wait for the other.
 */
export const requestConnection = mutation({
  args: {
    alumniId: v.id("alumni"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);

    const target = await ctx.db.get(args.alumniId);
    if (!target) {
      throw new ConvexError("That member is no longer in the directory.");
    }
    const them = normalise(target.email);
    if (!them) {
      throw new ConvexError(
        "That member's record has no address attached, so they cannot be reached yet.",
      );
    }
    if (them === me) {
      throw new ConvexError("You are already yourself.");
    }

    const note = args.note?.trim() ?? "";
    if (note.length > MAX_NOTE) {
      throw new ConvexError(
        `Keep the note under ${MAX_NOTE} characters — it is an introduction, not a letter.`,
      );
    }

    const existing = await edgeBetween(ctx, me, them);

    if (existing?.status === "accepted") {
      return { status: "accepted" as const, alreadyConnected: true };
    }

    if (existing?.status === "pending") {
      if (normalise(existing.requesterEmail) === me) {
        return { status: "pending" as const, alreadyConnected: false };
      }
      // Crossing request — see the note above.
      await ctx.db.patch(existing._id, {
        status: "accepted",
        respondedAt: Date.now(),
      });
      return { status: "accepted" as const, alreadyConnected: false };
    }

    if (existing?.status === "declined") {
      // Re-ask on the existing row so a pair never accumulates history rows.
      // Direction resets to the current asker, who may be whoever declined last
      // time.
      await ctx.db.patch(existing._id, {
        requesterEmail: me,
        recipientEmail: them,
        status: "pending",
        note: note.length > 0 ? note : undefined,
        createdAt: Date.now(),
        respondedAt: undefined,
      });
      return { status: "pending" as const, alreadyConnected: false };
    }

    await ctx.db.insert("connections", {
      requesterEmail: me,
      recipientEmail: them,
      status: "pending",
      note: note.length > 0 ? note : undefined,
      createdAt: Date.now(),
    });
    return { status: "pending" as const, alreadyConnected: false };
  },
});

/**
 * Accept or decline a request. Recipient only.
 *
 * Ownership is checked before the status, so a stranger holding an id learns
 * nothing about whether it is still open.
 */
export const respondToConnection = mutation({
  args: {
    connectionId: v.id("connections"),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    const edge = await ctx.db.get(args.connectionId);
    if (!edge) throw new ConvexError("That request no longer exists.");

    if (normalise(edge.recipientEmail) !== me) {
      throw new ConvexError(
        "That request was not sent to you, so it is not yours to answer.",
      );
    }
    if (edge.status !== "pending") {
      throw new ConvexError(
        edge.status === "accepted"
          ? "You are already connected."
          : "That request was already declined.",
      );
    }

    await ctx.db.patch(args.connectionId, {
      status: args.decision,
      respondedAt: Date.now(),
    });
    return { status: args.decision };
  },
});

/** Take back a request you sent. Requester only, and only while pending. */
export const withdrawConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    const edge = await ctx.db.get(args.connectionId);
    if (!edge) throw new ConvexError("That request no longer exists.");

    if (normalise(edge.requesterEmail) !== me) {
      throw new ConvexError("You can only withdraw a request you sent.");
    }
    if (edge.status !== "pending") {
      throw new ConvexError(
        "That request has already been answered. Remove the connection instead.",
      );
    }

    // Deleted rather than flagged: a withdrawn request should leave no trace on
    // the recipient's side, and `declined` already means "answered, and no".
    await ctx.db.delete(args.connectionId);
    return { withdrawn: true };
  },
});

/**
 * Disconnect. Either party, and only once accepted.
 *
 * The row is deleted rather than set back to `declined`, because `declined` means
 * a request was refused and this is not that — keeping the distinction is what
 * lets either member ask again cleanly later. The message thread survives:
 * `messaging.ts` closes its composer but keeps the history readable to both.
 */
export const removeConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, args) => {
    const me = await requireEmail(ctx);
    const edge = await ctx.db.get(args.connectionId);
    if (!edge) throw new ConvexError("That connection no longer exists.");

    const mine =
      normalise(edge.requesterEmail) === me ||
      normalise(edge.recipientEmail) === me;
    if (!mine) {
      throw new ConvexError("That is not your connection to remove.");
    }
    if (edge.status !== "accepted") {
      throw new ConvexError("You are not connected, so there is nothing to remove.");
    }

    await ctx.db.delete(args.connectionId);
    return { removed: true };
  },
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Everything the /network page needs, in one subscription.
 *
 * One query rather than four so the three lists can never render out of step
 * with each other — an accepted request has to leave "requests" and arrive in
 * "connections" in the same frame, or the member sees it twice.
 */
export const myNetwork = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmail(ctx);
    const [edges, profiles] = await Promise.all([
      edgesFor(ctx, me),
      profileIndex(ctx),
    ]);

    const connections: Array<{
      connectionId: Id<"connections">;
      member: MemberCard;
      since: number;
      /** True when they asked you, which is worth remembering. */
      theyAsked: boolean;
    }> = [];
    const incoming: Array<{
      connectionId: Id<"connections">;
      member: MemberCard;
      note: string | null;
      askedAt: number;
    }> = [];
    const outgoing: Array<{
      connectionId: Id<"connections">;
      member: MemberCard;
      note: string | null;
      askedAt: number;
    }> = [];

    for (const edge of edges) {
      const requester = normalise(edge.requesterEmail);
      const recipient = normalise(edge.recipientEmail);
      const other = requester === me ? recipient : requester;
      const member = memberCard(profiles.byEmail.get(other), fallbackLabel(other));

      if (edge.status === "accepted") {
        connections.push({
          connectionId: edge._id,
          member,
          since: edge.respondedAt ?? edge.createdAt,
          theyAsked: requester !== me,
        });
      } else if (edge.status === "pending") {
        const row = {
          connectionId: edge._id,
          member,
          note: edge.note ?? null,
          askedAt: edge.createdAt,
        };
        if (requester === me) outgoing.push(row);
        else incoming.push(row);
      }
      // `declined` is intentionally absent. A refused request is not a list the
      // portal should invite either member to re-read.
    }

    connections.sort((a, b) => b.since - a.since);
    incoming.sort((a, b) => b.askedAt - a.askedAt);
    outgoing.sort((a, b) => b.askedAt - a.askedAt);

    return {
      connections,
      incoming,
      outgoing,
      counts: {
        connections: connections.length,
        incoming: incoming.length,
        outgoing: outgoing.length,
      },
    };
  },
});

/**
 * Just the number for the header badge.
 *
 * Separate from `myNetwork` so a signed-in member on any page subscribes to one
 * integer instead of to their whole graph.
 */
export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmail(ctx);
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_recipient", (q) =>
        q.eq("recipientEmail", me).eq("status", "pending"),
      )
      .collect();
    return rows.length;
  },
});

/**
 * The caller's relationship to each of a list of directory rows.
 *
 * This is what lets the directory render the right button on every card from a
 * single subscription. The caller's whole graph is read once and the answers come
 * out of memory, so cost is independent of how many rows are on screen.
 *
 * Keyed by `alumniId`, both in and out — the browser is looking at directory
 * rows, and it must not need an address to ask about one.
 *
 * Returns the empty shape for a signed-out caller rather than throwing: the
 * directory is readable without an account, and a thrown query would take the
 * whole page down instead of hiding one button.
 */
export const edgeStates = query({
  args: { alumniIds: v.array(v.id("alumni")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.email ? normalise(identity.email) : null;

    // Every branch returns the same shape, so a caller never has to narrow on
    // whether a session existed before reading a field.
    const states: Record<string, EdgeState> = {};
    const connectionIds: Record<string, Id<"connections">> = {};
    const mutualNames: Record<string, string[]> = {};

    if (!me || args.alumniIds.length === 0) {
      return { signedIn: false, states, connectionIds, mutualNames, mutualsComplete: true };
    }

    const [edges, profiles] = await Promise.all([
      edgesFor(ctx, me),
      profileIndex(ctx),
    ]);

    /** email → the edge between us, for the rows actually on screen. */
    const edgeByEmail = new Map<string, Doc<"connections">>();
    const direct = new Set<string>();
    for (const edge of edges) {
      const requester = normalise(edge.requesterEmail);
      const recipient = normalise(edge.recipientEmail);
      const other = requester === me ? recipient : requester;
      edgeByEmail.set(other, edge);
      if (edge.status === "accepted") direct.add(other);
    }

    /** The addresses behind the ids asked about, kept server-side. */
    const wanted = new Map<string, string>();
    for (const alumniId of args.alumniIds) {
      const profile = profiles.byId.get(alumniId);
      if (!profile) continue;
      const email = normalise(profile.email);
      if (!email || email === me) {
        states[alumniId] = email === me ? "self" : "none";
        continue;
      }
      wanted.set(alumniId, email);

      const edge = edgeByEmail.get(email) ?? null;
      states[alumniId] = edgeState(edge, me, email);
      if (edge) connectionIds[alumniId] = edge._id;
    }

    // Mutuals only for rows that are not already first-degree — a mutual is
    // meaningless for someone you already know.
    const needMutuals = [...wanted].filter(([, email]) => !direct.has(email));
    let mutualsComplete = true;

    if (needMutuals.length > 0 && direct.size > 0) {
      const walk = [...direct].slice(0, MAX_MUTUAL_WALK);
      mutualsComplete = walk.length === direct.size;

      const neighbourSets = await Promise.all(
        walk.map(async (friend) => ({
          name: profiles.byEmail.get(friend)?.name ?? fallbackLabel(friend),
          neighbours: await neighboursOf(ctx, friend),
        })),
      );

      for (const [alumniId, email] of needMutuals) {
        const names = neighbourSets
          .filter((entry) => entry.neighbours.has(email))
          .map((entry) => entry.name)
          .sort();
        if (names.length > 0) mutualNames[alumniId] = names;
      }
    }

    return { signedIn: true, states, connectionIds, mutualNames, mutualsComplete };
  },
});

/**
 * The full relationship between the caller and one member, for a profile page.
 *
 * `degree` is the honest three-state answer: first when there is an accepted
 * edge, second when a mutual connection exists, and null when neither — which is
 * not "third", because this walk does not look that far and reporting a degree it
 * never measured would be a guess.
 */
export const profileEdge = query({
  /*
   * `v.string()` and not `v.id("alumni")`, because this id arrives from a URL
   * segment. A malformed segment would fail argument validation, and a Convex
   * argument error reaches the browser as a thrown exception inside the React
   * render — taking the whole profile route down instead of showing a
   * "no such member" page. `normalizeId` returns null for anything that is not a
   * well-formed id for this table, which is the same shape as "not found".
   * `raceProfiles.byId` does this for the same reason.
   */
  args: { alumniId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.email ? normalise(identity.email) : null;

    const id = ctx.db.normalizeId("alumni", args.alumniId.trim());
    const target = id ? await ctx.db.get(id) : null;
    const them = target ? normalise(target.email) : null;

    const empty = {
      signedIn: me !== null,
      state: "none" as EdgeState,
      connectionId: null as Id<"connections"> | null,
      degree: null as 1 | 2 | null,
      mutualNames: [] as string[],
      mutualsComplete: true,
      theirConnectionCount: null as number | null,
    };

    if (!them) return empty;

    // Published the way a directory publishes a batch: a count, never a list.
    const theirNeighbours = await neighboursOf(ctx, them);
    if (!me) return { ...empty, theirConnectionCount: theirNeighbours.size };

    const edge = await edgeBetween(ctx, me, them);
    const state = edgeState(edge, me, them);

    let degree: 1 | 2 | null = null;
    const mutualNames: string[] = [];
    let mutualsComplete = true;

    if (state === "connected") {
      degree = 1;
    } else if (state !== "self") {
      const myNeighbours = await neighboursOf(ctx, me);
      const walk = [...myNeighbours].slice(0, MAX_MUTUAL_WALK);
      mutualsComplete = walk.length === myNeighbours.size;

      const shared = walk.filter((email) => theirNeighbours.has(email));
      if (shared.length > 0) {
        degree = 2;
        const profiles = await profileIndex(ctx);
        for (const email of shared) {
          mutualNames.push(
            profiles.byEmail.get(email)?.name ?? fallbackLabel(email),
          );
        }
        mutualNames.sort();
      }
    }

    return {
      signedIn: true,
      state,
      connectionId: edge?._id ?? null,
      degree,
      mutualNames,
      mutualsComplete,
      theirConnectionCount: theirNeighbours.size,
    };
  },
});

/**
 * People you may know.
 *
 * Ranked by the things two RIT graduates actually share, strongest first: batch
 * and department together, then employer, then batch, then department, then
 * region. That order is the point — an abstract similarity score would rank the
 * same people without being able to tell the member *why*, and the reason is what
 * makes a request land. Every row carries its own `reason`.
 *
 * Anyone already on an edge is excluded, declined included, so the portal does
 * not keep proposing someone who has already said no.
 */
export const suggestions = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmail(ctx);
    const [edges, profiles, allEdges] = await Promise.all([
      edgesFor(ctx, me),
      profileIndex(ctx),
      ctx.db.query("connections").collect(),
    ]);

    const exclude = new Set<string>([me]);
    for (const edge of edges) {
      exclude.add(normalise(edge.requesterEmail));
      exclude.add(normalise(edge.recipientEmail));
    }

    const mine = profiles.byEmail.get(me);
    if (!mine) {
      // No profile means nothing to match on. Say so rather than returning an
      // arbitrary slice of the membership.
      return { needsProfile: true as const, rows: [] };
    }

    /* ---- The friend-of-a-friend layer -------------------------------- */

    /*
     * Who each member is connected to, built once from the accepted edges.
     *
     * This is the most predictive signal a network has: two people with four
     * connections in common usually already know each other, whatever their
     * batch says. It costs one read of the connections table -- the same read
     * `networkStats` already does -- and replaces a query per candidate.
     */
    const neighbours = new Map<string, Set<string>>();
    for (const edge of allEdges) {
      if (edge.status !== "accepted") continue;
      const a = normalise(edge.requesterEmail);
      const b = normalise(edge.recipientEmail);
      let forA = neighbours.get(a);
      if (!forA) {
        forA = new Set();
        neighbours.set(a, forA);
      }
      let forB = neighbours.get(b);
      if (!forB) {
        forB = new Set();
        neighbours.set(b, forB);
      }
      forA.add(b);
      forB.add(a);
    }
    const myCircle = neighbours.get(me) ?? new Set<string>();

    /* ---- Normalising the things we compare --------------------------- */

    const lower = (value: string | undefined) => (value ?? "").trim().toLowerCase();
    const myCompany = lower(mine.company);
    const myWorkLocation = lower(mine.workLocation);
    const myRegion = lower(mine.region);
    const myLocation = lower(mine.location);
    const mySkills = new Set(
      (mine.skills ?? []).map((skill) => lower(skill)).filter(Boolean),
    );
    const myIndustries = new Set(
      (mine.industries ?? []).map((industry) => lower(industry)).filter(Boolean),
    );

    /**
     * The scoring model, and why it adds rather than chooses.
     *
     * The previous version was a ladder of `else if`, so exactly one fact about
     * a candidate ever counted. That produced a specific wrong answer: somebody
     * in your department, in your city, with three connections in common scored
     * below a stranger who merely shared your graduating year -- "same batch"
     * sat higher on the ladder and the rest was never read. Similarity is
     * cumulative in life, so it is cumulative here.
     *
     * The weights are ordered by how strongly each signal predicts that two
     * members actually want to meet:
     *
     *   mutual connections   the strongest, and the only one earned rather
     *                        than declared. Damped with a square root so one
     *                        very well-connected member does not fill the list.
     *   batch + department   a classmate: the people you sat with for four
     *                        years, and the best cold introduction there is.
     *   department, a year    either side of your batch -- the senior who was
     *                        there when you arrived, the junior who was there
     *                        when you left. Real, and previously invisible.
     *   same employer        a colleague, worth a connection even across
     *                        batches and departments.
     *   skills / industries  what you would actually talk about. Counted per
     *                        overlap and capped, so a member who lists twenty
     *                        skills cannot outrank a genuine classmate.
     *   place                the weakest, because a city is not a relationship.
     *
     * Nothing is dropped for having no signal at all any more; a member scoring
     * zero simply sorts last, which matters on a young deployment where most
     * people have not yet filled in enough to match on.
     */
    const scored: Array<{
      member: MemberCard;
      score: number;
      reason: string;
      mutuals: number;
    }> = [];

    for (const [email, profile] of profiles.byEmail) {
      if (exclude.has(email)) continue;

      /* -- Signals ---------------------------------------------------- */
      const theirCircle = neighbours.get(email);
      let mutuals = 0;
      if (theirCircle) {
        // Walk the smaller set, so this stays cheap against a hub member.
        const small = myCircle.size <= theirCircle.size ? myCircle : theirCircle;
        const large = myCircle.size <= theirCircle.size ? theirCircle : myCircle;
        for (const entry of small) if (large.has(entry)) mutuals += 1;
      }

      const sameBatch = profile.batch > 0 && profile.batch === mine.batch;
      const yearGap =
        profile.batch > 0 && mine.batch > 0
          ? Math.abs(profile.batch - mine.batch)
          : Number.POSITIVE_INFINITY;
      const sameDept =
        profile.department.length > 0 && profile.department === mine.department;
      const sameCompany = myCompany.length > 0 && lower(profile.company) === myCompany;
      const sameWorkLocation =
        myWorkLocation.length > 0 && lower(profile.workLocation) === myWorkLocation;
      const samePlace =
        (myRegion.length > 0 && lower(profile.region) === myRegion) ||
        (myLocation.length > 0 && lower(profile.location) === myLocation);

      let sharedSkills = 0;
      for (const skill of profile.skills ?? []) {
        if (mySkills.has(lower(skill))) sharedSkills += 1;
      }
      let sharedIndustries = 0;
      for (const industry of profile.industries ?? []) {
        if (myIndustries.has(lower(industry))) sharedIndustries += 1;
      }

      /* -- Weights ---------------------------------------------------- */
      let score = 0;
      if (mutuals > 0) score += 4 * Math.sqrt(mutuals);

      if (sameBatch && sameDept) score += 6;
      else if (sameDept && yearGap <= 1) score += 4;
      else if (sameBatch) score += 3;
      else if (sameDept) score += 2.5;
      else if (yearGap <= 1) score += 1;

      if (sameCompany) score += 3.5;
      if (sameWorkLocation && !sameCompany) score += 1.5;
      // Capped at two apiece: overlap is a hint, not a ranking of its own.
      score += Math.min(sharedSkills, 2) * 0.75;
      score += Math.min(sharedIndustries, 2) * 0.5;
      if (samePlace) score += 1;

      // A verified member is a safer first introduction than an unverified one.
      if (profile.verified) score += 0.5;
      // Somebody open to mentoring has said they want to be approached.
      if (profile.openToMentor) score += 0.5;

      /*
       * The reason names the strongest thing the two of you have in common, in
       * the order a person would say it out loud. Mutuals lead wherever there
       * are any, because "three connections in common" is the sentence that
       * actually persuades somebody to press connect.
       */
      const sharedSkillName = (profile.skills ?? []).find((skill) =>
        mySkills.has(lower(skill)),
      );
      const sharedIndustryName = (profile.industries ?? []).find((industry) =>
        myIndustries.has(lower(industry)),
      );

      let reason: string;
      if (mutuals > 0) {
        const shared =
          mutuals === 1 ? "1 connection in common" : mutuals + " connections in common";
        if (sameBatch && sameDept) {
          reason = shared + " \u00b7 " + profile.batch + " batch, same department";
        } else if (sameDept) {
          reason = shared + " \u00b7 also " + profile.department;
        } else if (sameCompany) {
          reason = shared + " \u00b7 also at " + profile.company;
        } else {
          reason = shared;
        }
      } else if (sameBatch && sameDept) {
        reason = profile.department + " \u00b7 " + profile.batch + " batch, same as you";
      } else if (sameDept && yearGap <= 1) {
        reason =
          profile.batch > mine.batch
            ? profile.department + ", the batch below you"
            : profile.department + ", the batch above you";
      } else if (sameCompany) {
        reason = "Also at " + profile.company;
      } else if (sameBatch) {
        reason = profile.batch + " batch, same as you";
      } else if (sharedSkillName) {
        reason = "Also works in " + sharedSkillName;
      } else if (sameDept) {
        reason = "Also " + profile.department;
      } else if (sharedIndustryName) {
        reason = "Also in " + sharedIndustryName;
      } else if (sameWorkLocation) {
        reason = "Also works in " + profile.workLocation;
      } else if (samePlace) {
        reason = "Also in " + (profile.region || profile.location);
      } else {
        reason = "From the association";
      }

      scored.push({
        member: memberCard(profile, profile.name),
        score,
        reason,
        mutuals,
      });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        b.mutuals - a.mutuals ||
        // Then the more recent batch, then alphabetical, so the list is stable
        // between reads rather than reshuffling on every reconnect.
        (b.member.batch ?? 0) - (a.member.batch ?? 0) ||
        a.member.name.localeCompare(b.member.name),
    );

    return {
      needsProfile: false as const,
      rows: scored.slice(0, SUGGESTION_LIMIT).map((row) => ({
        member: row.member,
        reason: row.reason,
        mutuals: row.mutuals,
      })),
    };
  },
});

/**
 * Association-wide network figures.
 *
 * Counts only — no address, no name, no single edge — so this stays readable
 * without a session, which is what lets the homepage show that the network is
 * alive before anyone signs in.
 */
export const networkStats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("connections").collect();
    const accepted = rows.filter((r) => r.status === "accepted");

    const degree = new Map<string, number>();
    for (const edge of accepted) {
      for (const email of [
        normalise(edge.requesterEmail),
        normalise(edge.recipientEmail),
      ]) {
        degree.set(email, (degree.get(email) ?? 0) + 1);
      }
    }

    const degrees = [...degree.values()];
    return {
      connections: accepted.length,
      membersConnected: degree.size,
      pending: rows.filter((r) => r.status === "pending").length,
      /** Null rather than 0 — "nobody has connected yet" is not an average. */
      averageConnections:
        degrees.length > 0
          ? Math.round(
              (degrees.reduce((s, n) => s + n, 0) / degrees.length) * 10,
            ) / 10
          : null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Shared with messaging.ts                                            */
/* ------------------------------------------------------------------ */

/** True when an accepted edge still exists between two addresses. */
export async function areConnected(
  ctx: QueryCtx | MutationCtx,
  a: string,
  b: string,
) {
  const edge = await edgeBetween(ctx, normalise(a), normalise(b));
  return edge?.status === "accepted";
}

/**
 * Loads an accepted edge the caller is party to, and returns the other side's
 * address. This is how messaging opens a thread without the browser ever naming
 * an address.
 */
export async function counterpartOf(
  ctx: QueryCtx | MutationCtx,
  connectionId: Id<"connections">,
  me: string,
) {
  const edge = await ctx.db.get(connectionId);
  if (!edge) throw new ConvexError("That connection no longer exists.");

  const requester = normalise(edge.requesterEmail);
  const recipient = normalise(edge.recipientEmail);
  if (requester !== me && recipient !== me) {
    throw new ConvexError("That is not your connection.");
  }
  if (edge.status !== "accepted") {
    throw new ConvexError(
      "Messaging opens once the request is accepted by both sides.",
    );
  }
  return requester === me ? recipient : requester;
}

export { fallbackLabel, normalise, preview, profileIndex };
