"use client";

import { api } from "@convex/_generated/api";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";

import AlumniMap from "@/components/alumni-map";
import { Button, Card, Empty, Eyebrow, PageHeader, Pill, Shell } from "@/components/kit";

/**
 * `/map` — the association, drawn from where members say they are.
 *
 * The counts and the drawing come from one reactive query, so the page cannot
 * show a headline number the map disagrees with. See `presence.map` for why all
 * four totals are reported rather than only the plottable one.
 */
function HeaderCounts() {
  const presence = useQuery(api.presence.map);
  if (presence === undefined || !presence.authorized) return null;

  const { totals } = presence;
  return (
    <div className="flex flex-wrap gap-2">
      <Pill tone="dark">{totals.placed} on the map</Pill>
      <Pill tone="dark">{totals.placesShown} places</Pill>
      <Pill tone="dark">
        {totals.countries} countr{totals.countries === 1 ? "y" : "ies"}
      </Pill>
    </div>
  );
}

export default function MapPage() {
  return (
    <>
      <PageHeader
        image="/campus-5.jpg"
        module="Module 03 · The alumni directory"
        title="Where RITAA is."
        lede="Every dot is a place members have told the portal they are, and every arc runs back to Rajapalayam. It updates itself: a member who allows the per-sign-in location refresh moves on this map the next time they sign in, wherever that is."
      >
        <Authenticated>
          <HeaderCounts />
        </Authenticated>
      </PageHeader>

      <Shell className="py-14 sm:py-20">
        <Unauthenticated>
          <Empty
            title="Sign in to see the map"
            hint="It shows where members have said they are, so it sits behind a session — the same rule the rest of the directory follows."
            action={<Button href="/join">Sign in to RITAA</Button>}
          />
        </Unauthenticated>

        <Authenticated>
          <AlumniMap />

          <Card className="mt-8 hover:border-line">
            <Eyebrow>Where these locations come from</Eyebrow>
            <ul className="mt-3 space-y-3 text-[0.875rem] leading-relaxed text-slate-ink">
              <li>
                <strong className="text-ink">The member typed it, or allowed it.</strong>{" "}
                Nothing is inferred from an address book or an IP address. A place
                is here because a member wrote it on their{" "}
                <Link
                  href="/welcome"
                  className="text-maroon underline decoration-brass/50 underline-offset-4"
                >
                  details form
                </Link>{" "}
                or ticked the box that refreshes it at each sign-in.
              </li>
              <li>
                <strong className="text-ink">A town, not an address.</strong> Each
                dot sits on the centre of the named place, so everyone in one
                town shares a single point. No device-precision position is
                stored anywhere, and no history of where anyone has signed in
                from can be reconstructed from it.
              </li>
              <li>
                <strong className="text-ink">The counts are the whole membership.</strong>{" "}
                Members whose place has not been located yet, and members who
                have shared no location, are counted above the map rather than
                left out of the total.
              </li>
            </ul>
          </Card>
        </Authenticated>
      </Shell>
    </>
  );
}
