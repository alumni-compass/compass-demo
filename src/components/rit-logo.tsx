"use client";

import { useState } from "react";

/**
 * The official RIT crest.
 *
 * Renders the real asset from the public folder — deliberately no drawn
 * substitute. An institution's crest is either the actual artwork or it is
 * nothing, so if the file is absent this collapses to the RITAA wordmark beside
 * it rather than showing an invented shield or a broken-image icon.
 *
 * Add the official crest at:  public/rit-logo.png
 * (An .svg is preferable if the association has one — change the src below.)
 */
export default function RitLogo({
  className = "size-10",
  title = "Ramco Institute of Technology",
}: {
  className?: string;
  title?: string;
}) {
  const [missing, setMissing] = useState(false);

  if (missing) return null;

  return (
    // Plain <img> rather than next/image: fixed-size mark, and onError is what
    // lets it disappear cleanly when the asset has not been added yet.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/rit-logo.png"
      alt={title}
      className={`${className} object-contain`}
      onError={() => setMissing(true)}
    />
  );
}
