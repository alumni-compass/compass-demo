"use client";

import { api, type Id, useQuery, type FunctionReturnType } from "@/lib/standalone";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState, type ReactNode } from "react";

import ConnectAction, { type EdgeState } from "@/components/connect-action";
import {
  Button,
  DegreeMark,
  Empty,
  Eyebrow,
  LoadingRows,
  Monogram,
  MutualNote,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
  VerifiedMark,
} from "@/components/kit";
// RITAA is no longer imported here: its only use was the introduction email that
// `connectMailto` composed, and connecting is a real edge in the graph now.
import {
  BATCH_YEARS,
  DEPARTMENT_NAMES,
  DEPARTMENTS,
  REGIONS,
} from "@/lib/site";

/**
 * Module 3 — the Alumni Directory.
 *
 * The brief asks for three things: smart search with filters on batch,
 * department, company and region; connection features (view profile, request
 * connect, messaging optional); and a featured alumni highlight reel. All three
 * are on this page, with search as the page rather than a widget on it.
 *
 * Every filter is resolved by `directorySearch.search`, including company —
 * filtering in the browser after a capped fetch would silently miss anyone past
 * the cap, which is the one failure a directory must not have. The active
 * narrowing stays visible as chips the member can drop one at a time.
 */

/** How many rows we ask Convex for. Also the "showing the first N" ceiling. */
const RESULT_LIMIT = 120;
/** Skills shown per card before collapsing into a "+N" pill. */
const SKILL_CAP = 4;
/** Cards in the highlight reel. Four fits one desktop row without wrapping. */
const FEATURED_LIMIT = 4;

/** The association's standard line for a field the member kept private. */
const NOT_SHARED = "Not shared";

/**
 * One directory row, taken from the query itself so the card cannot drift from
 * what the backend publishes. Every redactable field is `string | null` here.
 */
type Member = FunctionReturnType<typeof api.directorySearch.search>[number];

const CONTROL =
  "w-full border border-line bg-white px-3 py-2.5 text-sm text-ink transition-colors hover:border-brass/60";
const SELECT = `${CONTROL} font-mono text-[0.8rem] uppercase tracking-[0.08em]`;
const LINK =
  "text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep";

/** Batch years read as cohorts, not integers: 2021 becomes '21. */
function shortBatch(batch: number) {
  return `’${String(batch).slice(2)}`;
}

/*
 * A `connectMailto` helper used to live here, composing an introduction email
 * because the portal had no way to carry a message. It also meant "Request
 * connect" was disabled for any member who had kept their address private — so
 * the members most careful with their contact details were the least reachable,
 * which is exactly backwards.
 *
 * Connecting is a real edge in the graph now. `network.requestConnection` takes
 * the member's directory id and resolves the address on the server, so a private
 * address is no obstacle and no address reaches the browser at all. The control
 * itself is components/connect-action.tsx.
 */

/** Labelled control wrapper — every filter has a real, visible label. */
function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
      >
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** One mono label/value row on a member card. */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="min-w-0 break-words text-right text-ink">{children}</dd>
    </div>
  );
}

/**
 * A redactable field. Every one of these arrives null when the member marked it
 * private, so the absence is stated rather than left as a gap in the card.
 */
function Shared({ value }: { value: string | null }) {
  if (value === null) return <span className="text-slate-ink">{NOT_SHARED}</span>;
  return <>{value}</>;
}

