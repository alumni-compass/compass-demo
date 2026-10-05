import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireActionIdentity } from "./authz";

/**
 * Suggestions for the two fields nobody can enumerate: employer and job title.
 *
 * WHY THESE ARE NOT DROPDOWNS. There is no list of every company in the world
 * behind a free endpoint, and there is no canonical list of every job title at
 * all. A dropdown built from either would be a dropdown that eventually cannot
 * describe a member — the one who joined a six-person startup last week, or the
 * one whose title is "Scientist F". So both fields are comboboxes: the member
 * types, these actions suggest, and whatever the member finally types is what
 * gets saved. Suggestions make the common answers consistent, which is what the
 * association actually wanted from a dropdown; they do not gate the field.
 *
 * WHY ACTIONS AND NOT `fetch` FROM THE BROWSER. Three reasons, in order of
 * how much they matter. The browser cannot reach most of these hosts, because
 * they send no CORS headers. Any of them may later need a key, and a key in a
 * client bundle is a published key. And a proxy is the only place a fallback
 * can live — when the primary source is down or has been sunset, the member
 * should get the second-best list rather than an error.
 *
 * SIGNED IN ONLY. Every action here calls out to a third party on the caller's
 * behalf, so leaving them open would turn the deployment into an anonymous
 * proxy for anyone who found the URL. The details form is behind a session
 * anyway, so requiring one costs nothing.
 *
 * NO KEYS ARE NEEDED TODAY. Every source below is open: Clearbit and Wikidata
 * for employers, ESCO for job titles, Nominatim and Photon for turning a
 * browser fix into a place name. Each call is wrapped so that a source going
 * away degrades the answer rather than breaking the form, and `selfTest` at
 * the bottom reports which of them are actually answering.
 */

/** Suggestion lists are for choosing from, not browsing. */
const LIMIT = 8;
/** One character is enough to start looking; the cache absorbs the volume. */
const MIN_QUERY = 1;
/** A suggestion box that has not answered in three seconds is not helping. */
const TIMEOUT_MS = 3000;

async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        // Nominatim and Wikidata both ask callers to identify themselves.
        "User-Agent": "RITAA-alumni-portal/1.0 (+https://ritrjpm.ac.in)",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // A dead source must not fail the form. The caller falls through.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function dedupe<T>(rows: T[], keyOf: (row: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The cache                                                           */
/* ------------------------------------------------------------------ */

/**
 * How long an answer is worth reusing.
 *
 * Companies move slowly and job taxonomies move slower. A week and a month are
 * both far shorter than the rate at which either list actually changes, and the
 * point of the cache is the twentieth member typing "infos", not the freshness
 * of the tenth character.
 */
const CACHE_TTL = {
  company: 7 * 24 * 60 * 60 * 1000,
  position: 30 * 24 * 60 * 60 * 1000,
} as const;

const kindValidator = v.union(v.literal("company"), v.literal("position"));

/** One key per question, so casing and padding cannot fork the cache. */
function cacheKey(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The cached answer, if there is a fresh one.
 *
 * A QUERY, deliberately, and that is the whole performance fix. The client
 * subscribes to this over the socket it already holds, so a hit costs no
 * network request at all. On a miss it returns `hit: false`, the client fires
 * the action once, the action writes the row, and this subscription delivers
 * the result without the client asking again.
 *
 * Public: it returns public facts about public companies, keyed on a fragment
 * of a company name. There is nothing here belonging to a member.
 */
export const cached = query({
  args: { kind: kindValidator, query: v.string() },
  handler: async (ctx, args) => {
    const key = cacheKey(args.query);
    if (key.length < MIN_QUERY) return { hit: false as const, rows: [] };

    const row = await ctx.db
      .query("lookupCache")
      .withIndex("by_kind_query", (q) => q.eq("kind", args.kind).eq("query", key))
      .unique();

    if (!row) return { hit: false as const, rows: [] };
    if (Date.now() - row.fetchedAt > CACHE_TTL[args.kind]) {
      // Stale rows are served anyway rather than withheld: a slightly old list
      // beats an empty box while the action refetches behind it.
      return { hit: true as const, stale: true, rows: JSON.parse(row.payload) };
    }
    return { hit: true as const, stale: false, rows: JSON.parse(row.payload) };
  },
});

export const remember = internalMutation({
  args: { kind: kindValidator, query: v.string(), payload: v.string() },
  handler: async (ctx, args) => {
    const key = cacheKey(args.query);
    const existing = await ctx.db
      .query("lookupCache")
      .withIndex("by_kind_query", (q) => q.eq("kind", args.kind).eq("query", key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        payload: args.payload,
        fetchedAt: Date.now(),
      });
      return { updated: true };
    }
    await ctx.db.insert("lookupCache", {
      kind: args.kind,
      query: key,
      payload: args.payload,
      fetchedAt: Date.now(),
    });
    return { updated: false };
  },
});

