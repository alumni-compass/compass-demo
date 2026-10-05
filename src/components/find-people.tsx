"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import ConnectAction, { type EdgeState } from "@/components/connect-action";
import {
  Avatar,
  DegreeMark,
  Empty,
  Eyebrow,
  MutualNote,
  Pill,
  VerifiedMark,
} from "@/components/kit";
import { batchYearFromLabel, DEPARTMENT_NAMES } from "@/lib/site";

/**
 * Find people — search, mutuals and the connect action in one place.
 *
 * WHY THIS EXISTS WHEN /directory ALREADY SEARCHES. It searched in one place
 * and the requests were answered in another, so finding somebody and actually
 * reaching them were two pages apart. This puts the search inside the network
 * page, beside the requests waiting on you: search a name, narrow by batch or
 * department, see who you both already know, and send the request without
 * leaving the tab.
 *
 * NOTHING NEW ON THE SERVER. `directorySearch.search` already takes the text
 * and the three filters, `network.edgeStates` already answers with the edge and
 * the mutual names for a whole page of results at once, and `ConnectAction`
 * already owns every state a request can be in. Adding a fifth query would have
 * been a fourth way to ask the same question.
 *
 * ONE SUBSCRIPTION FOR THE WHOLE GRID, not one per card. `edgeStates` takes the
 * ids of the rows on screen and reads the caller's graph once — a card that
 * fetched its own edge would open thirty subscriptions and walk the graph
 * thirty times for one screen.
 *
 * THE FILTER LISTS COME FROM THE ADMIN. Batch and department read
 * `profileFields.list`, the same lists the details form offers and
 * `upsertProfile` validates against, so the filter can never offer a department
 * nobody can be in. Where a list has not been configured the counts derived
 * from the directory itself are the fallback, which also keeps the numbers
 * beside each option honest.
 */

type Row = {
  _id: Id<"alumni">;
  name: string;
  batch: number;
  department: string;
  designation: string;
  company: string | null;
  region: string | null;
  avatarUrl: string | null;
  verified: boolean;
  openToMentor: boolean;
};

const SELECT =
  "font-mono min-h-10 rounded-control border border-line bg-surface px-3 text-[0.75rem] uppercase tracking-[0.08em] text-ink transition-colors hover:border-line-strong focus:border-maroon focus:outline-none";