export default function DirectoryPage() {
  const stats = useQuery(api.directory.stats);

  return (
    <>
      <PageHeader
      image="/campus-1.jpg"
        module="Module 03 · Alumni Directory"
        title="Somebody from RIT has already done what you are about to try."
        lede="Search every verified member by name, then narrow by batch, department, company or region — the filters combine. Ask for an introduction instead of sending a cold message."
      >
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={stats?.alumni ?? "—"} label="Verified members" onDark />
          <Stat value={stats?.batches ?? "—"} label="Batches represented" onDark />
          <Stat
            value={stats?.companies ?? "—"}
            label="Companies & institutions"
            onDark
          />
          <Stat value={stats?.mentors ?? "—"} label="Open to mentoring" onDark />
        </div>
      </PageHeader>

      <FeaturedReel />

      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Smart search"
            title="Every filter combines"
            lede="Pick a cohort from the batch rail on the homepage and it arrives here already applied. The company list is built from where members actually work, so every option in it returns somebody."
          />
          {/* useSearchParams needs a Suspense boundary above it. */}
          <Suspense fallback={<LoadingRows rows={4} />}>
            <DirectoryFromUrl total={stats?.alumni} />
          </Suspense>

          {/* The other register. Linked from here because this is the page
              somebody is on when the directory does not have who they want. */}
          <div className="mt-12 rounded-card border border-line bg-surface p-6 shadow-card">
            <Eyebrow>Not in the directory?</Eyebrow>
            <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
              The directory lists members who have written a profile. The student
              database is the college&rsquo;s own record of everyone who studied
              here — searchable by name, roll number or college address, whether or
              not they have ever signed in.
            </p>
            <div className="mt-4">
              <Button href="/students" variant="outline" size="sm">
                Search the student database
              </Button>
            </div>
          </div>
        </section>
      </Shell>
    </>
  );
}

/**
 * The brief's highlight reel. It belongs here and not only on the homepage: a
 * member who lands on the directory from the batch rail never sees the homepage
 * band, and these are the people the association wants found first.
 */
