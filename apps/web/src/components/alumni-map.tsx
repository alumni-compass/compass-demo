"use client";

import { api, useQuery } from "@/lib/standalone";

import { useMemo, useState } from "react";

import {
  // Aliased: the component is named `Map`, which would shadow the global Map
  // constructor. Everything else keeps the name the mapcn arcs example uses.
  Map as MapCanvas,
  MapArc,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  MarkerLabel,
  type MapArcDatum,
} from "@/components/ui/map";
import { Button, Eyebrow, Pill } from "@/components/kit";

/**
 * The association on a globe, built on the mapcn arcs example.
 *
 * THE STRUCTURE IS THE EXAMPLE'S. A hub marker, a marker per destination and
 * one dashed arc from hub to each — `MapMarker` wrapping `MarkerContent` with a
 * dot and a `MarkerLabel` above it, the way the docs lay it out, with
 * `interactive={false}` on the arcs.
 *
 * WHAT THAT COSTS, once: a `MapMarker` is a DOM node repositioned on every
 * frame of a pan, so this scales with the number of PLACES, not members.
 * `presence.map` groups server-side — one marker per town carrying its own
 * count — so a thousand alumni across forty towns is forty markers. Forty is
 * comfortable. Several hundred distinct towns is the point to revisit it.
 *
 * THE COUNTS STILL ADD UP, because the grouping is on the server: a marker's
 * count is the members in that place, and the markers sum to `placed` exactly.
 * The three figures the map cannot draw are printed above it rather than
 * quietly dropped from the total.
 */

type Place = {
  key: string;
  label: string;
  lat: number;
  lng: number;
  count: number;
  names: string[];
  verified: number;
};

/**
 * How far out and in the member may go.
 *
 * MIN_ZOOM is a floor on purpose. Left unbounded, MapLibre keeps pulling back
 * until the globe is a marble in a grey field — every marker overlaps, the arcs
 * become a smudge and there is nothing left to read. 1.2 is the whole earth
 * filling the viewport, which is as far out as this map has anything to say.
 * The start view is clamped to it too, so a worldwide membership still opens
 * inside the allowed range rather than being snapped on the first interaction.
 */
const MIN_ZOOM = 1.2;
const MAX_ZOOM = 15;

/** Institutional palette, tuned for the dark basemap. */
const MAROON = "#9b1c31";
const BRASS = "#b8863b";
const BRASS_PALE = "#e3c88f";

/**
 * A starting view that frames the members who exist.
 *
 * The example opens at `zoom={1}`, which on a globe is the whole earth — and
 * for an association whose members are mostly in one Indian state, that is a
 * screen of ocean with a cluster of dots too small to read. This measures the
 * spread of the actual places and picks the zoom that fits them: tight on Tamil
 * Nadu while everyone is local, pulling back on its own as alumni turn up in
 * Dubai and Toronto.
 *
 * Computed once, when the map mounts. `MapCanvas` takes `center` and `zoom` as
 * the initial view rather than a controlled one, and the component only renders
 * after the query has resolved, so the numbers are real by then. A member who
 * pans or zooms keeps their view — nothing here fights them for it.
 */
function fitView(
  places: Place[],
  campus: { lat: number; lng: number } | undefined,
): { center: [number, number]; zoom: number } {
  const fallback: [number, number] = [campus?.lng ?? 77.5533, campus?.lat ?? 9.4533];
  if (places.length === 0) {
    // Nobody placed yet: frame the campus and its state rather than the planet.
    return { center: fallback, zoom: 4.2 };
  }

  const lngs = [...places.map((p) => p.lng), campus?.lng ?? fallback[0]];
  const lats = [...places.map((p) => p.lat), campus?.lat ?? fallback[1]];
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const span = Math.max(maxLng - minLng, maxLat - minLat);
  const zoom =
    span > 120 ? 1.1 : span > 60 ? 1.7 : span > 25 ? 2.6 : span > 8 ? 4 : span > 2 ? 5.4 : 6.5;

  return {
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    // Never below the floor the map enforces, or the opening view would be
    // snapped the moment anybody touched it.
    zoom: Math.max(MIN_ZOOM, zoom),
  };
}