/**
 * Drops cached answers, so the next lookup goes back to the source.
 *
 * Operational tool rather than application code. Reasons to reach for it: a
 * source has started returning better results and the old ones are still
 * inside the TTL, or a row was written by hand during testing and is now
 * shadowing the real answer.
 *
 *   npx convex run lookups:clearCache '{"kind":"company"}'
 *   npx convex run lookups:clearCache '{"kind":"company","query":"infos"}'
 *
 * Internal: the cache is a performance detail, and nothing a browser holds
 * should be able to empty it and send every subsequent keystroke to a third
 * party.
 */
export const clearCache = internalMutation({
  args: { kind: kindValidator, query: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.query !== undefined) {
      const row = await ctx.db
        .query("lookupCache")
        .withIndex("by_kind_query", (q) =>
          q.eq("kind", args.kind).eq("query", cacheKey(args.query!)),
        )
        .unique();
      if (row) await ctx.db.delete(row._id);
      return { deleted: row ? 1 : 0 };
    }

    const rows = await ctx.db
      .query("lookupCache")
      .withIndex("by_kind_query", (q) => q.eq("kind", args.kind))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});

/* ------------------------------------------------------------------ */
/* Logos                                                               */
/* ------------------------------------------------------------------ */

/**
 * A logo address for a company domain, built here rather than in the browser.
 *
 * TWO SOURCES, and the better one needs a free key.
 *
 *   logo.dev — set LOGO_DEV_TOKEN and every suggestion carries a proper,
 *              sized logo. The token is a PUBLISHABLE key, meant to appear in
 *              an image URL, which is why returning it inside one is fine:
 *                  npx convex env set LOGO_DEV_TOKEN pk_xxxxx
 *              Get it free at logo.dev — that is the API key worth having here.
 *
 *   DuckDuckGo — the fallback, no key, no signup. Lower resolution and it is a
 *              favicon rather than a logo, but it is a real image for almost
 *              every company with a domain, so the dropdown has marks today
 *              without anybody registering for anything.
 *
 * Clearbit's logo service, which the earlier draft would have used, is gone:
 * `logo.clearbit.com` no longer resolves at all. Its autocomplete endpoint also
 * returns `logo: null` on every row now, which is why the address is built from
 * the domain instead of read from the response.
 */
