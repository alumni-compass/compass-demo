"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Withholds the site header and footer from routes that are their own screen.
 *
 * `/join` is a full-viewport sign-in panel with its own back link. Rendering the
 * eight-item nav bar above it would be offering eight ways to not sign in, and
 * the footer below it would be a second page of links underneath a fixed overlay
 * that already covers them.
 *
 * A client component rather than a route group, because the alternative is
 * moving all twenty-four other routes into a `(portal)` group so that one of
 * them can have a different layout. The chrome is passed in as children, so it
 * still renders on the server for every other route — this only decides whether
 * it is mounted.
 */
const BARE_ROUTES: ReadonlyArray<string> = ["/join"];

export default function ChromeSlot({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (BARE_ROUTES.includes(pathname)) return null;
  return <>{children}</>;
}