export default function AlumniMap() {
  const presence = useQuery(api.presence.map);
  const [selected, setSelected] = useState<Place | null>(null);
  const [showArcs, setShowArcs] = useState(true);

  const places: Place[] = presence?.places ?? [];
  const campus = presence?.campus;

  /** One arc per place, hub to destination, as in the example. */
  const arcs = useMemo<Array<MapArcDatum & { count: number }>>(() => {
    if (!campus) return [];
    return places.map((place) => ({
      id: place.key,
      from: [campus.lng, campus.lat] as [number, number],
      to: [place.lng, place.lat] as [number, number],
      count: place.count,
    }));
  }, [places, campus]);

  const view = useMemo(() => fitView(places, campus), [places, campus]);

  if (presence === undefined) {
    return (
      <div className="h-[76vh] min-h-[30rem] w-full animate-pulse rounded-card border border-line bg-surface-sunk" />
    );
  }

  if (!presence.authorized) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <Eyebrow>Members only</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
          The map shows where members have said they are, so it is behind a
          session. Sign in and it appears — nothing here is readable without one.
        </p>
        <div className="mt-4">
          <Button href="/join">Sign in to RITAA</Button>
        </div>
      </div>
    );
  }

  const { totals } = presence;

  return (
    <div className="space-y-5">
      {/* Every number, including the ones the map cannot draw. */}
      <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
        {[
          { label: "On the map", value: totals.placed, tone: "ink" as const },
          { label: "Places", value: totals.placesShown, tone: "ink" as const },
          { label: "Awaiting a lookup", value: totals.named, tone: "muted" as const },
          { label: "No location shared", value: totals.unplaced, tone: "muted" as const },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface p-4">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-slate-ink">
              {stat.label}
            </p>
            <p
              className={`font-display mt-1 text-2xl tabular-nums ${
                stat.tone === "ink" ? "text-ink" : "text-slate-ink"
              }`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[0.8rem] leading-relaxed text-slate-ink">
        {totals.placed} of {totals.members} member
        {totals.members === 1 ? "" : "s"} are drawn below, across{" "}
        {totals.placesShown} place{totals.placesShown === 1 ? "" : "s"} in{" "}
        {totals.countries} countr{totals.countries === 1 ? "y" : "ies"}. The
        marker counts add up to {totals.placed} exactly — the remaining{" "}
        {totals.named + totals.unplaced} are counted above rather than hidden:{" "}
        {totals.named} shared a place name that has not been located yet, and{" "}
        {totals.unplaced} have not filled in a location.
      </p>

      <div className="relative h-[76vh] min-h-[30rem] overflow-hidden rounded-card border border-line-strong bg-ink shadow-lift">
        <MapCanvas
          className="size-full"
          theme="dark"
          center={view.center}
          zoom={view.zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          projection={{ type: "globe" }}
          attributionControl={{ compact: true }}
        >
          <MapControls
            position="bottom-right"
            showZoom
            showCompass
            showFullscreen
            showLocate={false}
          />

          {showArcs ? (
            <MapArc
              data={arcs}
              paint={{
                "line-color": BRASS,
                "line-dasharray": [2, 2],
                // Every field on the datum but from/to reaches an expression,
                // so the busiest routes read as the thickest line.
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["get", "count"],
                  1,
                  0.8,
                  25,
                  2.2,
                  200,
                  3.6,
                ],
              }}
              interactive={false}
            />
          ) : null}

          {/* The hub: the institute every arc runs back to. */}
          {campus ? (
            <MapMarker longitude={campus.lng} latitude={campus.lat}>
              <MarkerContent>
                <div
                  className="size-3 rounded-full border-2 border-white"
                  style={{ backgroundColor: MAROON }}
                />
                <MarkerLabel
                  position="top"
                  className="font-mono rounded-sm bg-bone/85 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink backdrop-blur"
                >
                  Rajapalayam
                </MarkerLabel>
              </MarkerContent>
            </MapMarker>
          ) : null}

          {/* One marker per place. The count rides in the label, because a
              marker reading "Chennai" that hides the twelve people behind it is
              the map understating the association. */}
          {places.map((place) => (
            <MapMarker
              key={place.key}
              longitude={place.lng}
              latitude={place.lat}
              onClick={() => setSelected(place)}
            >
              <MarkerContent>
                <div
                  className="size-2 cursor-pointer rounded-full border-2 border-white"
                  style={{ backgroundColor: BRASS_PALE }}
                />
                <MarkerLabel position="top">
                  {place.label.split(",")[0]}
                  {place.count > 1 ? ` · ${place.count}` : ""}
                </MarkerLabel>
              </MarkerContent>
            </MapMarker>
          ))}

          {selected ? (
            <MapPopup
              longitude={selected.lng}
              latitude={selected.lat}
              closeButton
              onClose={() => setSelected(null)}
            >
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-slate-ink">
                {selected.label}
              </p>
              <p className="font-display mt-1 text-lg text-ink">
                {selected.count} member{selected.count === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-slate-ink">
                {selected.verified} verified
              </p>
              {selected.names.length > 0 ? (
                <p className="mt-2 border-t border-line pt-2 text-[0.78rem] leading-snug text-ink">
                  {selected.names.join(", ")}
                </p>
              ) : (
                <p className="mt-2 border-t border-line pt-2 text-[0.75rem] leading-snug text-slate-ink">
                  Too many to name here — open the directory and filter by this
                  place.
                </p>
              )}
            </MapPopup>
          ) : null}
        </MapCanvas>
      </div>

      {/* The list is the audit trail for the map: same numbers, readable. */}
      <div className="rounded-card border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <Eyebrow>Every place, by size</Eyebrow>
          <div className="flex items-center gap-3">
            <Pill tone="quiet">
              Sum of the list:{" "}
              {places.reduce((sum, place) => sum + place.count, 0)}
            </Pill>
            <button
              type="button"
              onClick={() => setShowArcs((value) => !value)}
              className="font-mono rounded-control border border-line px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.1em] text-slate-ink transition-colors hover:border-maroon hover:text-maroon"
            >
              {showArcs ? "Hide arcs" : "Show arcs"}
            </button>
          </div>
        </div>

        {places.length === 0 ? (
          <p className="p-5 text-[0.85rem] leading-relaxed text-slate-ink">
            Nobody has a located place yet. As members fill in the details form
            — or allow the per-sign-in refresh — they appear here and on the map
            without anyone reloading.
          </p>
        ) : (
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {places.map((place) => (
              <li key={place.key} className="bg-surface">
                <button
                  type="button"
                  onClick={() => setSelected(place)}
                  className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bone ${
                    selected?.key === place.key ? "bg-bone" : ""
                  }`}
                >
                  <span className="min-w-0 truncate text-[0.85rem] leading-snug text-ink">
                    {place.label}
                  </span>
                  <span className="font-mono shrink-0 text-[0.75rem] tabular-nums text-maroon">
                    {place.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
