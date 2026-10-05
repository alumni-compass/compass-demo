"use client";

import { Authenticated } from "@/lib/standalone";

import type { ReactNode } from "react";

/**
 * Renders its children only for a visitor with a session.
 *
 * A one-line wrapper because the root layout is a server component and
 * `Authenticated` comes from `convex/react`, which is client-only. Importing it
 * there directly would pull a client-only module into a server module; this
 * carries the boundary instead.
 */
export default function SessionOnly({ children }: { children: ReactNode }) {
  return <Authenticated>{children}</Authenticated>;
}
