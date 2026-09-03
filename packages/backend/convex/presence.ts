import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";


/**
 * Where the association is, on a map.
 *
 * WHAT MAKES THE COUNTS RIGHT, which is the whole job of this file. A map that
 * says "412 alumni" while plotting 60 dots is worse than no map: it is a claim
 * nobody can check and everybody believes. So this query returns four numbers
 * that always add up, and the page prints all of them:
 *
 *   members        — every profile on record.
 *   placed         — profiles with both a place name and a centroid. These are
 *                    the ones the map can draw, and the sum of every marker's
 *                    count equals exactly this.
 *   named          — profiles with a place name but no centroid yet, because
 *                    the geocoder has not resolved it. Countable, not plottable.
 *   unplaced       — profiles with no location at all.
 *
 * `members === placed + named + unplaced`, and the page says so rather than
 * quietly rounding the difference away.
 *
 * ONE MARKER PER PLACE, NOT PER MEMBER. Alumni are grouped by their place
 * label, so twelve members in Chennai are one marker reading 12 rather than
 * twelve dots stacked on one pixel. That is also what makes the marker count
 * honest at low zoom, where separate dots would overlap into something that
 * looks like three people.
 *
 * REAL TIME comes for free. This is a Convex query, so every client watching
 * it re-renders when any profile's location changes — a member who allows
 * detection on sign-in in Dubai moves their dot on every open map within the
 * second, with no polling and no refresh.
 *
 * A SESSION IS THE GATE, not a role. A member who has just signed in is a
 * guest until the office verifies them by hand, and this map is meant to be the
 * first thing they see after signing in — gating it on `requireMember` would
 * show it to almost nobody. Anonymous callers get nothing at all.
 *
 * It refuses SOFTLY, returning `authorized: false`, because a query that throws
 * propagates into the React render and takes the route down; the page needs to
 * draw a sign-in notice instead. Names come back only for places small enough
 * that a name adds something, and never with an address or a phone number.
 */

/** The institute itself. Every arc on the map starts here. */
export const CAMPUS = {
  label: "Ramco Institute of Technology, Rajapalayam",
  lat: 9.4533,
  lng: 77.5533,
} as const;

/**
 * Above this many members in one place, the names are dropped.
 *
 * A marker reading "3 alumni: Priya, Karthik, Meena" is useful to a member
 * planning a visit. A marker reading two hundred names is a mailing list, so
 * past this the marker carries the count alone.
 */
const NAME_LIMIT = 12;

/** Round to ~11 m so two members in one town share exactly one marker. */
function keyFor(lat: number, lng: number, label: string) {
  return `${label.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
}

type Place = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  count: number;
  /** Empty once a place holds more members than NAME_LIMIT. */
  names: string[];
  /** How many of this place's members are verified alumni. */
  verified: number;
};

function displayName(row: Doc<"alumni">) {
  const first = (row.firstName ?? "").trim();
  const last = (row.lastName ?? "").trim();
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || row.name.trim();
}

export const map = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) {
      return {
        authorized: false as const,
        campus: CAMPUS,
        places: [] as Place[],
        totals: {
          members: 0,
          placed: 0,
          named: 0,
          unplaced: 0,
          placesShown: 0,
          countries: 0,
        },
      };
    }

    const rows = await ctx.db.query("alumni").collect();

    const places = new Map<string, Place>();
    let placed = 0;
    let named = 0;
    let unplaced = 0;

    for (const row of rows) {
      const label = (row.location ?? "").trim();
      const lat = row.locationLat;
      const lng = row.locationLng;

      if (!label) {
        unplaced += 1;
        continue;
      }
      if (typeof lat !== "number" || typeof lng !== "number") {
        // A place name the geocoder has not resolved. Counted, not drawn.
        named += 1;
        continue;
      }

      placed += 1;
      const key = keyFor(lat, lng, label);
      const existing = places.get(key);
      if (existing) {
        existing.count += 1;
        if (row.verified) existing.verified += 1;
        if (existing.names.length < NAME_LIMIT) {
          existing.names.push(displayName(row));
        }
        continue;
      }
      places.set(key, {
        key,
        label,
        lat,
        lng,
        count: 1,
        names: [displayName(row)],
        verified: row.verified ? 1 : 0,
      });
    }

    const list = [...places.values()]
      .map((place) => ({
        ...place,
        // Past the limit the names stop being useful and start being a list of
        // people, so they are dropped rather than truncated silently.
        names: place.count > NAME_LIMIT ? [] : place.names.sort(),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
      authorized: true as const,
      campus: CAMPUS,
      places: list,
      totals: {
        members: rows.length,
        placed,
        named,
        unplaced,
        placesShown: list.length,
        // `Array.prototype.at` is ES2022 and the Convex tsconfig targets
        // ES2021, so the last segment is taken by index.
        countries: new Set(
          list.map((place) => {
            const parts = place.label.split(",");
            return (parts[parts.length - 1] ?? "").trim();
          }),
        ).size,
      },
    };
  },
});
