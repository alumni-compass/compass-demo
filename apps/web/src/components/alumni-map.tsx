"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";

import {
  // Aliased: the component is named `Map`, which would shadow the global Map
  // constructor this file uses to index places by key.
  Map as MapCanvas,
  MapArc,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  MarkerLabel,
  useMap,
  type MapArcDatum,
} from "@/components/ui/map";
import { Button, Eyebrow, Pill } from "@/components/kit";

/**
 * Where the association is, drawn from the locations members have shared.
 *
 * MARKERS ARE A GEOJSON LAYER, NOT COMPONENTS. One `<MapMarker>` per place is
 * one DOM node per place, and a directory that grows to a few thousand members
 * across a few hundred towns would be a few hundred absolutely-positioned divs
 * being repositioned on every frame of a pan. The source and the circle layer
 * below live on the WebGL canvas instead, which is what MapLibre is for; the
 * only DOM the map creates is the single popup for the place under the cursor.
 *
 * WHY NOT `MapClusterLayer`, which would have been one line. Clustering counts
 * POINTS, and a point here is a place holding any number of alumni. Three
 * clustered towns of twelve would draw a cluster reading "3" — the marker
 * would be wrong by a factor of twelve, and wrong in the direction that
 * flatters. Counts are the thing the association will read off this map, so the
 * grouping happens server-side in `presence.map`, one feature per place with
 * its own `count`, and the circle is sized by that count rather than by how
 * many dots happen to overlap.
 *
 * THE NUMBERS ADD UP, and the panel prints all of them. `placed` is what the
 * map can draw, `named` is a member whose place name has not been geocoded yet,
 * `unplaced` is a member who has shared no location. Their sum is the whole
 * membership. A map that showed only `placed` and called it the alumni count
 * would be understating the association by however many people never opened
 * the form.
 *
 * REAL TIME is the Convex subscription, not a refresh loop. `presence.map` is
 * a reactive query: when a member allows detection on sign-in from a new city,
 * every open copy of this map moves their dot and re-totals the counts within
 * the second.
 *
 * NO COUNT IS DRAWN AS TEXT ON THE CANVAS. A symbol layer needs glyphs from the
 * basemap style, and a font the style does not ship is a silent layer error, so
 * the numbers live in the popup and the ranked list — both of which are also
 * selectable and readable by a screen reader, which canvas text is not.
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

const SOURCE_ID = "ritaa-places";
const CIRCLE_LAYER = "ritaa-places-circle";
const HALO_LAYER = "ritaa-places-halo";

/*
 * Colours for a DARK basemap.
 *
 * Crest maroon is the portal's action colour and it is the wrong choice on a
 * dark globe — a dark red on near-black reads as a smudge. The dots take the
 * pale brass instead, which is still the association's palette and carries
 * against both ocean and land tiles, with an ink stroke so a dot over a bright
 * city glow keeps its edge. Maroon stays for the one thing that should draw the
 * eye first: the campus itself.
 */
const MAROON = "#9b1c31";
const BRASS = "#b8863b";
const BRASS_PALE = "#e3c88f";
const INK = "#151a2e";

/**
 * The places layer.
 *
 * A child of `<Map>` rather than a prop on it, because `useMap` is how this
 * component library hands out the MapLibre instance — the same shape the
 * "markers via layers" guidance uses.
 */