function ResultCard({
  row,
  state,
  connectionId,
  mutuals,
  mutualsComplete,
}: {
  row: Row;
  state: EdgeState | undefined;
  connectionId?: Id<"connections">;
  mutuals: string[];
  mutualsComplete: boolean;
}) {
  const work = [row.designation, row.company].filter(Boolean).join(" at ");

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong sm:flex-row sm:items-start">
      <Avatar name={row.name} src={row.avatarUrl} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/directory/${row._id}`}
            className="font-display text-[1rem] leading-tight text-ink transition-colors hover:text-maroon"
          >
            {row.name}
          </Link>
          {row.verified ? <VerifiedMark /> : null}
          {state === "connected" ? <DegreeMark degree={1} /> : null}
          {state !== "connected" && mutuals.length > 0 ? (
            <DegreeMark degree={2} />
          ) : null}
          {row.openToMentor ? <Pill tone="jade">Mentors</Pill> : null}
        </div>

        <p className="font-mono mt-1 text-[0.7rem] uppercase tracking-[0.1em] text-slate-ink">
          Batch of {row.batch} · {row.department}
          {row.region ? ` · ${row.region}` : ""}
        </p>
        {work ? (
          <p className="mt-0.5 truncate text-[0.85rem] text-slate-ink">{work}</p>
        ) : null}

        {state !== "connected" ? (
          <div className="mt-2">
            <MutualNote names={mutuals} complete={mutualsComplete} />
          </div>
        ) : null}
      </div>

      <div className="shrink-0 sm:pt-1">
        <ConnectAction
          alumniId={row._id}
          name={row.name}
          state={state}
          connectionId={connectionId}
        />
      </div>
    </div>
  );
}

export default function FindPeople() {
  const reduce = useReducedMotion();

  const [text, setText] = useState("");
  const [batch, setBatch] = useState("");
  const [department, setDepartment] = useState("");
  const [region, setRegion] = useState("");

  /* The admin's own option lists, with the directory's counts as the fallback. */
  const config = useQuery(api.profileFields.list);
  const batchCounts = useQuery(api.directory.batchCounts);
  const departmentCounts = useQuery(api.directory.departmentCounts);

  /*
   * The admin's batch options are labels covering four years ("2020-2024") and
   * the directory indexes the graduating year, so the option VALUE carries the
   * year and the option TEXT carries the label. The counts beside each are
   * matched on the year, which is what the directory actually groups by.
   */
  const batchOptions = useMemo(() => {
    const counts = new Map(
      (batchCounts ?? []).map((row) => [row.batch, row.count]),
    );
    const configured = config?.fields.find((field) => field.key === "batch");
    if (configured && configured.options.length > 0) {
      return configured.options.flatMap((option) => {
        const year = batchYearFromLabel(option);
        if (year === null) return [];
        const count = counts.get(year);
        return [
          {
            value: String(year),
            label: count ? `${option} (${count})` : option,
          },
        ];
      });
    }
    return (batchCounts ?? []).map((row) => ({
      value: String(row.batch),
      label: `${row.batch} (${row.count})`,
    }));
  }, [config, batchCounts]);

  const departmentOptions = useMemo(() => {
    const configured = config?.fields.find((field) => field.key === "department");
    const counts = new Map(
      (departmentCounts ?? []).map((row) => [row.department, row.count]),
    );
    const codes =
      configured && configured.options.length > 0
        ? configured.options
        : (departmentCounts ?? []).map((row) => row.department);
    return codes.map((code) => ({
      value: code,
      label: `${DEPARTMENT_NAMES[code] ?? code}${
        counts.has(code) ? ` (${counts.get(code)})` : ""
      }`,
    }));
  }, [config, departmentCounts]);

  const asking = text.trim() !== "" || batch !== "" || department !== "" || region !== "";

  const results = useQuery(api.directorySearch.search, {
    text: text.trim() || undefined,
    batch: batch ? Number(batch) : undefined,
    department: department || undefined,
    region: region || undefined,
    limit: 40,
  }) as Row[] | undefined;

  const rows = results ?? [];

  /* One read of the caller's graph for every row on screen. */
  const edges = useQuery(
    api.network.edgeStates,
    rows.length > 0 ? { alumniIds: rows.map((row) => row._id) } : "skip",
  );

  const regions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) if (row.region) seen.add(row.region);
    return [...seen].sort();
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <Eyebrow>Search the membership</Eyebrow>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 16 16"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 stroke-slate-soft"
              fill="none"
              strokeWidth="1.4"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Search by name"
              aria-label="Search members by name"
              className="min-h-10 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-[0.9rem] text-ink placeholder:text-slate-soft transition-colors hover:border-line-strong focus:border-maroon focus:outline-none"
            />
          </div>

          <select
            value={batch}
            onChange={(event) => setBatch(event.target.value)}
            aria-label="Filter by batch"
            className={SELECT}
          >
            <option value="">Any batch</option>
            {batchOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            aria-label="Filter by department"
            className={SELECT}
          >
            <option value="">Any department</option>
            {departmentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {regions.length > 1 ? (
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              aria-label="Filter by region"
              className={SELECT}
            >
              <option value="">Anywhere</option>
              {regions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-slate-ink">
            {results === undefined
              ? "Searching"
              : `${rows.length} ${rows.length === 1 ? "member" : "members"}${
                  rows.length === 40 ? " (first 40)" : ""
                }`}
          </p>
          {asking ? (
            <button
              type="button"
              onClick={() => {
                setText("");
                setBatch("");
                setDepartment("");
                setRegion("");
              }}
              className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-maroon transition-colors hover:text-maroon-deep"
            >
              Clear filters
            </button>
          ) : null}
          <p className="ml-auto text-[0.75rem] text-slate-ink">
            Search by name, or narrow to a batch and department and browse.
          </p>
        </div>
      </div>

      {results === undefined ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-24 animate-pulse rounded-card border border-line bg-surface-sunk"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty
          title={asking ? "Nobody matches that yet" : "The directory is empty"}
          hint={
            asking
              ? "Try a shorter name, or drop one of the filters. Members appear here once they have filled in their details, so a graduate who has not joined yet will not be found."
              : "No member has filled in a directory profile yet. As they do, they become searchable here."
          }
        />
      ) : (
        <motion.div
          className="space-y-3"
          initial="rest"
          animate="in"
          variants={{ in: { transition: { staggerChildren: reduce ? 0 : 0.03 } } }}
        >
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.div
                key={String(row._id)}
                layout={!reduce}
                variants={{
                  rest: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
                  in: { opacity: 1, y: 0 },
                }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{
                  duration: reduce ? 0.01 : 0.26,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <ResultCard
                  row={row}
                  state={edges?.states[row._id] as EdgeState | undefined}
                  connectionId={edges?.connectionIds[row._id]}
                  mutuals={edges?.mutualNames[row._id] ?? []}
                  mutualsComplete={edges?.mutualsComplete ?? true}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