function FeaturedReel() {
  const featured = useQuery(api.directory.featured, { limit: FEATURED_LIMIT });

  // Nothing curated yet is not an error state — the strip simply stands down.
  if (featured !== undefined && featured.length === 0) return null;

  return (
    <section className="border-b border-line bg-white">
      <Shell className="py-12 sm:py-14">
        <SectionHead
          eyebrow="Highlight reel"
          title="Featured alumni"
          lede="Put forward by the association for what they have built, and for the time they give back."
          action={
            <Button href="/mentorship" variant="outline">
              Alumni mentoring
            </Button>
          }
        />
        {featured === undefined ? (
          <LoadingRows rows={2} />
        ) : (
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((person) => (
              <li key={person._id} className="bg-white p-5">
                <div className="flex items-start gap-3">
                  <Monogram name={person.name} size="sm" tone="brass" />
                  <div className="min-w-0">
                    <h3 className="font-display text-[0.975rem] leading-snug text-ink">
                      <Link
                        href={`/directory/${person._id}`}
                        className="hover:text-maroon"
                      >
                        {person.name}
                      </Link>
                    </h3>
                    <p className="font-mono mt-1 text-[0.68rem] uppercase tracking-[0.1em] tabular-nums text-brass">
                      {person.department} · {shortBatch(person.batch)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[0.85rem] leading-snug text-ink">
                  {person.designation}
                </p>
                <p className="text-[0.85rem] text-slate-ink">
                  <Shared value={person.company} />
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {person.verified ? <VerifiedMark /> : null}
                  {person.openToMentor ? <Pill tone="jade">Mentors</Pill> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Shell>
    </section>
  );
}

/**
 * Reads the initial cohort out of `?batch=YYYY` — the batch rail's link target —
 * and keys the browser on it so navigating from a different year starts clean
 * instead of stranding the previous selection in state.
 */
function DirectoryFromUrl({ total }: { total: number | undefined }) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("batch");
  const parsed = raw === null ? Number.NaN : Number(raw);
  const initialBatch = BATCH_YEARS.includes(parsed) ? parsed : null;

  return (
    <DirectoryBrowser
      key={initialBatch ?? "all"}
      initialBatch={initialBatch}
      total={total}
    />
  );
}

type FilterChip = {
  key: "text" | "batch" | "department" | "region" | "company";
  label: string;
  clear: () => void;
};

function DirectoryBrowser({
  initialBatch,
  total,
}: {
  initialBatch: number | null;
  total: number | undefined;
}) {
  const [text, setText] = useState("");
  const [batch, setBatch] = useState<number | null>(initialBatch);
  const [department, setDepartment] = useState("");
  const [region, setRegion] = useState("");
  const [company, setCompany] = useState("");

  // Keeps typing responsive and stops a new subscription firing on every
  // keystroke; React drops the intermediate values it never rendered.
  const deferredText = useDeferredValue(text);
  const stale = deferredText !== text;

  const query = deferredText.trim();
  // One query, all four filters. The company filter is the reason this is
  // `directorySearch` and not `directory.search`: narrowing has to happen
  // before the row limit, or matches past the limit disappear without a trace.
  const results = useQuery(api.directorySearch.search, {
    text: query.length > 0 ? query : undefined,
    batch: batch ?? undefined,
    department: department || undefined,
    region: region || undefined,
    company: company || undefined,
    limit: RESULT_LIMIT,
  });
  const batchCounts = useQuery(api.directory.batchCounts);
  const departmentCounts = useQuery(api.directory.departmentCounts);
  const companyCounts = useQuery(api.directorySearch.companyCounts);

  const batchSizes = new Map((batchCounts ?? []).map((r) => [r.batch, r.count]));
  const departmentSizes = new Map(
    (departmentCounts ?? []).map((r) => [r.department, r.count]),
  );

  // Ordering is the server's: relevance for a name query, newest cohort first
  // otherwise. Nothing is re-filtered or re-sorted here.
  const rows = results ?? [];

  /*
   * The caller's relationship to every row on screen, in ONE subscription rather
   * than one per card. `network.edgeStates` reads the caller's whole graph once
   * and answers from memory, so this costs the same whether the page is showing
   * one member or a hundred — a per-card query would be a hundred subscriptions
   * and a hundred re-renders every time any edge anywhere changed.
   *
   * Keyed by directory id in both directions, so no address is involved.
   * Returns the empty shape when signed out instead of throwing, which is what
   * keeps the directory readable without an account.
   */
  const edges = useQuery(api.network.edgeStates, {
    alumniIds: rows.map((person) => person._id),
  });

  const active: FilterChip[] = [];
  if (text.trim().length > 0) {
    active.push({
      key: "text",
      label: `Name: ${text.trim()}`,
      clear: () => setText(""),
    });
  }
  if (batch !== null) {
    active.push({
      key: "batch",
      label: `Batch ${shortBatch(batch)}`,
      clear: () => setBatch(null),
    });
  }
  if (department) {
    active.push({
      key: "department",
      label: department,
      clear: () => setDepartment(""),
    });
  }
  if (company) {
    active.push({
      key: "company",
      label: company,
      clear: () => setCompany(""),
    });
  }
  if (region) {
    active.push({ key: "region", label: region, clear: () => setRegion("") });
  }

  function clearAll() {
    setText("");
    setBatch(null);
    setDepartment("");
    setRegion("");
    setCompany("");
  }

  // Which filter to suggest dropping first: the narrowest one.
  const relaxOrder: FilterChip["key"][] = [
    "company",
    "text",
    "region",
    "batch",
    "department",
  ];
  const relax = relaxOrder
    .map((key) => active.find((f) => f.key === key))
    .find(Boolean);

  return (
    <>
      {/* ---- Filter controls: stack on mobile, one row on desktop -------- */}
      <div className="border border-line bg-bone-deep p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-8">
          <Field id="dir-text" label="Search by name" className="lg:col-span-2">
            <input
              id="dir-text"
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="e.g. Arunprasanth"
              autoComplete="off"
              className={CONTROL}
            />
          </Field>

          <Field id="dir-batch" label="Batch">
            <select
              id="dir-batch"
              value={batch === null ? "" : String(batch)}
              onChange={(event) =>
                setBatch(event.target.value === "" ? null : Number(event.target.value))
              }
              className={SELECT}
            >
              <option value="">All batches</option>
              {[...BATCH_YEARS].reverse().map((year) => {
                const count = batchSizes.get(year);
                return (
                  <option
                    key={year}
                    value={year}
                    disabled={batchCounts !== undefined && count === undefined}
                  >
                    {count === undefined ? year : `${year} (${count})`}
                  </option>
                );
              })}
            </select>
          </Field>

          <Field
            id="dir-department"
            label="Department"
            className="lg:col-span-2"
          >
            <select
              id="dir-department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className={SELECT}
            >
              <option value="">All departments</option>
              {DEPARTMENTS.map((dept) => {
                const count = departmentSizes.get(dept);
                const name = DEPARTMENT_NAMES[dept] ?? dept;
                return (
                  <option key={dept} value={dept}>
                    {count === undefined
                      ? `${dept} — ${name}`
                      : `${dept} — ${name} (${count})`}
                  </option>
                );
              })}
            </select>
          </Field>

          {/* Employers come from the table itself, so the filter can only be
              set to a company somebody in the directory actually works at. */}
          <Field id="dir-company" label="Company" className="lg:col-span-2">
            <select
              id="dir-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              className={SELECT}
            >
              <option value="">
                {companyCounts === undefined
                  ? "Loading employers…"
                  : "All companies"}
              </option>
              {(companyCounts ?? []).map((row) => (
                <option key={row.company} value={row.company}>
                  {`${row.company} (${row.count})`}
                </option>
              ))}
            </select>
          </Field>

          <Field id="dir-region" label="Region">
            <select
              id="dir-region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className={SELECT}
            >
              <option value="">All regions</option>
              {REGIONS.map((place) => (
                <option key={place} value={place}>
                  {place}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* ---- Active filters as removable chips ------------------------- */}
        {active.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <Eyebrow>Filtering by</Eyebrow>
            {active.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                aria-label={`Remove filter ${chip.label}`}
                className="group"
              >
                <Pill tone="maroon">
                  <span className="tabular-nums">{chip.label}</span>
                  <span aria-hidden className="text-maroon/60 group-hover:text-maroon">
                    ✕
                  </span>
                </Pill>
              </button>
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="font-mono ml-1 text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon"
            >
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      {/* ---- Result count ------------------------------------------------ */}
      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
        <p
          aria-live="polite"
          className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-slate-ink"
        >
          {results === undefined ? (
            "Searching…"
          ) : (
            <>
              <span className="tabular-nums text-ink">{rows.length}</span>{" "}
              {rows.length === 1 ? "member" : "members"}
              {active.length > 0 ? " matched" : ""}
              {total !== undefined ? (
                <>
                  {" · "}
                  <span className="tabular-nums">{total}</span> in the directory
                </>
              ) : null}
            </>
          )}
        </p>
        {rows.length >= RESULT_LIMIT ? (
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-brass">
            First <span className="tabular-nums">{RESULT_LIMIT}</span> matches —
            narrow further
          </p>
        ) : null}
      </div>

      {/* ---- Results ----------------------------------------------------- */}
      {results === undefined ? (
        <div className="mt-8">
          <LoadingRows rows={6} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-8">
          <Empty
            title="No member matches all of those filters"
            hint={
              relax
                ? `Drop "${relax.label}" first — it is the narrowest of the ${active.length} filters applied. Neighbouring batches are usually the fastest way to find someone in the same team.`
                : "The directory is still being populated. Members appear here once the association verifies them."
            }
            action={
              active.length > 0 ? (
                <Button onClick={clearAll}>Clear all filters</Button>
              ) : (
                <Button href="/join">Create your profile</Button>
              )
            }
          />
        </div>
      ) : (
        <ul
          className={`mt-8 grid gap-px bg-line lg:grid-cols-2 ${
            stale ? "opacity-60 transition-opacity" : "transition-opacity"
          }`}
        >
          {rows.map((person) => (
            <MemberCard
              key={person._id}
              person={person}
              state={edges?.states[person._id]}
              connectionId={edges?.connectionIds[person._id]}
              mutuals={edges?.mutualNames[person._id]}
              mutualsComplete={edges?.mutualsComplete ?? true}
            />
          ))}
        </ul>
      )}

      {/* ---- What the connection controls actually do -------------------- */}
      <div className="mt-10 max-w-2xl border-t border-line pt-6">
        <Eyebrow>Connecting</Eyebrow>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          <span className="text-ink">View profile</span> opens the full member
          record. <span className="text-ink">Connect</span> sends a real request
          inside the portal — it works whether or not the member publishes an email
          address, because the request is delivered to their account rather than to
          their inbox.
        </p>
        <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
          Nothing is shared until they accept. Once they do, the button becomes{" "}
          <span className="text-ink">Message</span> and a direct thread opens in{" "}
          <Link href="/messages" className={LINK}>
            Messages
          </Link>
          . Where a member you are connected to also knows this one, their name
          appears on the card — that is who to ask for the introduction.
        </p>
        <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
          Members choose which fields stay public. &ldquo;{NOT_SHARED}&rdquo;
          means the alumnus kept that field private — not that the record is
          incomplete. A private field is never filterable either, so no filter can
          reveal a value a member withheld.
        </p>
      </div>
    </>
  );
}

/**
 * One result row: the member, the fields they chose to publish, whether you are
 * connected, and who you both already know.
 *
 * The relationship arrives as props rather than as this card's own query — the
 * list holds one `network.edgeStates` subscription for every row, so a grid of a
 * hundred members is one subscription and not a hundred.
 */
function MemberCard({
  person,
  state,
  connectionId,
  mutuals,
  mutualsComplete,
}: {
  person: Member;
  state: EdgeState | undefined;
  connectionId: Id<"connections"> | undefined;
  mutuals: string[] | undefined;
  mutualsComplete: boolean;
}) {
  return (
    <li className="bg-surface p-6 transition-colors hover:bg-bone/60">
      <div className="flex items-start gap-4">
        <Monogram name={person.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-display text-lg leading-snug text-ink">
              <Link
                href={`/directory/${person._id}`}
                className="hover:text-maroon"
              >
                {person.name}
              </Link>
            </h3>
            {person.verified ? <VerifiedMark /> : null}
            {state === "connected" ? <DegreeMark degree={1} /> : null}
            {state !== "connected" && mutuals && mutuals.length > 0 ? (
              <DegreeMark degree={2} />
            ) : null}
            {person.openToMentor ? <Pill tone="jade">Mentors</Pill> : null}
          </div>
          <p className="font-mono mt-1.5 text-[0.7rem] uppercase tracking-[0.1em] tabular-nums text-brass-ink">
            {person.department} · {shortBatch(person.batch)}
          </p>
          <p className="mt-2 text-[0.9rem] leading-snug text-ink">
            {person.designation}
          </p>

          {/* Redactable fields, each one stated even when it is withheld. */}
          <dl className="font-mono mt-3 space-y-1 text-[0.72rem] text-slate-ink">
            <MetaRow label="Company">
              <Shared value={person.company} />
            </MetaRow>
            <MetaRow label="Region">
              <Shared value={person.region} />
            </MetaRow>
            <MetaRow label="LinkedIn">
              {person.linkedinUrl === null ? (
                <Shared value={null} />
              ) : (
                <a
                  href={person.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={LINK}
                >
                  Open ↗<span className="sr-only"> {person.name} on LinkedIn</span>
                </a>
              )}
            </MetaRow>
          </dl>

          {/* THE SIGNATURE: who you both know, named. Only where a mutual exists
              and you are not already connected — a mutual is meaningless for
              someone you already know. */}
          {state !== "connected" && mutuals && mutuals.length > 0 ? (
            <div className="mt-3">
              <MutualNote names={mutuals} complete={mutualsComplete} />
            </div>
          ) : null}
        </div>
      </div>

      {person.skills.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {person.skills.slice(0, SKILL_CAP).map((skill) => (
            <Pill key={skill}>{skill}</Pill>
          ))}
          {person.skills.length > SKILL_CAP ? (
            <Pill tone="brass">
              <span className="tabular-nums">
                +{person.skills.length - SKILL_CAP}
              </span>
            </Pill>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {/* kit's Href alias is Link's non-generic href, which cannot express a
            dynamic segment; the URL-object form can. */}
        <Button
          href={{ pathname: `/directory/${person._id}` }}
          variant="outline"
          size="sm"
        >
          View profile
        </Button>
        <ConnectAction
          alumniId={person._id}
          name={person.name}
          state={state}
          connectionId={connectionId}
        />
      </div>
    </li>
  );
}