function logoFor(domain: string | null): string | null {
  if (!domain) return null;
  const token = process.env.LOGO_DEV_TOKEN;
  if (token) {
    return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}&size=64&format=png`;
  }
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

/* ------------------------------------------------------------------ */
/* What the association already has                                    */
/* ------------------------------------------------------------------ */

/**
 * Employers and titles other members have already entered.
 *
 * These go first in the list. A name three alumni have already used is a better
 * suggestion than a stranger's near-match, and it is what keeps "Infosys",
 * "Infosys Ltd" and "infosys limited" from becoming three employers in the
 * directory facets.
 *
 * Internal: it reads a column off every profile, so it must not be callable
 * from a browser on its own.
 */
export const localValues = internalQuery({
  args: {
    field: v.union(v.literal("company"), v.literal("designation")),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const needle = args.query.trim().toLowerCase();
    if (!needle) return [];
    const rows = await ctx.db.query("alumni").collect();
    const values = rows
      .map((row) => (args.field === "company" ? row.company : row.designation))
      .map((value) => (value ?? "").trim())
      .filter((value) => value.length > 0 && value.toLowerCase().includes(needle));
    return dedupe(values, (value) => value).slice(0, 4);
  },
});

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/* ------------------------------------------------------------------ */

type CompanyHit = {
  name: string;
  domain: string | null;
  /** Ready to drop into an <img src>. Null when there is no domain. */
  logoUrl: string | null;
};

/**
 * Clearbit's autocomplete endpoint — the primary source.
 *
 * Open, no key, and the one built for exactly this: type a few letters, get
 * company names with their domains. The domain is worth keeping, because it is
 * what makes "Apple" the computer company distinguishable from "Apple" the
 * record label in a directory listing.
 */
async function clearbitCompanies(query: string): Promise<CompanyHit[]> {
  const data = await getJson(
    `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`,
  );
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const item = row as { name?: unknown; domain?: unknown };
    if (typeof item.name !== "string" || !item.name.trim()) return [];
    const domain = typeof item.domain === "string" ? item.domain : null;
    return [{ name: item.name.trim(), domain, logoUrl: logoFor(domain) }];
  });
}

/**
 * Wikidata, as the fallback.
 *
 * Slower and narrower — it knows notable organisations, not every registered
 * company — but it is a public good with no key, no quota worth worrying about
 * and no owner who might sunset it next quarter. It is here so that the day
 * Clearbit stops answering, the field degrades to a smaller list instead of an
 * error.
 */
async function wikidataCompanies(query: string): Promise<CompanyHit[]> {
  const data = await getJson(
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=8&search=" +
      encodeURIComponent(query),
  );
  const search = (data as { search?: unknown } | null)?.search;
  if (!Array.isArray(search)) return [];
  return search.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const item = row as { label?: unknown; description?: unknown };
    if (typeof item.label !== "string" || !item.label.trim()) return [];
    const description =
      typeof item.description === "string" ? item.description.toLowerCase() : "";
    // wbsearchentities is a general entity search, so filter to things that
    // read like an organisation. Without this, "apple" suggests the fruit.
    const organisational = [
      "company",
      "business",
      "enterprise",
      "corporation",
      "manufacturer",
      "bank",
      "organisation",
      "organization",
      "firm",
      "startup",
      "conglomerate",
      "institute",
      "university",
      "college",
      "agency",
      "retailer",
      "airline",
    ].some((word) => description.includes(word));
    if (!organisational) return [];
    return [{ name: item.label.trim(), domain: null, logoUrl: null }];
  });
}

export const companies = action({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<CompanyHit[]> => {
    await requireActionIdentity(ctx);
    const query = args.query.trim();
    if (query.length < MIN_QUERY) return [];

    // The cache is checked here as well as in the client, because two members
    // typing the same prefix at the same moment both arrive before either has
    // written a row.
    const hit = await ctx.runQuery(api.lookups.cached, {
      kind: "company",
      query,
    });
    if (hit.hit && !hit.stale) return hit.rows as CompanyHit[];

    const local: CompanyHit[] = (
      await ctx.runQuery(internal.lookups.localValues, {
        field: "company",
        query,
      })
    ).map((name: string) => ({ name, domain: null, logoUrl: null }));

    let remote = await clearbitCompanies(query);
    if (remote.length === 0) remote = await wikidataCompanies(query);

    const rows = dedupe([...local, ...remote], (row) => row.name).slice(0, LIMIT);
    if (rows.length > 0) {
      await ctx.runMutation(internal.lookups.remember, {
        kind: "company",
        query,
        payload: JSON.stringify(rows),
      });
    }
    return rows;
  },
});

/* ------------------------------------------------------------------ */
/* Positions                                                           */
/* ------------------------------------------------------------------ */

/**
 * When ESCO cannot be reached.
 *
 * Deliberately short. This is not an attempt to list every job — it is the
 * handful that cover most of an engineering college's alumni, so that a member
 * filling the form during an outage still gets a sane suggestion instead of an
 * empty box. Anything not here is still typeable.
 */
const FALLBACK_POSITIONS = [
  "Software Engineer",
  "Senior Software Engineer",
  "Software Developer",
  "Full Stack Developer",
  "Frontend Developer",
  "Backend Developer",
  "Mobile Application Developer",
  "Data Engineer",
  "Data Scientist",
  "Data Analyst",
  "Machine Learning Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Cloud Engineer",
  "QA Engineer",
  "Test Engineer",
  "Systems Engineer",
  "Network Engineer",
  "Security Engineer",
  "Database Administrator",
  "Embedded Systems Engineer",
  "Hardware Engineer",
  "Electronics Engineer",
  "Electrical Engineer",
  "Mechanical Engineer",
  "Design Engineer",
  "Production Engineer",
  "Manufacturing Engineer",
  "Quality Engineer",
  "Maintenance Engineer",
  "Civil Engineer",
  "Structural Engineer",
  "Site Engineer",
  "Project Engineer",
  "Project Manager",
  "Program Manager",
  "Product Manager",
  "Business Analyst",
  "Technical Lead",
  "Engineering Manager",
  "Solution Architect",
  "Consultant",
  "Senior Consultant",
  "Associate",
  "Analyst",
  "Research Scholar",
  "Assistant Professor",
  "Associate Professor",
  "Professor",
  "Lecturer",
  "Teacher",
  "Founder",
  "Co-founder",
  "Director",
  "Managing Director",
  "Chief Executive Officer",
  "Chief Technology Officer",
  "Operations Manager",
  "Sales Manager",
  "Marketing Manager",
  "Human Resources Manager",
  "Accountant",
  "Chartered Accountant",
  "Civil Services Officer",
  "Bank Officer",
  "Intern",
  "Trainee",
  "Graduate Engineer Trainee",
  "Higher Studies",
  "Self-employed",
];

type PositionHit = { title: string; source: "esco" | "local" | "list" };

/**
 * ESCO — the European Commission's occupation taxonomy.
 *
 * About three thousand occupations, each with an ISCO group behind it, free and
 * open with no key and no registration. It is the closest thing to a canonical
 * list of job titles that anyone publishes, which is why it is the primary
 * source rather than a hand-written list that would go stale.
 */
async function escoPositions(query: string): Promise<PositionHit[]> {
  const data = await getJson(
    "https://ec.europa.eu/esco/api/search?language=en&type=occupation&limit=8&text=" +
      encodeURIComponent(query),
  );
  const results = (
    data as { _embedded?: { results?: unknown } } | null
  )?._embedded?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const item = row as { title?: unknown };
    if (typeof item.title !== "string" || !item.title.trim()) return [];
    // ESCO titles are lower case by convention; the form shows job titles.
    const title = item.title.trim();
    return [{ title: title.charAt(0).toUpperCase() + title.slice(1), source: "esco" as const }];
  });
}

export const positions = action({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<PositionHit[]> => {
    await requireActionIdentity(ctx);
    const query = args.query.trim();
    if (query.length < MIN_QUERY) return [];
    const needle = query.toLowerCase();

    const hit = await ctx.runQuery(api.lookups.cached, {
      kind: "position",
      query,
    });
    if (hit.hit && !hit.stale) return hit.rows as PositionHit[];

    const local: PositionHit[] = (
      await ctx.runQuery(internal.lookups.localValues, {
        field: "designation",
        query,
      })
    ).map((title: string) => ({ title, source: "local" as const }));

    const remote = await escoPositions(query);
    const listed: PositionHit[] =
      remote.length === 0
        ? FALLBACK_POSITIONS.filter((title) =>
            title.toLowerCase().includes(needle),
          ).map((title) => ({ title, source: "list" as const }))
        : [];

    const rows = dedupe([...local, ...remote, ...listed], (row) => row.title).slice(
      0,
      LIMIT,
    );
    if (rows.length > 0) {
      await ctx.runMutation(internal.lookups.remember, {
        kind: "position",
        query,
        payload: JSON.stringify(rows),
      });
    }
    return rows;
  },
});

/* ------------------------------------------------------------------ */
/* Location                                                            */
/* ------------------------------------------------------------------ */

/**
 * The nine directory regions, and how a detected place maps onto one.
 *
 * The directory filters on `region`, which is a coarse bucket; the form now
 * captures a precise place. Rather than ask for both and make the member
 * reconcile them, the precise place is mapped here. Anything outside India is
 * "Overseas"; anything in India matching none of the eight named places returns
 * null and leaves whatever region the member already had.
 */
const REGION_MATCHES: Array<{ region: string; needles: string[] }> = [
  { region: "Rajapalayam", needles: ["rajapalayam"] },
  { region: "Madurai", needles: ["madurai"] },
  { region: "Chennai", needles: ["chennai", "madras"] },
  { region: "Coimbatore", needles: ["coimbatore", "kovai"] },
  { region: "Bengaluru", needles: ["bengaluru", "bangalore"] },
  { region: "Hyderabad", needles: ["hyderabad", "secunderabad"] },
  { region: "Pune", needles: ["pune", "pimpri", "chinchwad"] },
  {
    region: "Delhi NCR",
    needles: ["delhi", "gurgaon", "gurugram", "noida", "ghaziabad", "faridabad"],
  },
];

function regionFor(label: string, countryCode: string): string | null {
  if (countryCode && countryCode.toUpperCase() !== "IN") return "Overseas";
  const haystack = label.toLowerCase();
  for (const entry of REGION_MATCHES) {
    if (entry.needles.some((needle) => haystack.includes(needle))) {
      return entry.region;
    }
  }
  return null;
}

type Place = {
  label: string;
  countryCode: string;
  /** Centroid of the named place. Absent when the source did not give one. */
  lat?: number;
  lng?: number;
};

function placeFrom(
  parts: Array<string | null>,
  countryCode: string,
  coordinates?: { lat: number; lng: number },
): Place | null {
  const label = dedupe(
    parts.filter((part): part is string => Boolean(part && part.trim())),
    (part) => part,
  ).join(", ");
  if (!label) return null;
  return { label, countryCode, lat: coordinates?.lat, lng: coordinates?.lng };
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/**
 * Forward-geocodes a place NAME to its centroid.
 *
 * Used for two cases: a member who typed their location instead of detecting
 * it, and a label that came from the fallback geocoder. In both, the input is
 * a name — so the output is by construction the centre of that name and not
 * anybody's actual position.
 */
async function geocodeLabel(
  label: string,
): Promise<{ lat: number; lng: number } | null> {
  const query = label.trim();
  if (query.length < 2) return null;
  const data = await getJson(
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
      encodeURIComponent(query),
  );
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { lat?: unknown; lon?: unknown };
  const lat = asNumber(row.lat);
  const lng = asNumber(row.lon);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

/**
 * Nominatim, the OpenStreetMap geocoder — the primary source.
 *
 * `zoom=10` IS THE IMPORTANT PARAMETER, and it is a privacy decision rather
 * than a performance one. At full precision a reverse lookup returns the
 * building — the clinic, the hostel, the house. The form asks a member where
 * they are, not which door they are behind, so the request is made at
 * town level and the street and house fields are never read.
 *
 * OSM asks two things of callers: identify yourself with a real User-Agent
 * (`getJson` sends one) and stay under a request per second. One lookup per
 * member per sign-in is far inside that; if this portal ever needs more, the
 * policy asks that the service be self-hosted rather than hammered.
 *
 * This replaced BigDataCloud, which the earlier draft used. Its free endpoint
 * is `reverse-geocode-client` — built for a browser, and it does not answer a
 * request from a datacentre address, which is exactly what a Convex action is.
 * It worked when tested from a laptop and returned nothing from the deployment;
 * `selfTest` below is what made that visible.
 */
async function nominatimPlace(
  latitude: number,
  longitude: number,
): Promise<Place | null> {
  const data = await getJson(
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1" +
      `&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
  );
  const address = (data as { address?: unknown } | null)?.address;
  if (!address || typeof address !== "object") return null;

  const row = address as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  const countryCode = pick("country_code") ?? "";
  // `zoom=10` made this the town's own point, so it needs no second lookup.
  const top = data as { lat?: unknown; lon?: unknown };
  const lat = asNumber(top.lat);
  const lng = asNumber(top.lon);

  return placeFrom(
    [
      pick("town", "city", "village", "municipality", "suburb", "county"),
      pick("state", "region"),
      pick("country"),
    ],
    countryCode.toUpperCase(),
    lat !== null && lng !== null ? { lat, lng } : undefined,
  );
}

