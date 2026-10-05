"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import { BATCH_YEARS } from "@/lib/site";

/**
 * The batch rail — RITAA's signature navigation device.
 *
 * In Indian engineering colleges the first question any alumnus asks another is
 * "which batch?", so the cohort year is the most natural way into the directory.
 * The rail runs from the association's founding year to the current cohort, sized
 * by how many members each year has, and every notch is a link into a filtered
 * directory. The ordering carries real information (time), which is why the years
 * are rendered as a spine rather than as decorative numbering.
 */
export default function BatchRail({ onDark = false }: { onDark?: boolean }) {
  const counts = useQuery(api.directory.batchCounts);

  const byBatch = new Map<number, number>();
  for (const row of counts ?? []) byBatch.set(row.batch, row.count);
  const max = Math.max(1, ...[...byBatch.values()]);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span
          className={`font-mono text-[0.7rem] uppercase tracking-[0.18em] ${
            onDark ? "text-brass-soft" : "text-brass"
          }`}
        >
          Find your batch
        </span>
        <span
          className={`font-mono text-[0.7rem] tabular-nums ${
            onDark ? "text-bone/50" : "text-slate-ink"
          }`}
        >
          {BATCH_YEARS[0]}—{BATCH_YEARS[BATCH_YEARS.length - 1]}
        </span>
      </div>

      {/* Horizontal scroll on small screens; the rail never squeezes years
          together to the point where the counts stop being readable. */}
      <div className="mt-4 -mx-1 overflow-x-auto pb-2">
        <ul className="flex min-w-max items-end gap-1 px-1">
          {BATCH_YEARS.map((year) => {
            const count = byBatch.get(year) ?? 0;
            // Bars are proportional but always tall enough to be clickable.
            const height = count === 0 ? 6 : 6 + Math.round((count / max) * 34);
            return (
              <li key={year}>
                <Link
                  href={`/directory?batch=${year}`}
                  className="group flex w-14 flex-col items-center gap-2"
                  aria-label={`${count} members from the ${year} batch`}
                >
                  <span
                    className={`font-mono text-[0.7rem] tabular-nums transition-colors ${
                      count === 0
                        ? onDark
                          ? "text-bone/25"
                          : "text-slate-ink/40"
                        : onDark
                          ? "text-bone/70 group-hover:text-brass-soft"
                          : "text-ink group-hover:text-maroon"
                    }`}
                  >
                    {count || "—"}
                  </span>
                  <span
                    style={{ height }}
                    className={`w-full transition-colors ${
                      count === 0
                        ? onDark
                          ? "bg-white/10"
                          : "bg-bone-deep"
                        : onDark
                          ? "bg-brass/60 group-hover:bg-brass-soft"
                          : "bg-maroon/70 group-hover:bg-maroon"
                    }`}
                  />
                  <span
                    className={`font-mono text-[0.7rem] tabular-nums transition-colors ${
                      onDark
                        ? "text-bone/55 group-hover:text-bone"
                        : "text-slate-ink group-hover:text-ink"
                    }`}
                  >
                    {`'${String(year).slice(2)}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The spine itself, drawn in CSS. */}
      <div
        className={`batch-rail-spine h-px w-full ${onDark ? "opacity-25" : "opacity-100"}`}
        aria-hidden
      />
    </div>
  );
}
