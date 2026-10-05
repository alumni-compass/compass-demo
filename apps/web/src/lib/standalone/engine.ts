import { createState, NOW } from "./data";
import { currentEmail } from "./session";
import { ConvexError, type Alumni, type PortalState, type Role } from "./types";

type StoreBox = {
  state: PortalState;
  listeners: Set<() => void>;
  seq: number;
};

const STORE_KEY = "__ritaaStandaloneStore";

/** One box on globalThis so client chunks share the same sample data. */
function store(): StoreBox {
  const host = globalThis as typeof globalThis & { [STORE_KEY]?: StoreBox };
  if (!host[STORE_KEY]) {
    host[STORE_KEY] = { state: createState(), listeners: new Set(), seq: 100 };
  }
  return host[STORE_KEY];
}

function nid(prefix: string) {
  const box = store();
  box.seq += 1;
  return `${prefix}_${box.seq}`;
}

export function getState() {
  return store().state;
}

export function subscribeState(listener: () => void) {
  const box = store();
  box.listeners.add(listener);
  return () => box.listeners.delete(listener);
}

function commit(next: PortalState) {
  const box = store();
  box.state = next;
  for (const listener of box.listeners) listener();
}

function emailOf(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function me() {
  return currentEmail();
}

function alumnusByEmail(data: PortalState, email: string | null) {
  if (!email) return null;
  return data.alumni.find((row) => emailOf(row.email) === email) ?? null;
}

function alumnusById(data: PortalState, id: string) {
  return data.alumni.find((row) => row._id === id) ?? null;
}

function roleForEmail(data: PortalState, email: string | null): { role: Role; source: string } {
  if (!email) return { role: "guest", source: "no-session" };
  const assigned = data.roles.find((row) => row.email === email);
  if (assigned) return { role: assigned.role, source: "assigned" };
  const venture = data.ventures.find(
    (row) => emailOf(row.founderEmail) === email && row.approved,
  );
  if (venture) return { role: "entrepreneur", source: "venture" };
  const request = data.verifications.find((row) => emailOf(row.email) === email);
  if (request?.status === "approved") return { role: "alumni", source: "verified" };
  const profile = alumnusByEmail(data, email);
  if (profile?.verified) return { role: "alumni", source: "verified" };
  return { role: "guest", source: "unverified" };
}

function isAdmin(data: PortalState) {
  return roleForEmail(data, me()).role === "admin";
}

function publicAlumni(row: Alumni) {
  const hidden = new Set(row.hiddenFields ?? []);
  const shared = new Set(row.sharedFields ?? []);
  const isShared = (field: string) => shared.has(field) && !hidden.has(field);
  return {
    _id: row._id,
    name: row.name,
    batch: row.batch,
    department: row.department,
    designation: row.designation,
    company: hidden.has("company") ? null : row.company,
    region: hidden.has("region") ? null : row.region,
    email: isShared("email") ? row.email : null,
    phone: isShared("phone") ? (row.phone ?? null) : null,
    skills: row.skills,
    industries: row.industries,
    bio: row.bio ?? null,
    avatarUrl: row.avatarUrl ?? null,
    linkedinUrl: isShared("linkedinUrl") ? (row.linkedinUrl ?? null) : null,
    verified: row.verified,
    featured: row.featured,
    openToMentor: row.openToMentor,
    mentorTopics: row.mentorTopics ?? [],
  };
}

function memberCard(row: Alumni | null | undefined, fallback = "Member") {
  return {
    name: row?.name ?? fallback,
    alumniId: row?._id ?? null,
    batch: row?.batch ?? null,
    department: row?.department ?? null,
    designation: row?.designation ?? null,
    company: row?.company ?? null,
    region: row?.region ?? null,
    avatarUrl: row?.avatarUrl ?? null,
    verified: row?.verified ?? false,
    openToMentor: row?.openToMentor ?? false,
    hasProfile: row !== null && row !== undefined,
  };
}

function authorCard(data: PortalState, email: string) {
  const row = alumnusByEmail(data, emailOf(email));
  return {
    name: row?.name ?? email.split("@")[0],
    alumniId: row?._id ?? null,
    batch: row?.batch ?? null,
    department: row?.department ?? null,
    designation: row?.designation ?? null,
    company: row?.company ?? null,
    avatarUrl: row?.avatarUrl ?? null,
    verified: row?.verified ?? false,
  };
}

function edgeBetween(data: PortalState, a: string, b: string) {
  return (
    data.connections.find((row) => {
      const left = emailOf(row.requesterEmail);
      const right = emailOf(row.recipientEmail);
      return (left === a && right === b) || (left === b && right === a);
    }) ?? null
  );
}

function edgeState(edge: any, viewer: string, other: string) {
  if (viewer === other) return "self";
  if (!edge) return "none";
  if (edge.status === "accepted") return "connected";
  if (edge.status === "declined") return "declined";
  return emailOf(edge.requesterEmail) === viewer ? "outgoing" : "incoming";
}

function neighbours(data: PortalState, email: string) {
  const set = new Set<string>();
  for (const edge of data.connections) {
    if (edge.status !== "accepted") continue;
    const a = emailOf(edge.requesterEmail);
    const b = emailOf(edge.recipientEmail);
    if (a === email) set.add(b);
    if (b === email) set.add(a);
  }
  return set;
}

function searchAlumni(data: PortalState, args: any) {
  const text = String(args?.text ?? "").trim().toLowerCase();
  const limit = args?.limit ?? 60;
  return data.alumni
    .filter((row) => {
      if (args?.batch !== undefined && row.batch !== args.batch) return false;
      if (args?.department && row.department !== args.department) return false;
      if (args?.region && row.region !== args.region) return false;
      if (args?.company && row.company !== args.company) return false;
      if (text && !row.name.toLowerCase().includes(text)) return false;
      return true;
    })
    .sort((a, b) => b.batch - a.batch || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(publicAlumni);
}

function withAttendance(data: PortalState, event: any) {
  const going = data.rsvps.filter((row) => row.eventId === event._id && row.status === "going");
  const attending = going.reduce((sum: number, row: any) => sum + 1 + row.guests, 0);
  return {
    ...event,
    attending,
    seatsLeft: event.capacity ? Math.max(0, event.capacity - attending) : null,
  };
}

function listEvents(data: PortalState, window?: string) {
  const published = data.events.filter((row) => row.published);
  const rows =
    window === "past"
      ? published.filter((row) => row.startsAt < NOW).sort((a, b) => b.startsAt - a.startsAt)
      : window === "upcoming"
        ? published.filter((row) => row.startsAt >= NOW).sort((a, b) => a.startsAt - b.startsAt)
        : [...published].sort((a, b) => a.startsAt - b.startsAt);
  return rows.map((row) => withAttendance(data, row));
}

function campaignView(row: any) {
  const allocated = (row.allocations ?? []).reduce((sum: number, line: any) => sum + line.amountInr, 0);
  return {
    ...row,
    progress: row.goalInr > 0 ? Math.min(1, row.raisedInr / row.goalInr) : 0,
    allocated,
  };
}

function standingOf(row: any) {
  if (!row) return "guest";
  if (row.status === "pending") return "pending";
  if (row.status === "declined") return "declined";
  if (row.status === "removed") return "removed";
  return row.role;
}

function membership(data: PortalState, communityId: string, email: string | null) {
  if (!email) return null;
  return (
    data.communityMembers.find(
      (row) => row.communityId === communityId && emailOf(row.email) === email,
    ) ?? null
  );
}

function communityCard(data: PortalState, row: any, email: string | null) {
  const mine = membership(data, row._id, email);
  const creator = alumnusByEmail(data, emailOf(row.createdByEmail));
  return {
    _id: row._id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    description: row.description,
    visibility: row.visibility,
    scopeBatch: row.scopeBatch ?? null,
    scopeDepartment: row.scopeDepartment ?? null,
    memberCount: row.memberCount,
    postCount: row.postCount,
    createdAt: row.createdAt,
    createdByName: creator?.name ?? row.createdByEmail,
    standing: standingOf(mine),
    state: row.status ?? "approved",
    reviewNote: row.reviewNote ?? null,
  };
}

function decoratePost(data: PortalState, post: any, email: string | null) {
  const quoted = post.sharedFromId
    ? data.posts.find((row) => row._id === post.sharedFromId)
    : null;
  let poll = null as any;
  if (post.kind === "poll") {
    const question = data.questions.find((row) => row.postId === post._id && row.scope === "poll");
    if (question) {
      const votes = data.answers.filter((row) => row.questionId === question._id);
      const total = votes.length;
      poll = {
        questionId: question._id,
        prompt: question.prompt,
        options: question.options.map((label: string) => {
          const count = votes.filter((row) => row.answer === label).length;
          return { label, votes: count, share: total > 0 ? count / total : 0 };
        }),
        totalVotes: total,
        myAnswer: email ? (votes.find((row) => emailOf(row.email) === email)?.answer ?? null) : null,
      };
    }
  }
  return {
    _id: post._id,
    body: post.body,
    kind: post.kind,
    imageUrls: post.imageUrls ?? [],
    videoUrls: post.videoUrls ?? [],
    likeCount: post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    shareCount: post.shareCount ?? 0,
    sharedFrom: quoted
      ? {
          _id: quoted._id,
          body: quoted.body,
          imageUrls: quoted.imageUrls ?? [],
          videoUrls: quoted.videoUrls ?? [],
          createdAt: quoted.createdAt,
          author: authorCard(data, quoted.authorEmail),
        }
      : null,
    sharedFromMissing: Boolean(post.sharedFromId) && !quoted,
    createdAt: post.createdAt,
    editedAt: post.editedAt ?? null,
    hidden: post.hidden ?? false,
    hiddenReason: post.hiddenReason ?? null,
    communityId: post.communityId ?? null,
    author: authorCard(data, post.authorEmail),
    likedByMe: email
      ? data.likes.some((row) => row.postId === post._id && emailOf(row.email) === email)
      : false,
    isMine: email !== null && emailOf(post.authorEmail) === email,
    poll,
  };
}

function rsvpSummary(data: PortalState, eventId: string) {
  const event = data.events.find((row) => row._id === eventId);
  const rows = data.rsvps.filter((row) => row.eventId === eventId);
  const going = rows.filter((row) => row.status === "going");
  const maybe = rows.filter((row) => row.status === "maybe");
  const cancelled = rows.filter((row) => row.status === "cancelled");
  const guests = going.reduce((sum: number, row: any) => sum + row.guests, 0);
  const headcount = going.length + guests;
  const capacity = event?.capacity ?? null;
  return {
    responses: rows.length,
    going: going.length,
    maybe: maybe.length,
    cancelled: cancelled.length,
    guests,
    headcount,
    headcountIfMaybes: headcount + maybe.reduce((sum: number, row: any) => sum + 1 + row.guests, 0),
    capacity,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - headcount),
  };
}

function decorateMentorship(data: PortalState, row: any) {
  const mentor = alumnusById(data, row.mentorId);
  const allowed: Record<string, string[]> = {
    requested: ["accepted", "declined"],
    accepted: ["completed", "declined"],
    completed: [],
    declined: [],
  };
  return {
    ...row,
    mentorName: mentor?.name ?? "Mentor no longer listed",
    mentorDepartment: mentor?.department ?? null,
    mentorBatch: mentor?.batch ?? null,
    mentorCompany: mentor?.company ?? null,
    mentorTopics: mentor?.mentorTopics ?? [],
    preferredSlot: row.preferredSlot ?? null,
    feedbackRating: row.feedbackRating ?? null,
    feedbackNote: row.feedbackNote ?? null,
    awaitingMentor: row.status === "requested",
    feedbackOpen: row.status === "completed" && row.feedbackRating === undefined,
    hasFeedback: row.feedbackRating !== undefined,
    nextStatuses: allowed[row.status] ?? [],
  };
}

function founderSummary(row: any) {
  return {
    ventureId: row._id,
    founderName: row.founderName,
    founderEmail: row.founderEmail,
    founderBatch: row.founderBatch ?? null,
    businessName: row.businessName,
    category: row.category,
    location: row.location,
    stage: row.stage,
  };
}

function ratio(part: number, whole: number) {
  if (!whole) return 0;
  return part / whole;
}

const COMPANIES = [
  { name: "Zoho", domain: "zoho.com" },
  { name: "Freshworks", domain: "freshworks.com" },
  { name: "Ashok Leyland", domain: "ashokleyland.com" },
  { name: "Tiger Analytics", domain: "tigeranalytics.com" },
  { name: "Ramco Cements", domain: "ramcocements.in" },
  { name: "Larsen & Toubro", domain: "larsentoubro.com" },
  { name: "Infosys", domain: "infosys.com" },
  { name: "Tata Consultancy Services", domain: "tcs.com" },
];

const POSITIONS = [
  "Software Engineer",
  "Platform Engineer",
  "Product Analyst",
  "Design Engineer",
  "Data Scientist",
  "Founder",
  "Site Engineer",
  "Project Engineer",
];

const PLACES: Record<string, { lat: number; lng: number }> = {
  chennai: { lat: 13.0827, lng: 80.2707 },
  coimbatore: { lat: 11.0168, lng: 76.9558 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  madurai: { lat: 9.9252, lng: 78.1198 },
  rajapalayam: { lat: 9.4533, lng: 77.5533 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
};

function placeFor(label: string) {
  const key = label.toLowerCase();
  for (const [name, point] of Object.entries(PLACES)) {
    if (key.includes(name)) return point;
  }
  return null;
}

function suggestions(data: PortalState) {
  const email = me();
  if (!email) return { needsProfile: true as const, rows: [] };
  const mine = alumnusByEmail(data, email);
  if (!mine) return { needsProfile: true as const, rows: [] };
  const excluded = new Set<string>([email]);
  for (const edge of data.connections) {
    if (emailOf(edge.requesterEmail) === email || emailOf(edge.recipientEmail) === email) {
      excluded.add(emailOf(edge.requesterEmail));
      excluded.add(emailOf(edge.recipientEmail));
    }
  }
  const rows = data.alumni
    .filter((row) => !excluded.has(emailOf(row.email)))
    .map((row) => {
      let reason = "Also on RITAA";
      let score = 1;
      if (row.batch === mine.batch && row.department === mine.department) {
        reason = `Same batch and department · ${row.department} '${String(row.batch).slice(2)}`;
        score = 5;
      } else if (row.company && row.company === mine.company) {
        reason = `Works at ${row.company}`;
        score = 4;
      } else if (row.batch === mine.batch) {
        reason = `Batch of ${row.batch}`;
        score = 3;
      } else if (row.department === mine.department) {
        reason = row.department;
        score = 2;
      }
      return { member: memberCard(row), reason, mutuals: 0, score };
    })
    .sort((a, b) => b.score - a.score || a.member.name.localeCompare(b.member.name))
    .slice(0, 8)
    .map(({ member, reason, mutuals }) => ({ member, reason, mutuals }));
  return { needsProfile: false as const, rows };
}

function myNetwork(data: PortalState) {
  const email = me();
  const connections: any[] = [];
  const incoming: any[] = [];
  const outgoing: any[] = [];
  if (!email) {
    return { connections, incoming, outgoing, counts: { connections: 0, incoming: 0, outgoing: 0 } };
  }
  for (const edge of data.connections) {
    const requester = emailOf(edge.requesterEmail);
    const recipient = emailOf(edge.recipientEmail);
    if (requester !== email && recipient !== email) continue;
    const other = requester === email ? recipient : requester;
    const member = memberCard(alumnusByEmail(data, other), other.split("@")[0] ?? "Member");
    if (edge.status === "accepted") {
      connections.push({
        connectionId: edge._id,
        member,
        since: edge.respondedAt ?? edge.createdAt,
        theyAsked: requester !== email,
      });
    } else if (edge.status === "pending") {
      const row = { connectionId: edge._id, member, note: edge.note ?? null, askedAt: edge.createdAt };
      if (requester === email) outgoing.push(row);
      else incoming.push(row);
    }
  }
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
}

export function resolveQuery(
  path: string,
  args: any,
  signedIn = true,
  snapshot?: PortalState,
): any {
  const data = snapshot ?? store().state;
  const email = signedIn ? "meera.iyer@sample.invalid" : null;

  switch (path) {
    case "auth.getCurrentUser":
      return email
        ? { id: "user_meera", name: "Meera Iyer", email, image: null }
        : null;
    case "auth.configuredAuthMethods":
      return {
        google: true,
        linkedin: true,
        anyConfigured: true,
        siteUrl: "http://localhost:3001",
        trustedOrigins: ["http://localhost:3001"],
      };
    case "access.roleFor": {
      const target = args?.email ? emailOf(args.email) : email;
      return roleForEmail(data, target);
    }
    case "access.verificationFor": {
      const target = emailOf(args?.email || email || "");
      const row = data.verifications.find((item) => emailOf(item.email) === target);
      if (!row) return null;
      return {
        status: row.status,
        reviewNote: row.reviewNote ?? null,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt ?? null,
      };
    }
    case "access.verificationQueue":
      return {
        pending: data.verifications.filter((row) => row.status === "pending").length,
        approved: data.verifications.filter((row) => row.status === "approved").length,
        rejected: data.verifications.filter((row) => row.status === "rejected").length,
      };
    case "directory.stats": {
      const companies = new Set(data.alumni.map((row) => row.company).filter(Boolean));
      return {
        alumni: data.alumni.length,
        batches: new Set(data.alumni.map((row) => row.batch)).size,
        mentors: data.alumni.filter((row) => row.openToMentor).length,
        companies: companies.size,
        ventures: data.ventures.filter((row) => row.approved).length,
      };
    }
    case "directory.batchCounts": {
      const counts = new Map<number, number>();
      for (const row of data.alumni) counts.set(row.batch, (counts.get(row.batch) ?? 0) + 1);
      return [...counts.entries()]
        .map(([batch, count]) => ({ batch, count }))
        .sort((a, b) => a.batch - b.batch);
    }
    case "directory.departmentCounts": {
      const counts = new Map<string, number>();
      for (const row of data.alumni) {
        if (!row.department) continue;
        counts.set(row.department, (counts.get(row.department) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count);
    }
    case "directory.featured":
      return data.alumni
        .filter((row) => row.featured)
        .slice(0, args?.limit ?? 6)
        .map(publicAlumni);
    case "directory.search":
    case "directorySearch.search":
      return searchAlumni(data, args ?? {});
    case "directorySearch.companyCounts": {
      const counts = new Map<string, number>();
      for (const row of data.alumni) {
        const name = row.company.trim();
        if (!name || row.hiddenFields.includes("company")) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([company, count]) => ({ company, count }))
        .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
    }
    case "events.list":
      return listEvents(data, args?.window);
    case "events.bySlug":
      return data.events.find((row) => row.slug === args?.slug) ?? null;
    case "eventAdmin.myRsvp": {
      const target = emailOf(args?.email);
      const row = data.rsvps.find(
        (item) => item.eventId === args?.eventId && emailOf(item.email) === target,
      );
      if (!row) return null;
      const reminder = data.reminders.find((item) => item.rsvpId === row._id);
      return {
        name: row.name,
        batch: row.batch ?? null,
        guests: row.guests,
        status: row.status,
        createdAt: row.createdAt,
        reminder: reminder ? { scheduledFor: reminder.scheduledFor } : null,
        mailerConfigured: false,
      };
    }
    case "eventAdmin.rsvpSummary":
      return rsvpSummary(data, args?.eventId);
    case "eventAdmin.attendeesFor":
      return data.rsvps
        .filter((row) => row.eventId === args?.eventId)
        .map((row) => ({
          id: row._id,
          name: row.name,
          batch: row.batch ?? null,
          status: row.status,
          guests: row.guests,
          createdAt: row.createdAt,
          hasEmail: Boolean(row.email),
        }));
    case "eventAdmin.mailerStatus":
      return { configured: false };
    case "stories.list": {
      const rows = [...data.stories].sort((a, b) => b.publishedAt - a.publishedAt);
      const filtered = args?.category ? rows.filter((row) => row.category === args.category) : rows;
      return filtered.slice(0, args?.limit ?? 50);
    }
    case "stories.bySlug":
      return data.stories.find((row) => row.slug === args?.slug) ?? null;
    case "stories.featured":
      return data.stories.filter((row) => row.featured).slice(0, 3);
    case "stories.albums":
      return [...data.albums].sort((a, b) => b.year - a.year);
    case "giving.listCampaigns": {
      const rows = args?.activeOnly ? data.campaigns.filter((row) => row.active) : data.campaigns;
      return rows.map(campaignView).sort((a, b) => Number(b.active) - Number(a.active) || b.raisedInr - a.raisedInr);
    }
    case "giving.bySlug": {
      const row = data.campaigns.find((item) => item.slug === args?.slug);
      return row ? campaignView(row) : null;
    }
    case "giving.donorWall":
      return [...data.donations]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, args?.limit ?? 24)
        .map((row) => ({
          _id: row._id,
          donorName: row.anonymous ? "Anonymous donor" : row.donorName,
          batch: row.anonymous ? null : (row.batch ?? null),
          amountInr: row.amountInr,
          message: row.message ?? null,
          createdAt: row.createdAt,
        }));
    case "giving.givingTotals":
      return {
        raisedInr: data.campaigns.reduce((sum, row) => sum + row.raisedInr, 0),
        goalInr: data.campaigns.reduce((sum, row) => sum + row.goalInr, 0),
        donors: data.donations.length,
        activeCampaigns: data.campaigns.filter((row) => row.active).length,
      };
    case "givingReports.fundUsageSummary": {
      const raised = data.campaigns.reduce((sum, row) => sum + row.raisedInr, 0);
      const goal = data.campaigns.reduce((sum, row) => sum + row.goalInr, 0);
      const allocated = data.campaigns.reduce(
        (sum, row) => sum + row.allocations.reduce((inner: number, line: any) => inner + line.amountInr, 0),
        0,
      );
      const itemised = data.donations.reduce((sum, row) => sum + row.amountInr, 0);
      return {
        campaignCount: data.campaigns.length,
        activeCampaignCount: data.campaigns.filter((row) => row.active).length,
        batchCampaignCount: data.campaigns.filter((row) => row.batch !== undefined).length,
        goalInr: goal,
        reportedRaisedInr: raised,
        allocatedInr: allocated,
        unallocatedInr: Math.max(0, raised - allocated),
        goalProgress: ratio(raised, goal),
        allocationShare: ratio(allocated, raised),
        itemisedInr: itemised,
        itemisedGiftCount: data.donations.length,
        aggregateInr: Math.max(0, raised - itemised),
        overAllocated: [],
        allocationLineCount: data.campaigns.reduce((sum, row) => sum + row.allocations.length, 0),
      };
    }
    case "givingReports.givingByBatch": {
      const named = new Map<number, { totalInr: number; giftCount: number; donors: Set<string> }>();
      let withheldInr = 0;
      let withheldGifts = 0;
      for (const gift of data.donations) {
        if (gift.anonymous) {
          withheldInr += gift.amountInr;
          withheldGifts += 1;
          continue;
        }
        if (gift.batch === undefined) continue;
        const entry = named.get(gift.batch) ?? { totalInr: 0, giftCount: 0, donors: new Set<string>() };
        entry.totalInr += gift.amountInr;
        entry.giftCount += 1;
        entry.donors.add(gift.donorName);
        named.set(gift.batch, entry);
      }
      const totalInr = data.donations.reduce((sum, row) => sum + row.amountInr, 0);
      const peakInr = Math.max(0, ...[...named.values()].map((row) => row.totalInr), withheldInr);
      const batchRows = [...named.entries()]
        .map(([batch, entry]) => ({
          key: String(batch),
          batch,
          label: `Batch of ${batch}`,
          totalInr: entry.totalInr,
          giftCount: entry.giftCount,
          donorCount: entry.donors.size,
          share: ratio(entry.totalInr, totalInr),
          peakShare: ratio(entry.totalInr, peakInr),
        }))
        .sort((a, b) => b.totalInr - a.totalInr);
      const rows = [
        ...batchRows,
        withheldGifts
          ? {
              key: "withheld",
              batch: null,
              label: "Given anonymously",
              totalInr: withheldInr,
              giftCount: withheldGifts,
              donorCount: withheldGifts,
              share: ratio(withheldInr, totalInr),
              peakShare: ratio(withheldInr, peakInr),
            }
          : null,
      ].filter(Boolean);
      return {
        rows,
        totalInr,
        giftCount: data.donations.length,
        batchesRepresented: named.size,
        withheldInr,
        withheldGiftCount: withheldGifts,
        leadingBatch: batchRows[0]?.batch ?? null,
      };
    }
    case "givingReports.givingTimeline": {
      const months = Math.max(1, Math.min(24, args?.months ?? 12));
      const latest = new Date(NOW);
      const latestIndex = latest.getUTCFullYear() * 12 + latest.getUTCMonth();
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const series = Array.from({ length: months }, (_, index) => {
        const absolute = latestIndex - (months - 1 - index);
        const year = Math.floor(absolute / 12);
        const month = absolute % 12;
        const start = Date.UTC(year, month, 1);
        const end = Date.UTC(year, month + 1, 1);
        const gifts = data.donations.filter((row) => row.createdAt >= start && row.createdAt < end);
        const totalInr = gifts.reduce((sum, row) => sum + row.amountInr, 0);
        return {
          key: `${year}-${month}`,
          year,
          label: `${names[month]} ${year}`,
          shortLabel: names[month],
          totalInr,
          giftCount: gifts.length,
        };
      });
      const peakInr = Math.max(0, ...series.map((row) => row.totalInr));
      const peak = series.find((row) => row.totalInr === peakInr && row.totalInr > 0);
      return {
        windowMonths: months,
        months: series.map((row) => ({ ...row, share: ratio(row.totalInr, peakInr) })),
        totalInr: series.reduce((sum, row) => sum + row.totalInr, 0),
        giftCount: series.reduce((sum, row) => sum + row.giftCount, 0),
        peakInr,
        peakLabel: peak?.label ?? null,
        activeMonths: series.filter((row) => row.giftCount > 0).length,
        beforeWindowInr: 0,
        beforeWindowCount: 0,
      };
    }
    case "givingReports.campaignLedger": {
      const campaign = data.campaigns.find((row) => row.slug === args?.slug);
      if (!campaign) return null;
      const gifts = data.donations.filter((row) => row.campaignId === campaign._id);
      const allocatedInr = campaign.allocations.reduce((sum: number, line: any) => sum + line.amountInr, 0);
      const scale = Math.max(campaign.raisedInr, allocatedInr, 1);
      const itemisedInr = gifts.reduce((sum: number, row: any) => sum + row.amountInr, 0);
      return {
        campaign: {
          ...campaign,
          batch: campaign.batch ?? null,
          closesAt: campaign.closesAt ?? null,
        },
        progress: Math.min(1, ratio(campaign.raisedInr, campaign.goalInr)),
        allocatedInr,
        allocationShare: ratio(allocatedInr, campaign.raisedInr),
        unallocatedInr: Math.max(0, campaign.raisedInr - allocatedInr),
        overAllocatedInr: Math.max(0, allocatedInr - campaign.raisedInr),
        allocations: campaign.allocations.map((line: any) => ({
          ...line,
          share: ratio(line.amountInr, scale),
          shareOfSpend: ratio(line.amountInr, allocatedInr),
        })),
        gifts: gifts.map((row) => ({
          _id: row._id,
          donorName: row.anonymous ? "Anonymous donor" : row.donorName,
          batch: row.anonymous ? null : (row.batch ?? null),
          amountInr: row.amountInr,
          message: row.message ?? null,
          createdAt: row.createdAt,
          anonymous: row.anonymous,
        })),
        itemisedInr,
        itemisedGiftCount: gifts.length,
        aggregateInr: Math.max(0, campaign.raisedInr - itemisedInr),
        anonymousGiftCount: gifts.filter((row) => row.anonymous).length,
        methodMix: [],
      };
    }
    case "race.listVentures":
      return data.ventures
        .filter((row) => row.approved)
        .filter((row) => (args?.stage ? row.stage === args.stage : true))
        .filter((row) => (args?.category ? row.category === args.category : true))
        .sort((a, b) => b.createdAt - a.createdAt);
    case "race.categories": {
      const counts = new Map<string, number>();
      for (const row of data.ventures.filter((item) => item.approved)) {
        counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
    }
    case "race.raceStats": {
      const rows = data.ventures.filter((row) => row.approved);
      return {
        total: rows.length,
        established: rows.filter((row) => row.stage === "established").length,
        upcoming: rows.filter((row) => row.stage === "upcoming").length,
        categories: new Set(rows.map((row) => row.category)).size,
        mentoringOffered: rows.filter((row) => row.offersHelp.length > 0).length,
      };
    }
    case "raceProfiles.byId": {
      const row = data.ventures.find((item) => item._id === args?.ventureId && item.approved);
      return row ?? null;
    }
    case "raceProfiles.related": {
      const self = data.ventures.find((item) => item._id === args?.ventureId && item.approved);
      if (!self) return [];
      return data.ventures
        .filter((row) => row.approved && row._id !== self._id && row.category === self.category)
        .map((row) => ({ ...founderSummary(row), description: row.description, website: row.website ?? null, offersHelp: row.offersHelp }));
    }
    case "raceProfiles.helpDirectory": {
      const topics = new Map<string, { topic: string; founders: any[] }>();
      for (const row of data.ventures.filter((item) => item.approved)) {
        for (const topic of row.offersHelp) {
          let entry = topics.get(topic);
          if (!entry) {
            entry = { topic, founders: [] };
            topics.set(topic, entry);
          }
          entry.founders.push(founderSummary(row));
        }
      }
      return [...topics.values()].sort((a, b) => b.founders.length - a.founders.length);
    }
    case "raceProfiles.openAsks": {
      const topics = new Map<string, { topic: string; askers: any[] }>();
      for (const row of data.ventures.filter((item) => item.approved)) {
        for (const topic of row.lookingFor) {
          let entry = topics.get(topic);
          if (!entry) {
            entry = { topic, askers: [] };
            topics.set(topic, entry);
          }
          entry.askers.push(founderSummary(row));
        }
      }
      return [...topics.values()]
        .map((entry) => ({ ...entry, count: entry.askers.length }))
        .sort((a, b) => b.count - a.count);
    }
    case "profiles.byEmail": {
      const row = alumnusByEmail(data, email);
      if (!row) return null;
      return { ...row };
    }
    case "profiles.completeness": {
      const row = alumnusByEmail(data, email);
      const fields = data.profileFields.filter((field) => field.active);
      const valueFor = (key: string) => {
        if (!row) return "";
        return String((row as any)[key] ?? "").trim();
      };
      const missing = fields
        .filter((field) => field.required && field.key !== "email")
        .filter((field) => !valueFor(field.key))
        .map((field) => ({ key: field.key, label: field.label }));
      return {
        hasProfile: row !== null,
        complete: row !== null && missing.length === 0,
        missing,
        answered: fields.filter((field) => Boolean(valueFor(field.key))).length,
        total: fields.length,
      };
    }
    case "profileFields.list":
      return {
        configured: true,
        fields: data.profileFields.filter((row) => row.active),
      };
    case "profileFields.listAll":
      if (!isAdmin(data)) {
        return { authorized: false, seeded: false, missing: [], fields: [] };
      }
      return { authorized: true, seeded: true, missing: [], fields: data.profileFields };
    case "network.networkStats": {
      const accepted = data.connections.filter((row) => row.status === "accepted");
      const degree = new Map<string, number>();
      for (const edge of accepted) {
        for (const address of [emailOf(edge.requesterEmail), emailOf(edge.recipientEmail)]) {
          degree.set(address, (degree.get(address) ?? 0) + 1);
        }
      }
      const degrees = [...degree.values()];
      return {
        connections: accepted.length,
        membersConnected: degree.size,
        pending: data.connections.filter((row) => row.status === "pending").length,
        averageConnections:
          degrees.length > 0
            ? Math.round((degrees.reduce((sum, n) => sum + n, 0) / degrees.length) * 10) / 10
            : null,
      };
    }
    case "network.pendingCount":
      return email
        ? data.connections.filter(
            (row) => emailOf(row.recipientEmail) === email && row.status === "pending",
          ).length
        : 0;
    case "network.myNetwork":
      return myNetwork(data);
    case "network.suggestions":
      return suggestions(data);
    case "network.edgeStates": {
      const ids: string[] = args?.alumniIds ?? [];
      const states: Record<string, string> = {};
      const connectionIds: Record<string, string> = {};
      const mutualNames: Record<string, string[]> = {};
      if (!email) {
        return { signedIn: false, states, connectionIds, mutualNames, mutualsComplete: true };
      }
      const mine = neighbours(data, email);
      for (const id of ids) {
        const row = alumnusById(data, id);
        if (!row) continue;
        const other = emailOf(row.email);
        const edge = edgeBetween(data, email, other);
        states[id] = edgeState(edge, email, other);
        if (edge) connectionIds[id] = edge._id;
        const names: string[] = [];
        for (const address of neighbours(data, other)) {
          if (mine.has(address)) {
            names.push(alumnusByEmail(data, address)?.name ?? address);
          }
        }
        if (names.length) mutualNames[id] = names;
      }
      return { signedIn: true, states, connectionIds, mutualNames, mutualsComplete: true };
    }
    case "network.profileEdge": {
      const row = alumnusById(data, String(args?.alumniId ?? ""));
      const empty = {
        signedIn: email !== null,
        state: "none",
        connectionId: null,
        degree: null as 1 | 2 | null,
        mutualNames: [] as string[],
        mutualsComplete: true,
        theirConnectionCount: null as number | null,
      };
      if (!row) return empty;
      const them = emailOf(row.email);
      const their = neighbours(data, them);
      if (!email) return { ...empty, theirConnectionCount: their.size };
      const edge = edgeBetween(data, email, them);
      const stateName = edgeState(edge, email, them);
      const mutuals = [...their]
        .filter((address) => neighbours(data, email).has(address))
        .map((address) => alumnusByEmail(data, address)?.name ?? address);
      return {
        signedIn: true,
        state: stateName,
        connectionId: edge?._id ?? null,
        degree: stateName === "connected" ? 1 : mutuals.length ? 2 : null,
        mutualNames: mutuals,
        mutualsComplete: true,
        theirConnectionCount: their.size,
      };
    }
    case "messaging.unreadCount": {
      if (!email) return 0;
      return data.messages.filter(
        (row) =>
          emailOf(row.senderEmail) !== email &&
          row.readAt === undefined &&
          data.conversations.some(
            (thread) =>
              thread._id === row.conversationId &&
              (thread.participantA === email || thread.participantB === email),
          ),
      ).length;
    }
    case "messaging.myConversations": {
      if (!email) return { me: null, rows: [], totalUnread: 0 };
      const threads = data.conversations
        .filter((row) => row.participantA === email || row.participantB === email)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      const rows = threads.map((thread) => {
        const them = thread.participantA === email ? thread.participantB : thread.participantA;
        const messages = data.messages.filter((row) => row.conversationId === thread._id);
        const unread = messages.filter(
          (row) => emailOf(row.senderEmail) !== email && row.readAt === undefined,
        ).length;
        const still = edgeBetween(data, email, them)?.status === "accepted";
        return {
          conversationId: thread._id,
          counterpart: {
            name: alumnusByEmail(data, them)?.name ?? them,
            alumniId: alumnusByEmail(data, them)?._id ?? null,
            batch: alumnusByEmail(data, them)?.batch ?? null,
            department: alumnusByEmail(data, them)?.department ?? null,
            designation: alumnusByEmail(data, them)?.designation ?? null,
            company: alumnusByEmail(data, them)?.company ?? null,
            avatarUrl: alumnusByEmail(data, them)?.avatarUrl ?? null,
            verified: alumnusByEmail(data, them)?.verified ?? false,
          },
          lastMessageAt: thread.lastMessageAt,
          lastMessagePreview: thread.lastMessagePreview,
          lastFromMe: emailOf(thread.lastSenderEmail) === email,
          unread,
          messageCount: messages.length,
          stillConnected: still,
        };
      });
      return {
        me: email,
        rows,
        totalUnread: rows.reduce((sum, row) => sum + row.unread, 0),
      };
    }
    case "messaging.conversation": {
      if (!email) return null;
      const thread = data.conversations.find((row) => row._id === args?.conversationId);
      if (!thread || (thread.participantA !== email && thread.participantB !== email)) return null;
      const them = thread.participantA === email ? thread.participantB : thread.participantA;
      const messages = data.messages
        .filter((row) => row.conversationId === thread._id)
        .sort((a, b) => a.createdAt - b.createdAt);
      return {
        me: email,
        conversationId: thread._id,
        counterpart: {
          name: alumnusByEmail(data, them)?.name ?? them,
          alumniId: alumnusByEmail(data, them)?._id ?? null,
          batch: alumnusByEmail(data, them)?.batch ?? null,
          department: alumnusByEmail(data, them)?.department ?? null,
          designation: alumnusByEmail(data, them)?.designation ?? null,
          company: alumnusByEmail(data, them)?.company ?? null,
          avatarUrl: alumnusByEmail(data, them)?.avatarUrl ?? null,
          verified: alumnusByEmail(data, them)?.verified ?? false,
        },
        stillConnected: edgeBetween(data, email, them)?.status === "accepted",
        truncated: false,
        messages: messages.map((row) => ({
          _id: row._id,
          body: row.body,
          createdAt: row.createdAt,
          fromMe: emailOf(row.senderEmail) === email,
          readAt: row.readAt ?? null,
        })),
      };
    }
    case "communities.listCommunities": {
      const rows = data.communities.filter(
        (row) =>
          !row.archived &&
          ((row.status ?? "approved") === "approved" || emailOf(row.createdByEmail) === email),
      );
      return {
        signedIn: email !== null,
        rows: rows.map((row) => communityCard(data, row, email)),
      };
    }
    case "communities.myCommunities": {
      if (!email) return { rows: [], pending: 0 };
      const mine = data.communityMembers.filter(
        (row) => emailOf(row.email) === email && (row.status === "active" || row.status === "pending"),
      );
      const rows = mine
        .map((row) => {
          const community = data.communities.find((item) => item._id === row.communityId);
          if (!community || community.archived) return null;
          return {
            _id: community._id,
            name: community.name,
            slug: community.slug,
            tagline: community.tagline,
            visibility: community.visibility,
            memberCount: community.memberCount,
            postCount: community.postCount,
            standing: standingOf(row),
          };
        })
        .filter(Boolean);
      return { rows, pending: rows.filter((row: any) => row.standing === "pending").length };
    }
    case "communities.moderationCount": {
      if (!email) return 0;
      return data.communityMembers
        .filter(
          (row) =>
            emailOf(row.email) === email &&
            row.status === "active" &&
            (row.role === "admin" || row.role === "moderator"),
        )
        .reduce((sum, row) => {
          return (
            sum +
            data.communityMembers.filter(
              (item) => item.communityId === row.communityId && item.status === "pending",
            ).length
          );
        }, 0);
    }
    case "communities.communityBySlug": {
      const community = data.communities.find((row) => row.slug === String(args?.slug ?? "").trim());
      if (!community) return null;
      const mine = membership(data, community._id, email);
      const standing = standingOf(mine);
      const canModerate = standing === "admin" || standing === "moderator";
      const approved = (community.status ?? "approved") === "approved";
      return {
        ...communityCard(data, community, email),
        description: community.description,
        membershipId: mine?._id ?? null,
        canModerate,
        joinQuestions:
          community.visibility === "approval"
            ? data.questions
                .filter((row) => row.communityId === community._id && row.active)
                .map((row) => ({
                  _id: row._id,
                  prompt: row.prompt,
                  kind: row.kind,
                  options: row.options,
                  required: row.required,
                }))
            : [],
        canPost: approved && (standing === "member" || canModerate),
      };
    }
    case "communities.membersOf": {
      const rows = data.communityMembers.filter(
        (row) => row.communityId === args?.communityId && row.status === "active",
      );
      return rows.map((row) => {
        const profile = alumnusByEmail(data, emailOf(row.email));
        return {
          membershipId: row._id,
          role: row.role,
          joinedAt: row.decidedAt ?? row.createdAt,
          name: profile?.name ?? row.email,
          alumniId: profile?._id ?? null,
          batch: profile?.batch ?? null,
          department: profile?.department ?? null,
          designation: profile?.designation ?? null,
          company: profile?.company ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          verified: profile?.verified ?? false,
          isYou: emailOf(row.email) === email,
        };
      });
    }
    case "communities.joinRequests":
      return data.communityMembers
        .filter((row) => row.communityId === args?.communityId && row.status === "pending")
        .map((row) => {
          const profile = alumnusByEmail(data, emailOf(row.email));
          return {
            membershipId: row._id,
            askedAt: row.createdAt,
            note: row.note ?? null,
            name: profile?.name ?? row.email,
            alumniId: profile?._id ?? null,
            batch: profile?.batch ?? null,
            department: profile?.department ?? null,
            designation: profile?.designation ?? null,
            company: profile?.company ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            verified: profile?.verified ?? false,
            answers: data.answers
              .filter((answer) => answer.communityId === args?.communityId && emailOf(answer.email) === emailOf(row.email))
              .map((answer) => ({
                prompt: data.questions.find((question) => question._id === answer.questionId)?.prompt ?? "Question",
                answer: answer.answer,
              })),
          };
        });
    case "communities.pendingCommunities": {
      if (!isAdmin(data)) return { authorized: false, rows: [], counts: { pending: 0, rejected: 0 } };
      const decorate = (row: (typeof data.communities)[number]) => {
        const creator = alumnusByEmail(data, emailOf(row.createdByEmail));
        return {
          _id: row._id,
          name: row.name,
          slug: row.slug,
          tagline: row.tagline,
          description: row.description,
          visibility: row.visibility,
          scopeBatch: row.scopeBatch ?? null,
          scopeDepartment: row.scopeDepartment ?? null,
          createdAt: row.createdAt,
          state: row.status ?? "approved",
          reviewNote: row.reviewNote ?? null,
          reviewedAt: row.reviewedAt ?? null,
          creator: {
            email: row.createdByEmail,
            name: creator?.name ?? row.createdByEmail,
            batch: creator?.batch ?? null,
            department: creator?.department ?? null,
            verified: creator?.verified ?? false,
            avatarUrl: creator?.avatarUrl ?? null,
          },
        };
      };
      const pending = data.communities.filter((row) => row.status === "pending");
      const rejected = data.communities.filter((row) => row.status === "rejected");
      return {
        authorized: true,
        rows: [...pending, ...rejected].map(decorate),
        counts: { pending: pending.length, rejected: rejected.length },
      };
    }
    case "feed.generalFeed": {
      if (!email) return { authorized: false, posts: [] };
      const role = roleForEmail(data, email).role;
      if (role === "guest") return { authorized: false, posts: [] };
      const posts = data.posts
        .filter((row) => !row.communityId)
        .filter((row) => !row.hidden || emailOf(row.authorEmail) === email)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, args?.limit ?? 30)
        .map((row) => decoratePost(data, row, email));
      return { authorized: true, posts };
    }
    case "feed.communityFeed": {
      const mine = membership(data, args?.communityId, email);
      const standing = standingOf(mine);
      if (mine?.status !== "active") return { allowed: false, posts: [], canModerate: false };
      const posts = data.posts
        .filter((row) => row.communityId === args?.communityId)
        .filter((row) => !row.hidden || emailOf(row.authorEmail) === email)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => decoratePost(data, row, email));
      return {
        allowed: true,
        posts,
        canModerate: standing === "admin" || standing === "moderator",
      };
    }
    case "feed.commentsFor":
      return data.comments
        .filter((row) => row.postId === args?.postId && !row.hidden)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((row) => ({
          _id: row._id,
          body: row.body,
          createdAt: row.createdAt,
          author: authorCard(data, row.authorEmail),
          isMine: emailOf(row.authorEmail) === email,
        }));
    case "feed.feedStats": {
      if (!email || roleForEmail(data, email).role === "guest") {
        return { authorized: false, generalPosts: 0, communityPosts: 0, polls: 0, contributors: 0 };
      }
      const general = data.posts.filter((row) => !row.communityId);
      return {
        authorized: true,
        generalPosts: general.length,
        communityPosts: data.posts.length - general.length,
        polls: data.posts.filter((row) => row.kind === "poll").length,
        contributors: new Set(data.posts.map((row) => emailOf(row.authorEmail))).size,
      };
    }
    case "careers.listJobs":
      return data.jobs
        .filter((row) => row.active)
        .filter((row) => (args?.type ? row.type === args.type : true))
        .filter((row) => (args?.referralOnly ? row.referralOffered : true))
        .sort((a, b) => b.createdAt - a.createdAt);
    case "careers.listMentors":
      return data.alumni
        .filter((row) => row.openToMentor)
        .filter((row) => (args?.topic ? row.mentorTopics.includes(args.topic) : true))
        .map((row) => ({
          _id: row._id,
          name: row.name,
          batch: row.batch,
          department: row.department,
          designation: row.designation,
          company: row.company,
          region: row.region,
          avatarUrl: row.avatarUrl,
          bio: row.bio,
          verified: row.verified,
          mentorTopics: row.mentorTopics,
        }));
    case "careers.mentorTopics": {
      const counts = new Map<string, number>();
      for (const row of data.alumni.filter((item) => item.openToMentor)) {
        for (const topic of row.mentorTopics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count);
    }
    case "mentoring.myMentorProfile": {
      const row = alumnusByEmail(data, email);
      if (!row) return null;
      return {
        alumniId: row._id,
        name: row.name,
        designation: row.designation,
        company: row.company,
        department: row.department,
        batch: row.batch,
        verified: row.verified,
        openToMentor: row.openToMentor,
        mentorTopics: row.mentorTopics,
      };
    }
    case "mentoring.requestsForMentor":
      return data.mentorship
        .filter((row) => row.mentorId === args?.mentorId)
        .map((row) => decorateMentorship(data, row));
    case "mentoring.requestsForSeeker":
      return data.mentorship
        .filter((row) => emailOf(row.seekerEmail) === email)
        .map((row) => decorateMentorship(data, row));
    case "mentoring.mentorshipStats": {
      const byStatus = { requested: 0, accepted: 0, completed: 0, declined: 0 } as Record<string, number>;
      for (const row of data.mentorship) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      const rated = data.mentorship.filter((row) => typeof row.feedbackRating === "number");
      const average =
        rated.length > 0
          ? Math.round((rated.reduce((sum, row) => sum + row.feedbackRating, 0) / rated.length) * 10) / 10
          : null;
      return {
        total: data.mentorship.length,
        byStatus,
        averageRating: average,
        ratedCount: rated.length,
        completedCount: byStatus.completed,
        completedWithFeedback: rated.filter((row) => row.status === "completed").length,
        fromStudents: data.mentorship.filter((row) => row.seekerKind === "student").length,
        fromAlumni: data.mentorship.filter((row) => row.seekerKind === "alumnus").length,
        mentorsEngaged: new Set(data.mentorship.map((row) => row.mentorId)).size,
      };
    }
    case "presence.map": {
      if (!email) {
        return {
          authorized: false,
          campus: { label: "Ramco Institute of Technology, Rajapalayam", lat: 9.4533, lng: 77.5533 },
          places: [],
          totals: { members: 0, placed: 0, named: 0, unplaced: 0, placesShown: 0, countries: 0 },
        };
      }
      const places = new Map<string, any>();
      let placed = 0;
      let named = 0;
      let unplaced = 0;
      for (const row of data.alumni) {
        if (!row.location) {
          unplaced += 1;
          continue;
        }
        if (row.locationLat === null || row.locationLng === null) {
          named += 1;
          continue;
        }
        placed += 1;
        const key = row.location.toLowerCase();
        const existing = places.get(key);
        if (existing) {
          existing.count += 1;
          if (row.verified) existing.verified += 1;
          if (existing.names.length < 12) existing.names.push(row.name);
        } else {
          places.set(key, {
            key,
            label: row.location,
            lat: row.locationLat,
            lng: row.locationLng,
            count: 1,
            names: [row.name],
            verified: row.verified ? 1 : 0,
          });
        }
      }
      const list = [...places.values()].sort((a, b) => b.count - a.count);
      return {
        authorized: true,
        campus: { label: "Ramco Institute of Technology, Rajapalayam", lat: 9.4533, lng: 77.5533 },
        places: list,
        totals: {
          members: data.alumni.length,
          placed,
          named,
          unplaced,
          placesShown: list.length,
          countries: new Set(list.map((place) => place.label.split(",").at(-1)?.trim())).size,
        },
      };
    }
    case "questions.allVerificationQuestions":
    case "questions.verificationQuestions":
      return data.questions.filter((row) => row.scope === "verification");
    case "questions.profileQuestions":
      return data.questions.filter((row) => row.scope === "profile" && row.active);
    case "questions.allProfileQuestions":
      return data.questions.filter((row) => row.scope === "profile");
    case "questions.communityQuestions":
      return data.questions.filter((row) => row.communityId === args?.communityId);
    case "questions.myProfileAnswers":
      return data.answers.filter((row) => row.scope === "profile" && emailOf(row.email) === email);
    case "questions.myVerificationAnswers":
      return data.answers.filter((row) => row.scope === "verification" && emailOf(row.email) === email);
    case "lookups.cached": {
      const query = String(args?.query ?? "").trim().toLowerCase();
      if (args?.kind === "position") {
        const rows = POSITIONS.filter((title) => title.toLowerCase().includes(query)).map((title) => ({ title }));
        return { hit: true, stale: false, rows };
      }
      const rows = COMPANIES.filter((row) => row.name.toLowerCase().includes(query)).map((row) => ({
        name: row.name,
        domain: row.domain,
        logoUrl: null,
      }));
      return { hit: true, stale: false, rows };
    }
    case "roster.importFormat":
      return {
        columns: [
          ["slNo", "Sl.No"],
          ["firstName", "First Name*"],
          ["middleName", "Middle Name"],
          ["lastName", "Last Name*"],
          ["personalEmail", "Email (Personal Email Id)*"],
          ["secondaryEmail", "Secondary Email ID"],
          ["phone", "Phone Number*"],
          ["secondaryPhone", "Secondary Phone No"],
          ["enrollmentNumber", "Enrollment Number*"],
          ["degree", "Degree*"],
          ["departmentRaw", "Department*"],
          ["permanentAddress", "Permanent Address"],
          ["designation", "Designation"],
          ["company", "Company"],
          ["yearOfPassing", "Year of Passing*"],
          ["yearOfJoining", "Year of Joining*"],
        ].map(([key, header]) => ({ key, header, required: true })),
        collegeEmailDomain: "ritrjpm.ac.in",
        maxRowsPerCall: 250,
        departments: ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL", "AIDS"],
      };
    case "roster.importHistory":
      return isAdmin(data) ? data.importBatches : [];
    case "roster.rosterStats": {
      const byDepartment = new Map<string, number>();
      const byPassing = new Map<number, number>();
      for (const row of data.students) {
        byDepartment.set(row.department, (byDepartment.get(row.department) ?? 0) + 1);
        byPassing.set(row.yearOfPassing, (byPassing.get(row.yearOfPassing) ?? 0) + 1);
      }
      return {
        total: data.students.length,
        departments: [...byDepartment.entries()].map(([department, count]) => ({ department, count })),
        cohorts: [...byPassing.entries()]
          .map(([yearOfPassing, count]) => ({ yearOfPassing, count }))
          .sort((a, b) => b.yearOfPassing - a.yearOfPassing),
      };
    }
    case "roster.canSearchRoster": {
      if (!email) return { allowed: false, role: null, signedIn: false };
      const role = roleForEmail(data, email).role;
      return { allowed: role !== "guest", role, signedIn: true };
    }
    case "roster.search": {
      const term = String(args?.text ?? "").trim().toLowerCase();
      if (term.length < 2) return { isAdmin: isAdmin(data), rows: [], adminRows: [], tooShort: true };
      const rows = data.students.filter((row) => {
        if (args?.department && row.department !== args.department) return false;
        if (args?.yearOfPassing && row.yearOfPassing !== args.yearOfPassing) return false;
        return String(row.searchText ?? row.fullName).toLowerCase().includes(term);
      });
      const memberRows = rows.map((row) => ({
        _id: row._id,
        fullName: row.fullName,
        department: row.department,
        degree: row.degree,
        yearOfPassing: row.yearOfPassing,
        yearOfJoining: row.yearOfJoining,
        designation: row.designation,
        company: row.company,
      }));
      return {
        isAdmin: isAdmin(data),
        tooShort: false,
        rows: memberRows,
        adminRows: isAdmin(data) ? rows : [],
      };
    }
    case "adminOps.pendingVentures":
      return isAdmin(data)
        ? data.ventures
            .filter((row) => !row.approved)
            .map((row) => ({ ...row, imageCount: row.productImageUrls?.length ?? 0 }))
        : [];
    case "adminOps.pendingVerifications":
      return isAdmin(data) ? data.verifications.filter((row) => row.status === "pending") : [];
    case "adminOps.membersForVerification": {
      if (!isAdmin(data)) {
        return {
          authorized: false,
          rows: [],
          counts: { total: 0, verified: 0, signedIn: 0, withoutProfile: 0, shown: 0 },
        };
      }
      const needle = String(args?.text ?? "").trim().toLowerCase();
      const rows = data.alumni
        .map((row) => ({
          email: row.email,
          name: row.name,
          hasAccount: emailOf(row.email) === email,
          hasProfile: true,
          verified: row.verified,
          role: roleForEmail(data, emailOf(row.email)).role,
          batch: row.batch,
          department: row.department,
          joinedAt: row.joinedAt,
        }))
        .filter((row) =>
          needle
            ? row.name.toLowerCase().includes(needle) ||
              row.email.includes(needle) ||
              String(row.batch).includes(needle) ||
              row.department.toLowerCase().includes(needle)
            : true,
        );
      return {
        authorized: true,
        rows,
        counts: {
          total: data.alumni.length,
          verified: data.alumni.filter((row) => row.verified).length,
          signedIn: email ? 1 : 0,
          withoutProfile: 0,
          shown: rows.length,
        },
      };
    }
    case "adminOps.postsForModeration": {
      if (!isAdmin(data)) return { authorized: false, rows: [], counts: { total: 0, hidden: 0 } };
      const general = data.posts.filter((row) => !row.communityId);
      return {
        authorized: true,
        counts: { total: general.length, hidden: general.filter((row) => row.hidden).length },
        rows: general.map((post) => ({
          postId: post._id,
          authorEmail: post.authorEmail,
          authorName: alumnusByEmail(data, emailOf(post.authorEmail))?.name ?? post.authorEmail,
          body: post.body.length > 240 ? `${post.body.slice(0, 240)}…` : post.body,
          kind: post.kind,
          hasMedia: (post.imageUrls?.length ?? 0) > 0,
          isShare: Boolean(post.sharedFromId),
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          hidden: post.hidden,
          hiddenReason: post.hiddenReason ?? null,
          createdAt: post.createdAt,
        })),
      };
    }
    default:
      return null;
  }
}

export function applyMutation(path: string, args: any): any {
  const draft = structuredClone(store().state) as PortalState;
  const email = me();
  const requireEmail = () => {
    if (!email) throw new ConvexError("Sign in to continue.");
    return email;
  };

  let result: any = { ok: true };

  switch (path) {
    case "events.rsvp": {
      const guests = args.guests ?? 0;
      const existing = draft.rsvps.find(
        (row) => row.eventId === args.eventId && emailOf(row.email) === emailOf(args.email),
      );
      if (existing) {
        existing.status = args.status;
        existing.guests = guests;
        result = existing._id;
      } else {
        const id = nid("rsvp");
        draft.rsvps.push({
          _id: id,
          eventId: args.eventId,
          name: args.name,
          email: emailOf(args.email),
          batch: args.batch,
          guests,
          status: args.status,
          createdAt: Date.now(),
        });
        result = id;
      }
      break;
    }
    case "eventAdmin.scheduleReminder": {
      const rsvp = draft.rsvps.find(
        (row) => row.eventId === args.eventId && emailOf(row.email) === emailOf(args.email),
      );
      if (!rsvp) throw new Error("No RSVP is on file for that email address yet.");
      const event = draft.events.find((row) => row._id === args.eventId);
      const scheduledFor = event ? event.startsAt - 24 * 60 * 60 * 1000 : Date.now();
      if (rsvp.status === "cancelled") {
        draft.reminders = draft.reminders.filter((row) => row.rsvpId !== rsvp._id);
        result = {
          queued: false,
          scheduledFor: null,
          deliverable: false,
          reason: "Your response is cancelled, so no reminder is queued.",
        };
      } else {
        draft.reminders = draft.reminders.filter((row) => row.rsvpId !== rsvp._id);
        draft.reminders.push({ rsvpId: rsvp._id, scheduledFor });
        result = {
          queued: true,
          scheduledFor,
          deliverable: false,
          reason: "Saved on this device. Email reminders need a mailer, which this preview does not send.",
        };
      }
      break;
    }
    case "profiles.upsertProfile": {
      const address = requireEmail();
      const row = alumnusByEmail(draft, address);
      if (!row) throw new ConvexError("There is no profile for this session yet.");
      const patch = { ...args };
      delete patch.email;
      if (patch.firstName || patch.lastName) {
        const first = patch.firstName ?? row.firstName;
        const last = patch.lastName ?? row.lastName;
        patch.name = [first, last].filter(Boolean).join(" ");
      }
      Object.assign(row, patch);
      result = { _id: row._id, created: false, verified: row.verified };
      break;
    }
    case "profiles.setFieldVisibility": {
      const row = alumnusByEmail(draft, requireEmail());
      if (!row) throw new ConvexError("Fill in your details first.");
      const hidden = new Set(row.hiddenFields);
      const shared = new Set(row.sharedFields);
      if (args.hidden) {
        hidden.add(args.field);
        shared.delete(args.field);
      } else {
        hidden.delete(args.field);
        shared.add(args.field);
      }
      row.hiddenFields = [...hidden];
      row.sharedFields = [...shared];
      result = { sharedFields: row.sharedFields, hiddenFields: row.hiddenFields };
      break;
    }
    case "profiles.setLocationConsent": {
      const row = alumnusByEmail(draft, requireEmail());
      if (!row) throw new ConvexError("Fill in your details first — there is no profile to attach this to yet.");
      row.locationConsent = Boolean(args.consent);
      result = { consent: row.locationConsent, cleared: false };
      break;
    }
    case "profiles.generateAvatarUploadUrl":
      result = "/api/upload";
      break;
    case "profiles.setAvatar": {
      const row = alumnusByEmail(draft, requireEmail());
      if (!row) throw new ConvexError("Fill in your details first.");
      row.avatarUrl = String(args.storageId);
      result = { avatarUrl: row.avatarUrl };
      break;
    }
    case "profiles.removeAvatar": {
      const row = alumnusByEmail(draft, requireEmail());
      if (row) row.avatarUrl = null;
      result = { removed: true };
      break;
    }
    case "feed.createPost": {
      const address = requireEmail();
      const id = nid("post");
      const post = {
        _id: id,
        authorEmail: address,
        communityId: args.communityId,
        body: String(args.body ?? "").trim(),
        kind: args.pollOptions?.length ? "poll" : "text",
        imageUrls: args.imageUrls ?? [],
        videoUrls: args.videoUrls ?? [],
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
        hidden: false,
        createdAt: Date.now(),
      };
      draft.posts.unshift(post);
      if (args.pollOptions?.length) {
        draft.questions.push({
          _id: nid("q"),
          scope: "poll",
          postId: id,
          prompt: post.body.split("\n")[0],
          kind: "choice",
          options: args.pollOptions,
          required: true,
          order: 0,
          active: true,
          createdByEmail: address,
          createdAt: Date.now(),
        });
      }
      if (args.communityId) {
        const community = draft.communities.find((row) => row._id === args.communityId);
        if (community) community.postCount += 1;
      }
      result = { postId: id };
      break;
    }
    case "feed.toggleLike": {
      const address = requireEmail();
      const post = draft.posts.find((row) => row._id === args.postId);
      if (!post) throw new ConvexError("That post is gone.");
      const existing = draft.likes.find(
        (row) => row.postId === args.postId && emailOf(row.email) === address,
      );
      if (existing) {
        draft.likes = draft.likes.filter((row) => row._id !== existing._id);
        post.likeCount = Math.max(0, post.likeCount - 1);
        result = { liked: false };
      } else {
        draft.likes.push({ _id: nid("like"), postId: args.postId, email: address, createdAt: Date.now() });
        post.likeCount += 1;
        result = { liked: true };
      }
      break;
    }
    case "feed.votePoll": {
      const address = requireEmail();
      const existing = draft.answers.find(
        (row) => row.questionId === args.questionId && emailOf(row.email) === address,
      );
      if (existing) existing.answer = args.answer;
      else {
        draft.answers.push({
          _id: nid("ans"),
          questionId: args.questionId,
          email: address,
          scope: "poll",
          answer: args.answer,
          createdAt: Date.now(),
        });
      }
      result = { answer: args.answer, changed: Boolean(existing) };
      break;
    }
    case "feed.addComment": {
      const address = requireEmail();
      const id = nid("comment");
      draft.comments.push({
        _id: id,
        postId: args.postId,
        authorEmail: address,
        body: String(args.body ?? "").trim(),
        hidden: false,
        createdAt: Date.now(),
      });
      const post = draft.posts.find((row) => row._id === args.postId);
      if (post) post.commentCount += 1;
      result = { commentId: id };
      break;
    }
    case "feed.deleteComment": {
      const comment = draft.comments.find((row) => row._id === args.commentId);
      draft.comments = draft.comments.filter((row) => row._id !== args.commentId);
      if (comment) {
        const post = draft.posts.find((row) => row._id === comment.postId);
        if (post) post.commentCount = Math.max(0, post.commentCount - 1);
      }
      result = { deleted: true };
      break;
    }
    case "feed.deletePost":
      draft.posts = draft.posts.filter((row) => row._id !== args.postId);
      result = { deleted: true };
      break;
    case "feed.sharePost": {
      const address = requireEmail();
      const original = draft.posts.find((row) => row._id === (args.postId ?? args.sharedFromId));
      if (!original) throw new ConvexError("That post is gone.");
      const id = nid("post");
      draft.posts.unshift({
        _id: id,
        authorEmail: address,
        body: String(args.body ?? args.note ?? "").trim() || "Shared a post.",
        kind: "text",
        imageUrls: [],
        videoUrls: [],
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
        sharedFromId: original.sharedFromId ?? original._id,
        hidden: false,
        createdAt: Date.now(),
      });
      original.shareCount = (original.shareCount ?? 0) + 1;
      result = { postId: id };
      break;
    }
    case "feed.setPostHidden": {
      const post = draft.posts.find((row) => row._id === args.postId);
      if (post) {
        post.hidden = Boolean(args.hidden);
        post.hiddenReason = args.reason;
      }
      result = { hidden: Boolean(args.hidden) };
      break;
    }
    case "network.requestConnection": {
      const address = requireEmail();
      const target = alumnusById(draft, args.alumniId);
      if (!target) throw new ConvexError("That member is no longer in the directory.");
      const other = emailOf(target.email);
      if (other === address) throw new ConvexError("You are already connected to yourself.");
      const existing = edgeBetween(draft, address, other);
      if (existing && existing.status !== "declined") {
        throw new ConvexError("There is already a request between you.");
      }
      if (existing) {
        existing.status = "pending";
        existing.requesterEmail = address;
        existing.recipientEmail = other;
        existing.note = args.note;
        existing.createdAt = Date.now();
        result = { connectionId: existing._id, status: "pending" };
      } else {
        const id = nid("conn");
        draft.connections.push({
          _id: id,
          requesterEmail: address,
          recipientEmail: other,
          status: "pending",
          note: args.note,
          createdAt: Date.now(),
        });
        result = { connectionId: id, status: "pending" };
      }
      break;
    }
    case "network.respondToConnection": {
      const edge = draft.connections.find((row) => row._id === args.connectionId);
      if (!edge) throw new ConvexError("That request is gone.");
      edge.status = args.accept || args.decision === "accepted" ? "accepted" : "declined";
      edge.respondedAt = Date.now();
      result = { status: edge.status };
      break;
    }
    case "network.withdrawConnection":
    case "network.removeConnection": {
      draft.connections = draft.connections.filter((row) => row._id !== args.connectionId);
      result = { removed: true };
      break;
    }
    case "messaging.openConversation": {
      const address = requireEmail();
      const edge = draft.connections.find((row) => row._id === args.connectionId);
      if (!edge || edge.status !== "accepted") {
        throw new ConvexError("You can message someone only after you are connected.");
      }
      const a = emailOf(edge.requesterEmail);
      const b = emailOf(edge.recipientEmail);
      const them = a === address ? b : a;
      const [participantA, participantB] = [address, them].sort();
      const existing = draft.conversations.find(
        (row) => row.participantA === participantA && row.participantB === participantB,
      );
      if (existing) {
        result = { conversationId: existing._id, created: false };
        break;
      }
      const id = nid("thread");
      draft.conversations.unshift({
        _id: id,
        participantA,
        participantB,
        lastMessageAt: Date.now(),
        lastMessagePreview: "",
        lastSenderEmail: address,
        createdAt: Date.now(),
      });
      result = { conversationId: id, created: true };
      break;
    }
    case "messaging.sendMessage": {
      const address = requireEmail();
      const thread = draft.conversations.find((row) => row._id === args.conversationId);
      if (!thread) throw new ConvexError("That conversation is gone.");
      const id = nid("msg");
      const body = String(args.body ?? "").trim();
      draft.messages.push({
        _id: id,
        conversationId: thread._id,
        senderEmail: address,
        body,
        createdAt: Date.now(),
      });
      thread.lastMessageAt = Date.now();
      thread.lastMessagePreview = body.slice(0, 140);
      thread.lastSenderEmail = address;
      result = { messageId: id };
      break;
    }
    case "messaging.markRead": {
      const address = requireEmail();
      for (const row of draft.messages) {
        if (row.conversationId === args.conversationId && emailOf(row.senderEmail) !== address) {
          row.readAt = row.readAt ?? Date.now();
        }
      }
      result = { read: true };
      break;
    }
    case "communities.requestToJoin": {
      const address = requireEmail();
      const community = draft.communities.find((row) => row._id === args.communityId);
      if (!community) throw new ConvexError("That community is gone.");
      const existing = membership(draft, community._id, address);
      if (existing && (existing.status === "active" || existing.status === "pending")) {
        result = { status: existing.status, alreadyIn: true };
        break;
      }
      const status = community.visibility === "open" ? "active" : "pending";
      draft.communityMembers.push({
        _id: nid("cm"),
        communityId: community._id,
        email: address,
        role: "member",
        status,
        note: args.note,
        createdAt: Date.now(),
        decidedAt: status === "active" ? Date.now() : undefined,
      });
      if (status === "active") community.memberCount += 1;
      if (Array.isArray(args.answers)) {
        for (const answer of args.answers) {
          draft.answers.push({
            _id: nid("ans"),
            questionId: answer.questionId,
            email: address,
            scope: "communityJoin",
            communityId: community._id,
            answer: answer.answer,
            createdAt: Date.now(),
          });
        }
      }
      result = { status, alreadyIn: false };
      break;
    }
    case "communities.createCommunity": {
      const address = requireEmail();
      const name = String(args.name ?? "").trim();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || nid("community");
      const id = nid("community");
      draft.communities.unshift({
        _id: id,
        name,
        slug,
        tagline: String(args.tagline ?? "").trim(),
        description: String(args.description ?? "").trim(),
        visibility: args.visibility,
        createdByEmail: address,
        scopeBatch: args.scopeBatch,
        scopeDepartment: args.scopeDepartment,
        memberCount: 1,
        postCount: 0,
        archived: false,
        createdAt: Date.now(),
        status: "pending",
      });
      draft.communityMembers.push({
        _id: nid("cm"),
        communityId: id,
        email: address,
        role: "admin",
        status: "active",
        createdAt: Date.now(),
      });
      result = { communityId: id, slug, status: "pending" };
      break;
    }
    case "communities.reviewJoinRequest": {
      const row = draft.communityMembers.find((item) => item._id === args.membershipId);
      if (!row) throw new ConvexError("That request is gone.");
      row.status = args.decision === "approved" || args.accept ? "active" : "declined";
      row.decidedAt = Date.now();
      if (row.status === "active") {
        const community = draft.communities.find((item) => item._id === row.communityId);
        if (community) community.memberCount += 1;
      }
      result = { status: row.status };
      break;
    }
    case "communities.leaveCommunity": {
      const address = requireEmail();
      const row = draft.communityMembers.find(
        (item) => item.communityId === args.communityId && emailOf(item.email) === address,
      );
      if (row) row.status = "removed";
      const community = draft.communities.find((item) => item._id === args.communityId);
      if (community) community.memberCount = Math.max(0, community.memberCount - 1);
      result = { left: true };
      break;
    }
    case "communities.setMemberRole": {
      const row = draft.communityMembers.find((item) => item._id === args.membershipId);
      if (!row) throw new ConvexError("That membership is gone.");
      if (args.role === "removed") row.status = "removed";
      else {
        row.role = args.role;
        row.status = "active";
      }
      result = { role: args.role };
      break;
    }
    case "communities.reviewCommunity": {
      const row = draft.communities.find((item) => item._id === args.communityId);
      if (!row) throw new ConvexError("That community is gone.");
      row.status = args.decision;
      row.reviewNote = args.reviewNote;
      row.reviewedAt = Date.now();
      result = { status: row.status };
      break;
    }
    case "race.submitVenture": {
      const id = nid("venture");
      draft.ventures.unshift({
        _id: id,
        ...args,
        productImageUrls: args.productImageUrls ?? [],
        lookingFor: args.lookingFor ?? [],
        offersHelp: args.offersHelp ?? [],
        approved: false,
        createdAt: Date.now(),
      });
      result = id;
      break;
    }
    case "careers.postJob": {
      const id = nid("job");
      draft.jobs.unshift({ _id: id, ...args, active: true, createdAt: Date.now() });
      result = id;
      break;
    }
    case "careers.requestMentorship": {
      const id = nid("mentor_req");
      draft.mentorship.unshift({
        _id: id,
        mentorId: args.mentorId,
        seekerName: args.seekerName,
        seekerEmail: emailOf(args.seekerEmail || email || ""),
        seekerKind: args.seekerKind ?? "alumnus",
        topic: args.topic,
        message: args.message,
        preferredSlot: args.preferredSlot,
        status: "requested",
        createdAt: Date.now(),
      });
      result = id;
      break;
    }
    case "mentoring.updateStatus": {
      const row = draft.mentorship.find((item) => item._id === args.requestId);
      if (!row) throw new ConvexError("That request is gone.");
      row.status = args.status;
      result = { status: row.status };
      break;
    }
    case "mentoring.leaveFeedback": {
      const row = draft.mentorship.find((item) => item._id === args.requestId);
      if (!row) throw new ConvexError("That request is gone.");
      row.feedbackRating = args.rating;
      row.feedbackNote = args.note;
      result = { requestId: row._id, rating: args.rating };
      break;
    }
    case "referrals.requestReferral": {
      const job = draft.jobs.find((row) => row._id === args.jobId);
      if (!job) throw new Error("That role has come off the board.");
      const reference = `RITAA-REF-PREVIEW`;
      const body = [
        `Hello ${job.postedByName},`,
        "",
        `I am asking for your referral for ${job.title} at ${job.company}.`,
        "",
        args.message,
        "",
        `Reference: ${reference}`,
        "Sent from the standalone preview. Nothing was emailed.",
      ].join("\n");
      result = {
        reference,
        requestedAt: Date.now(),
        to: job.postedByEmail,
        subject: `Referral request — ${job.title} at ${job.company} [${reference}]`,
        body,
        jobTitle: job.title,
        company: job.company,
        postedByName: job.postedByName,
        storedInPortal: false,
        delivery: "email",
        needsResumeAttachment: !args.resumeUrl,
      };
      break;
    }
    case "questions.addQuestion": {
      const id = nid("q");
      draft.questions.push({
        _id: id,
        scope: args.scope ?? "verification",
        communityId: args.communityId,
        prompt: args.prompt,
        kind: args.kind ?? "text",
        options: args.options ?? [],
        required: Boolean(args.required),
        order: draft.questions.length,
        active: true,
        createdByEmail: requireEmail(),
        createdAt: Date.now(),
      });
      result = id;
      break;
    }
    case "questions.editQuestion": {
      const row = draft.questions.find((item) => item._id === args.questionId);
      if (row) Object.assign(row, args);
      result = { updated: true };
      break;
    }
    case "questions.setQuestionActive": {
      const row = draft.questions.find((item) => item._id === args.questionId);
      if (row) row.active = args.active;
      result = { active: args.active };
      break;
    }
    case "questions.reorderQuestion": {
      const row = draft.questions.find((item) => item._id === args.questionId);
      if (row && args.direction) row.order += args.direction === "up" ? -1 : 1;
      result = { order: row?.order };
      break;
    }
    case "questions.answerProfileQuestions":
    case "questions.answerVerificationQuestions": {
      const address = requireEmail();
      const scope = path.includes("Profile") ? "profile" : "verification";
      for (const answer of args.answers ?? []) {
        const existing = draft.answers.find(
          (row) => row.questionId === answer.questionId && emailOf(row.email) === address,
        );
        if (existing) existing.answer = answer.answer;
        else {
          draft.answers.push({
            _id: nid("ans"),
            questionId: answer.questionId,
            email: address,
            scope,
            answer: answer.answer,
            createdAt: Date.now(),
          });
        }
      }
      result = { saved: true };
      break;
    }
    case "access.setVerified": {
      const row = alumnusByEmail(draft, emailOf(args.email));
      if (row) row.verified = Boolean(args.verified);
      result = { verified: Boolean(args.verified) };
      break;
    }
    case "access.assignRole": {
      const target = emailOf(args.email);
      draft.roles = draft.roles.filter((row) => row.email !== target);
      if (args.role !== "guest") draft.roles.push({ email: target, role: args.role });
      result = { role: args.role };
      break;
    }
    case "roster.importRows": {
      let imported = 0;
      let updated = 0;
      let rejected = 0;
      const problems: any[] = [];
      for (const row of args.rows ?? []) {
        const enrollment = String(row.enrollmentNumber ?? "").trim();
        if (!enrollment) {
          rejected += 1;
          problems.push({
            rowNumber: row.rowNumber ?? 0,
            column: "Enrollment Number*",
            problem: "required, but this cell is empty",
          });
          continue;
        }
        if (args.dryRun) {
          imported += 1;
          continue;
        }
        const existing = draft.students.find((item) => item.enrollmentNumber === enrollment);
        const fullName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");
        const doc = {
          ...(existing ?? { _id: nid("student") }),
          ...row,
          enrollmentNumber: enrollment,
          fullName: fullName || existing?.fullName || enrollment,
          searchText: `${fullName} ${enrollment} ${enrollment}@ritrjpm.ac.in`,
          collegeEmail: `${enrollment}@ritrjpm.ac.in`,
          importedAt: Date.now(),
          importedByEmail: email,
          importBatchId: args.importBatchId,
        };
        if (existing) {
          Object.assign(existing, doc);
          updated += 1;
        } else {
          draft.students.push(doc);
          imported += 1;
        }
      }
      result = {
        rowsSeen: (args.rows ?? []).length,
        imported,
        updated,
        rejected,
        problems,
        dryRun: Boolean(args.dryRun),
      };
      break;
    }
    case "roster.recordImportBatch": {
      const id = nid("import");
      draft.importBatches.unshift({
        _id: id,
        batchId: args.batchId,
        fileName: args.fileName,
        sheetName: args.sheetName,
        uploadedByEmail: email,
        createdAt: Date.now(),
        rowsSeen: args.rowsSeen,
        imported: args.imported,
        updated: args.updated,
        rejected: args.rejected,
        dryRun: args.dryRun,
      });
      result = id;
      break;
    }
    case "roster.undoImport": {
      const before = draft.students.length;
      draft.students = draft.students.filter((row) => row.importBatchId !== args.batchId);
      result = { deleted: before - draft.students.length };
      break;
    }
    case "profileFields.updateField":
    case "profileFields.setOptions":
    case "profileFields.moveField":
    case "profileFields.ensureDefaults": {
      const row = draft.profileFields.find((item) => item._id === args.fieldId || item.key === args.key);
      if (row && path === "profileFields.setOptions") row.options = args.options;
      if (row && path === "profileFields.updateField") Object.assign(row, args);
      if (row && path === "profileFields.moveField") row.order += args.direction === "up" ? -1 : 1;
      result = { ok: true };
      break;
    }
    case "lookups.companies":
      result = COMPANIES.filter((row) =>
        row.name.toLowerCase().includes(String(args?.query ?? "").toLowerCase()),
      ).map((row) => ({ ...row, logoUrl: null }));
      break;
    case "lookups.positions":
      result = POSITIONS.filter((title) =>
        title.toLowerCase().includes(String(args?.query ?? "").toLowerCase()),
      ).map((title) => ({ title }));
      break;
    case "lookups.resolveLocation": {
      const point = placeFor(`${args?.latitude},${args?.longitude}`) ?? PLACES.rajapalayam;
      const label =
        Math.abs((args?.latitude ?? 0) - 9.45) < 1
          ? "Rajapalayam, Tamil Nadu, India"
          : "Chennai, Tamil Nadu, India";
      const row = alumnusByEmail(draft, email);
      if (row && row.locationConsent) {
        row.location = label;
        row.locationLat = point?.lat ?? null;
        row.locationLng = point?.lng ?? null;
        row.locationSource = "device";
        row.locationUpdatedAt = Date.now();
      }
      result = { saved: Boolean(row), label, lat: point?.lat ?? null, lng: point?.lng ?? null };
      break;
    }
    case "lookups.locateTypedLocation": {
      const label = String(args?.label ?? "");
      const point = placeFor(label);
      const row = alumnusByEmail(draft, email);
      if (row && point) {
        row.location = label;
        row.locationLat = point.lat;
        row.locationLng = point.lng;
        row.locationSource = "manual";
      }
      result = { saved: Boolean(point && row), lat: point?.lat ?? null, lng: point?.lng ?? null };
      break;
    }
    default:
      result = { ok: true };
  }

  commit(draft);
  return result;
}