/**
 * Photon, as the fallback. Also OSM data, also open, also no key.
 *
 * Only the administrative properties are read — `city`, `state`, `country` —
 * and never `name` or `street`, because Photon answers a reverse lookup with
 * the nearest feature, which for these coordinates is somebody's dental
 * clinic. The same coarseness rule as above, enforced by what is read rather
 * than by a parameter.
 */
async function photonPlace(
  latitude: number,
  longitude: number,
): Promise<Place | null> {
  const data = await getJson(
    "https://photon.komoot.io/reverse?limit=1" +
      `&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
  );
  const features = (data as { features?: unknown } | null)?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const properties = (features[0] as { properties?: unknown } | null)?.properties;
  if (!properties || typeof properties !== "object") return null;

  const row = properties as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  // Photon's `geometry` is the nearest feature — a shop, a clinic, a house —
  // so it is deliberately NOT read as a centroid. The label is forward-geocoded
  // instead, which returns the centre of the town that label names.
  return placeFrom(
    [pick("city", "county", "district", "locality"), pick("state"), pick("country")],
    (pick("countrycode") ?? "").toUpperCase(),
  );
}

/**
 * Turns a browser fix into a place name, and records it.
 *
 * WHAT REACHES THIS FUNCTION and what does not. The browser sends a latitude
 * and a longitude; they are handed to the geocoder and then dropped. Only the
 * town-level label — "Rajapalayam, Tamil Nadu, India" — is written to the
 * profile. Nothing stores the coordinates, so no history of where a member has
 * signed in from can be reconstructed from this database.
 *
 * The consent check is inside `profiles.applyDetectedLocation`, not here, so
 * the one function that writes the field is the one that enforces the
 * permission. This action still returns the label when the write is refused —
 * a member filling the form for the first time has no profile to consent on
 * yet, and the box should fill in anyway so their first save carries it.
 */
export const resolveLocation = action({
  args: { latitude: v.number(), longitude: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ saved: boolean; label: string | null; reason?: string }> => {
    const identity = await requireActionIdentity(ctx);
    const email = identity.email?.trim().toLowerCase();
    if (!email) return { saved: false, label: null, reason: "no-email" };

    if (
      !Number.isFinite(args.latitude) ||
      !Number.isFinite(args.longitude) ||
      Math.abs(args.latitude) > 90 ||
      Math.abs(args.longitude) > 180
    ) {
      return { saved: false, label: null, reason: "bad-coordinates" };
    }

    const place =
      (await nominatimPlace(args.latitude, args.longitude)) ??
      (await photonPlace(args.latitude, args.longitude));

    if (!place) {
      return { saved: false, label: null, reason: "geocoder-unavailable" };
    }

    // The fallback path has a name but no centroid; look the name up.
    const centre =
      place.lat !== undefined && place.lng !== undefined
        ? { lat: place.lat, lng: place.lng }
        : await geocodeLabel(place.label);

    const result = await ctx.runMutation(internal.profiles.applyDetectedLocation, {
      email,
      location: place.label,
      region: regionFor(place.label, place.countryCode) ?? undefined,
      lat: centre?.lat,
      lng: centre?.lng,
    });

    return { saved: result.saved, label: place.label, reason: result.reason };
  },
});

/**
 * Puts a member who TYPED their location on the map.
 *
 * The detection path gets a centroid for free from the reverse lookup. A member
 * who typed "Chennai" has given a name and nothing else, so the name is
 * forward-geocoded here. Same invariant as everywhere else in this module: the
 * stored point is the centre of a named place, so two members in one city share
 * one coordinate pair and neither is locatable from it.
 *
 * Called by the details form after a save, and safe to call again — it simply
 * rewrites the same centroid.
 */
export const locateTypedLocation = action({
  args: { label: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ saved: boolean; lat: number | null; lng: number | null }> => {
    const identity = await requireActionIdentity(ctx);
    const email = identity.email?.trim().toLowerCase();
    if (!email) return { saved: false, lat: null, lng: null };

    const label = args.label.trim();
    if (!label) return { saved: false, lat: null, lng: null };

    const centre = await geocodeLabel(label);
    if (!centre) return { saved: false, lat: null, lng: null };

    const result = await ctx.runMutation(internal.profiles.applyTypedCentroid, {
      email,
      location: label,
      lat: centre.lat,
      lng: centre.lng,
      region: regionFor(label, "") ?? undefined,
    });

    return { saved: result.saved, lat: centre.lat, lng: centre.lng };
  },
});

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/**
 * Asks each source whether it is still there.
 *
 * Every suggestion in this module comes from somebody else's endpoint, and none
 * of them owes this portal an uptime promise — Clearbit in particular has
 * changed hands and could be retired. The form degrades quietly when a source
 * stops answering, which is right for a member filling it in and useless for an
 * administrator wondering why the suggestions got worse. This is how to find
 * out without waiting for a complaint, and it is what caught the geocoder that
 * worked from a laptop and not from the deployment:
 *
 *   npx convex run lookups:selfTest
 *
 * Internal, so it is not a public endpoint anyone can use to make this
 * deployment probe four third parties on demand.
 */
export const selfTest = internalAction({
  args: {},
  handler: async () => {
    const [clearbit, wikidata, esco, nominatim, photon, forward] =
      await Promise.all([
        clearbitCompanies("infos"),
        wikidataCompanies("infosys"),
        escoPositions("software engineer"),
        nominatimPlace(9.4533, 77.5533),
        photonPlace(9.4533, 77.5533),
        // The path that places a member who TYPED their location.
        geocodeLabel("Chennai, Tamil Nadu, India"),
      ]);

    return {
      companies: {
        clearbit: { ok: clearbit.length > 0, sample: clearbit[0]?.name ?? null },
        wikidata: { ok: wikidata.length > 0, sample: wikidata[0]?.name ?? null },
      },
      positions: {
        esco: { ok: esco.length > 0, sample: esco[0]?.title ?? null },
        fallbackSize: FALLBACK_POSITIONS.length,
      },
      location: {
        nominatim: {
          ok: nominatim !== null,
          sample: nominatim?.label ?? null,
          centroid:
            nominatim?.lat !== undefined && nominatim?.lng !== undefined
              ? [nominatim.lat, nominatim.lng]
              : null,
        },
        photon: { ok: photon !== null, sample: photon?.label ?? null },
        forwardGeocode: {
          ok: forward !== null,
          sample: forward ? [forward.lat, forward.lng] : null,
        },
      },
    };
  },
});
