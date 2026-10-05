"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

/**
 * Refreshes the member's location once per sign-in, if they asked for that.
 *
 * WHAT MAKES THIS RUN. Three conditions, all of them required:
 *   1. `locationConsent` is true on the member's own profile row. That is set
 *      only by ticking the box on the details form, and clearing it also clears
 *      any place that was detected rather than typed.
 *   2. The browser's geolocation permission is ALREADY granted. This is the
 *      important one: the code asks `navigator.permissions` first and gives up
 *      if the answer is "prompt". A background component must never be the
 *      reason a permission dialog appears — the member did not click anything,
 *      and a dialog with no visible cause is how people learn to click Block.
 *      The visible "Use my current location" button on the details form is
 *      where the prompt belongs.
 *   3. It has not already run in this browser session. A `sessionStorage` flag,
 *      so it happens once after each sign-in rather than on every navigation —
 *      "the location changes according to where you signed in from" is a
 *      per-session fact, not a per-page-view one.
 *
 * WHAT IS STORED. Only the place name, and only by
 * `profiles.applyDetectedLocation`, which re-checks the consent server-side and
 * refuses to overwrite a location the member typed by hand. The coordinates go
 * to the reverse geocoder inside a Convex action and are discarded there, so no
 * history of where anyone has been accumulates anywhere.
 *
 * FAILURE IS SILENT, on purpose. This is not something the member asked for
 * right now, so a geocoder that is down, a refused permission or a laptop with
 * no location hardware should cost them nothing — not a toast, not a spinner,
 * not a blocked page. The place they already have simply stays.
 */
const SESSION_FLAG = "ritaa.location.refreshed";

export default function LocationSentinel() {
  const profile = useQuery(api.profiles.byEmail);
  const resolveLocation = useAction(api.lookups.resolveLocation);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (profile === undefined || profile === null) return;
    if (profile.locationConsent !== true) return;

    // A member who typed their location keeps it; see applyDetectedLocation.
    if (profile.locationSource === "manual") return;

    if (typeof window === "undefined" || !navigator.geolocation) return;

    let cancelled = false;

    try {
      if (window.sessionStorage.getItem(SESSION_FLAG)) return;
    } catch {
      // Private mode can throw on access. Fall through and refresh this once.
    }

    ran.current = true;

    async function refresh() {
      // Never trigger the permission dialog from here — see the note above.
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: "geolocation" as PermissionName,
          });
          if (status.state !== "granted") return;
        } catch {
          // Browsers without the Permissions API for geolocation (older
          // Safari) land here. Do nothing rather than risk a surprise prompt.
          return;
        }
      } else {
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          void resolveLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
            .then(() => {
              try {
                window.sessionStorage.setItem(SESSION_FLAG, String(Date.now()));
              } catch {
                /* nothing to do — it just refreshes again next navigation */
              }
            })
            .catch(() => {
              /* silent by design */
            });
        },
        () => {
          /* silent by design */
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      );
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [profile, resolveLocation]);

  return null;
}
