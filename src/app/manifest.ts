import type { MetadataRoute } from "next";

import { RITAA } from "@/lib/site";

/**
 * Web app manifest — the "app ready" half of the brief's module 11.
 *
 * `icons` deliberately points at the same crest the header uses. Once the real
 * artwork is in place at public/rit-logo.png this needs no further change; the
 * association can add dedicated 192px and 512px exports later for a sharper
 * install prompt.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${RITAA.shortName} — ${RITAA.name}`,
    short_name: RITAA.shortName,
    description: RITAA.vision,
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#14192b",
    lang: "en-IN",
    icons: [
      {
        src: "/rit-logo.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
