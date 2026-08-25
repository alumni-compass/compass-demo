"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { useDeferredValue, useState } from "react";

import {
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import { DEPARTMENT_NAMES, DEPARTMENTS, RITAA } from "@/lib/site";

/**
 * Search the student roster — by name, roll number, or college address.
 *
 * All three go through one Convex search index over `studentRecords.searchText`,
 * which is why that field exists: three separate lookups could not answer "part of
 * a name plus part of a number" from one box, which is how people actually search.
 *
 * BEING ABLE TO SEARCH BY A VALUE IS NOT PERMISSION TO READ IT. A member's results
 * carry the name, department, degree and cohort and nothing else — no personal
 * address, no phone number, no home address, and not the roll number either, since
 * that is the secret the verification gate checks. An admin sees the full row,
 * chosen by `roster.search` from the caller's resolved role on the server, so there
 * is no client flag that could ask for more.
 *
 * This is a different question from /directory. The directory lists members who
 * have written a profile; this searches the college's own record of who studied
 * here, which is what makes it useful for confirming that somebody is real.
 */

const MIN_TERM = 2;

function RosterSearch() {
  const [term, setTerm] = useState("");
  const [department, setDepartment] = useState<string>("");
  const [year, setYear] = useState<string>("");

  // Deferred so typing stays responsive while the previous result renders.
  const deferred = useDeferredValue(term.trim());
  const stats = useQuery(api.roster.rosterStats);

  const ready = deferred.length >= MIN_TERM;
  const results = useQuery(
    api.roster.search,
    ready
      ? {
          text: deferred,
          department: department || undefined,
          yearOfPassing: year ? Number(year) : undefined,
        }
      : "skip",
  );

  const stale = ready && term.trim() !== deferred;
  const cohorts = stats?.cohorts ?? [];

  return (
    <>
      <div className="grid grid-cols-2 gap-6 rounded-card border border-line bg-surface p-6 shadow-card sm:grid-cols-4">
        <Stat value={stats?.total ?? "—"} label="Students on the roster" />
        <Stat value={stats?.departments.length ?? "—"} label="Departments" />
        <Stat value={cohorts.length || "—"} label="Cohorts imported" />
        <Stat
          value={cohorts[0]?.yearOfPassing ?? "—"}
          label="Latest passing year"
        />
      </div>

      {/* ---- The one search box ---------------------------------------- */}
      <div className="mt-8 rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="grid gap-4 sm:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <label
              htmlFor="roster-term"
              className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
            >
              Name, roll number or college address
            </label>
            <input
              id="roster-term"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Abinaya, or 953622104001, or 953622104001@ritrjpm.ac.in"
              className="mt-2 w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
            />
          </div>

          <div>
            <label
              htmlFor="roster-dept"
              className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
            >
              Department
            </label>
            <select
              id="roster-dept"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className="font-mono mt-2 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[0.8rem] uppercase tracking-[0.08em] text-ink"
            >
              <option value="">Any</option>
              {DEPARTMENTS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="roster-year"
              className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
            >
              Year of passing
            </label>
            <select
              id="roster-year"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              className="font-mono mt-2 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[0.8rem] tabular-nums text-ink"
            >
              <option value="">Any</option>
              {cohorts.map((cohort) => (
                <option key={cohort.yearOfPassing} value={cohort.yearOfPassing}>
                  {cohort.yearOfPassing} ({cohort.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-4 text-[0.8rem] leading-relaxed text-slate-ink">
          Type at least {MIN_TERM} characters. A roll number matches whole or as a
          prefix, so <code className="font-mono">9536221040</code> finds the whole
          CSE serial run.
        </p>
      </div>

      {/* ---- Results --------------------------------------------------- */}
      <div className="mt-8">
        {!ready ? (
          <Empty
            title="Search the roster."
            hint="Start typing a name, a roll number or a college address. Results come from the record the association imported, not from member-written profiles."
          />
        ) : results === undefined ? (
          <LoadingRows rows={5} />
        ) : results.rows.length === 0 ? (
          <Empty
            title="Nobody on the roster matches that."
            hint="Check the spelling, or drop the department and year filters. If a whole cohort is missing, the association has not imported it yet."
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-slate-ink">
                <span className="tabular-nums">{results.rows.length}</span>{" "}
                {results.rows.length === 1 ? "match" : "matches"}
              </p>
              {results.isAdmin ? (
                <Pill tone="maroon">Admin view — full records</Pill>
              ) : null}
            </div>

            <ul
              className={`grid gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-2 ${
                stale ? "opacity-60 transition-opacity" : "transition-opacity"
              }`}
            >
              {results.rows.map((student, index) => {
                // Present only for an admin; the arrays are index-aligned.
                const full = results.adminRows[index];
                return (
                  <li key={student._id} className="bg-surface p-5">
                    <div className="flex items-start gap-3.5">
                      <Monogram name={student.fullName} size="md" tone="ink" />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-[1.05rem] leading-snug text-ink">
                          {student.fullName}
                        </h3>
                        <p className="font-mono mt-1 text-[0.7rem] uppercase tracking-[0.1em] tabular-nums text-brass-ink">
                          {student.department} · {student.degree} ·{" "}
                          {student.yearOfJoining}–{student.yearOfPassing}
                        </p>
                        <p className="mt-1 text-[0.78rem] leading-snug text-slate-ink">
                          {DEPARTMENT_NAMES[student.department] ??
                            student.department}
                        </p>

                        {student.designation || student.company ? (
                          <p className="mt-2 text-[0.85rem] leading-snug text-ink">
                            {[student.designation, student.company]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}

                        {/* The full row, for an admin only. */}
                        {full ? (
                          <dl className="font-mono mt-3 space-y-1 border-t border-line pt-3 text-[0.7rem] text-slate-ink">
                            {[
                              ["Roll number", full.enrollmentNumber],
                              ["Personal email", full.personalEmail],
                              ["College email", full.collegeEmail],
                              ["Phone", full.phone],
                              ["Second phone", full.secondaryPhone],
                              ["Address", full.permanentAddress],
                            ]
                              .filter(([, value]) => String(value).length > 0)
                              .map(([label, value]) => (
                                <div
                                  key={label}
                                  className="flex justify-between gap-3"
                                >
                                  <dt>{label}</dt>
                                  <dd className="min-w-0 break-words text-right text-ink">
                                    {value}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {!results.isAdmin ? (
              <p className="mt-5 max-w-2xl text-[0.82rem] leading-relaxed text-slate-ink">
                Contact details, home addresses and roll numbers are not shown. You
                can search on a roll number or a college address because you may
                already know one — that is not the same as the portal handing them
                out. To reach a member, find them in the{" "}
                <a
                  href="/directory"
                  className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                >
                  directory
                </a>{" "}
                and ask to connect.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/** A guest, or a member the association has not verified yet. */
function NotAllowed({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mx-auto max-w-lg text-center">
      <Eyebrow>Verified members only</Eyebrow>
      <h2 className="font-display mt-3 text-3xl leading-snug text-ink">
        {signedIn
          ? "Your verification is still pending."
          : "Sign in to search the roster."}
      </h2>
      <p className="mt-4 text-[0.95rem] leading-relaxed text-slate-ink">
        {signedIn
          ? "The roster is the college's own record of real students, so it opens once the association has confirmed you are an RIT graduate. That is a manual check — allow a few days."
          : "The roster holds records for real students, so it is not a public search box."}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button href="/join">{signedIn ? "Check your status" : "Sign in"}</Button>
        <Button href="/directory" variant="outline">
          Browse the directory
        </Button>
      </div>
    </div>
  );
}

function Gate() {
  const access = useQuery(api.roster.canSearchRoster);
  if (access === undefined) return <LoadingRows rows={4} />;
  if (!access.allowed) return <NotAllowed signedIn={access.signedIn} />;
  return <RosterSearch />;
}

export default function StudentsPage() {
  return (
    <>
      <PageHeader
        image="/campus-4.jpg"
        module="Student database"
        title="Find anyone the college has a record of."
        lede="One box, three ways in: a name, a roll number, or a college address. This searches the register the association imported from its own department files — so it answers whether somebody actually studied here, which a member-written profile cannot."
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="dark">Name</Pill>
          <Pill tone="dark">Roll number</Pill>
          <Pill tone="dark">College address</Pill>
        </div>
      </PageHeader>

      <Shell>
        <section className="py-12 sm:py-16">
          <AuthLoading>
            <LoadingRows rows={4} />
          </AuthLoading>
          <Unauthenticated>
            <NotAllowed signedIn={false} />
          </Unauthenticated>
          <Authenticated>
            <Gate />
          </Authenticated>
        </section>
      </Shell>

      {/* ---- What this is, and is not ----------------------------------- */}
      <section className="border-t border-line bg-surface">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Two different registers"
            title="The roster and the directory answer different questions"
            lede="They are deliberately separate, and the difference matters when you are trying to confirm somebody is who they say they are."
          />
          <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
            <Card className="rounded-none border-0 shadow-none">
              <Eyebrow>This page — the roster</Eyebrow>
              <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                The college&rsquo;s own record
              </h3>
              <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                Entered by the association from its department spreadsheets. Nobody
                can edit their own row, which is exactly why a roll number checked
                against it means something. It carries every student, whether or not
                they have ever signed in.
              </p>
            </Card>
            <Card className="rounded-none border-0 shadow-none">
              <Eyebrow>/directory — profiles</Eyebrow>
              <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                What members chose to publish
              </h3>
              <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                Written and controlled by each member, including which contact
                fields stay private. It carries only members who signed in and filled
                it in — and it is where you connect and message.
              </p>
            </Card>
          </div>
          <p className="mt-8 max-w-3xl text-[0.85rem] leading-relaxed text-slate-ink">
            The association imports the roster from {RITAA.shortName}&rsquo;s own
            department files on the admin panel. Every column in that format is
            required, so a cohort appears here only once its sheet is complete.
          </p>
        </Shell>
      </section>
    </>
  );
}