function PlacesLayer({
  places,
  onSelect,
}: {
  places: Place[];
  onSelect: (place: Place | null) => void;
}) {
  const { map, isLoaded } = useMap();

  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: places.map((place) => ({
        type: "Feature" as const,
        // Promoted to the feature id so hover and click have a stable handle.
        id: place.key,
        geometry: {
          type: "Point" as const,
          coordinates: [place.lng, place.lat] as [number, number],
        },
        properties: {
          key: place.key,
          label: place.label,
          count: place.count,
          verified: place.verified,
        },
      })),
    }),
    [places],
  );

  useEffect(() => {
    if (!map || !isLoaded) return;

    const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (existing) {
      // The query is reactive, so an update is the common case, not the rare
      // one: replace the data rather than tearing the layer down and back up.
      existing.setData(data);
      return;
    }

    map.addSource(SOURCE_ID, { type: "geojson", data, promoteId: "key" });

    // A soft halo under the dot, so a single member in a big empty country is
    // still findable at low zoom without inflating the dot itself.
    map.addLayer({
      id: HALO_LAYER,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-color": BRASS_PALE,
        "circle-opacity": 0.16,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          1,
          10,
          25,
          22,
          200,
          34,
        ],
      },
    });

    // Radius carries the count — area would be more honest still, but at these
    // magnitudes a linear radius reads better and the exact number is one
    // click away in the popup and always visible in the list beside the map.
    map.addLayer({
      id: CIRCLE_LAYER,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-color": BRASS_PALE,
        "circle-opacity": 0.95,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": INK,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          1,
          5,
          25,
          11,
          200,
          18,
        ],
      },
    });
  }, [map, isLoaded, data]);

  /* Events are registered once and read the latest features from the map. */
  useEffect(() => {
    if (!map || !isLoaded) return;

    const byKey = new Map(places.map((place) => [place.key, place]));

    function onClick(event: MapMouseEvent) {
      if (!map) return;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: [CIRCLE_LAYER],
      });
      const key = hits[0]?.properties?.key;
      onSelect(typeof key === "string" ? (byKey.get(key) ?? null) : null);
    }
    function onEnter() {
      if (map) map.getCanvas().style.cursor = "pointer";
    }
    function onLeave() {
      if (map) map.getCanvas().style.cursor = "";
    }

    map.on("click", CIRCLE_LAYER, onClick);
    map.on("mouseenter", CIRCLE_LAYER, onEnter);
    map.on("mouseleave", CIRCLE_LAYER, onLeave);

    return () => {
      map.off("click", CIRCLE_LAYER, onClick);
      map.off("mouseenter", CIRCLE_LAYER, onEnter);
      map.off("mouseleave", CIRCLE_LAYER, onLeave);
    };
  }, [map, isLoaded, places, onSelect]);

  /* Remove what this component added, and nothing else. */
  useEffect(() => {
    return () => {
      if (!map) return;
      for (const layer of [CIRCLE_LAYER, HALO_LAYER]) {
        if (map.getLayer(layer)) map.removeLayer(layer);
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}

export default function AlumniMap() {
  const presence = useQuery(api.presence.map);
  const [selected, setSelected] = useState<Place | null>(null);
  const [showArcs, setShowArcs] = useState(true);

  const places: Place[] = presence?.places ?? [];
  const campus = presence?.campus;

  /** One arc per place, campus to member. `count` styles the line width. */
  const arcs = useMemo<Array<MapArcDatum & { label: string; count: number }>>(() => {
    if (!campus) return [];
    return places.map((place) => ({
      id: place.key,
      from: [campus.lng, campus.lat] as [number, number],
      to: [place.lng, place.lat] as [number, number],
      label: place.label,
      count: place.count,
    }));
  }, [places, campus]);

  if (presence === undefined) {
    return (
      <div className="h-[32rem] w-full animate-pulse rounded-card border border-line bg-surface-sunk" />
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

      {/*
        THE MAP GETS THE WHOLE WIDTH, and most of the window height.
        It was sharing a row with the place list at 34rem tall, which left the
        globe about a third of the screen — small enough that two members in
        neighbouring cities were one dot and the arcs had no room to curve. A
        map of the world wants the room; the list reads perfectly well beneath
        it, and it is a table of numbers rather than something to look at side
        by side with the thing it describes.
      */}
      <div className="relative h-[76vh] min-h-[30rem] overflow-hidden rounded-card border border-line-strong bg-ink shadow-lift">
        <MapCanvas
          className="size-full"
          theme="dark"
          projection={{ type: "globe" }}
          zoom={1.1}
          center={[campus?.lng ?? 77.5533, campus?.lat ?? 9.4533]}
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
              curvature={0.28}
              paint={{
                "line-color": BRASS,
                "line-opacity": 0.55,
                "line-dasharray": [2, 2],
                // Every field on the datum but from/to is available to an
                // expression, so the busiest routes read as the thickest.
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["get", "count"],
                  1,
                  0.7,
                  25,
                  2.2,
                  200,
                  3.6,
                ],
              }}
              hoverPaint={{ "line-color": BRASS_PALE, "line-opacity": 1 }}
              onClick={(event) => {
                const place = places.find((row) => row.key === event.arc.id);
                if (place) setSelected(place);
              }}
            />
          ) : null}

          <PlacesLayer places={places} onSelect={setSelected} />

          {/* The one DOM marker on the map, for the one place that is not a
              member: the campus every arc runs back to. A layer would be the
              wrong tool for a single labelled point. */}
          {campus ? (
            <MapMarker longitude={campus.lng} latitude={campus.lat}>
              <MarkerContent>
                <span className="block size-3 rounded-full border-2 border-bone bg-maroon shadow-lift" />
                <MarkerLabel
                  position="top"
                  className="font-mono rounded-sm bg-bone/90 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-ink backdrop-blur"
                >
                  Rajapalayam
                </MarkerLabel>
              </MarkerContent>
            </MapMarker>
          ) : null}

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
