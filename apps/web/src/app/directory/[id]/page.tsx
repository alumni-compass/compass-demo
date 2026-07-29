"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import {
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  Monogram,
  PageHeader,
  Pill,
  Shell,
  Stat,
  VerifiedMark,
} from "@/components/kit";
import { DEPARTMENT_NAMES, RITAA } from "@/lib/site";

/**
 * Module 2 — an individual alumni profile.
 *
 * There is no getById query in the directory API, so the profile is read out of
 * the same search subscription the listing uses: one query, already warm from
 * the directory page, filtered down to the requested row. Every field arrives
 * pre-redacted by the backend, which is why null here means "kept private" and
 * is rendered as such rather than left as a gap.
 */

/** Ceiling for the lookup query. Above the association's current membership. */
const LOOKUP_LIMIT = 500;

function shortBatch(batch: number) {
  return `’${String(batch).slice(2)}`;
}

/** Mono label / value row used for the contact block. */
function ContactRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0">
      <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-[0.85rem] text-ink">
        {children}
      </dd>
    </div>
  );
}

/** Renders a shared value, or the association's standard privacy line. */
function Shared({
  value,
  href,
}: {
  value: string | null;
  href?: (value: string) => string;
}) {
  if (value === null) {
    return (
      <span className="font-mono text-[0.72rem] text-slate-ink">
        Not shared by this member
      </span>
    );
  }
  if (!href) return <>{value}</>;
  return (
    <a
      href={href(value)}
      className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
    >
      {value}
    </a>
  );
}

/** Small headed block for bio / skills / industries / mentor topics. */
function Block({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display mt-1.5 text-xl text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function AlumniProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const people = useQuery(api.directory.search, { limit: LOOKUP_LIMIT });
  const person = people?.find((row) => row._id === id);

  /* ---- Loading ------------------------------------------------------- */
  if (people === undefined) {
    return (
      <>
        <PageHeader
          module="Module 02 · Alumni Profile"
          title="Loading profile…"
          lede="Fetching the member record from the association directory."
        />
        <Shell>
          <section className="py-16 sm:py-20">
            <LoadingRows rows={4} />
          </section>
        </Shell>
      </>
    );
  }

  /* ---- Not found ----------------------------------------------------- */
  if (!person) {
    return (
      <>
        <PageHeader
          module="Module 02 · Alumni Profile"
          title="Profile not available"
          lede="This member record is either unpublished or the link is out of date."
        />
        <Shell>
          <section className="py-16 sm:py-20">
            <Empty
              title="This profile is not available"
              hint="The member may have left the directory, or the link may be from an older version of the site. Search the directory by name instead."
              action={<Button href="/directory">Back to directory</Button>}
            />
          </section>
        </Shell>
      </>
    );
  }

  const departmentName = DEPARTMENT_NAMES[person.department] ?? person.department;
  const mailto = person.email
    ? `mailto:${person.email}?subject=${encodeURIComponent(
        `${RITAA.shortName} — introduction request`,
      )}&body=${encodeURIComponent(
        [
          `Hello ${person.name},`,
          "",
          `I found your profile in the ${RITAA.shortName} alumni directory (${person.department}, batch ${person.batch}).`,
          "",
          "I would like to connect about:",
          "",
          "",
          `Sent from ${RITAA.website}`,
        ].join("\n"),
      )}`
    : null;

  return (
    <>
      <PageHeader
        module="Module 02 · Alumni Profile"
        title={person.name}
        lede={`${person.designation}${
          person.company ? ` · ${person.company}` : ""
        }`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <Monogram name={person.name} size="lg" tone="brass" />
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="dark">
              <span className="tabular-nums">{shortBatch(person.batch)}</span>
            </Pill>
            <Pill tone="dark">{person.department}</Pill>
            {person.region ? <Pill tone="dark">{person.region}</Pill> : null}
            {person.openToMentor ? <Pill tone="dark">Mentors</Pill> : null}
          </div>
        </div>
      </PageHeader>

      <Shell>
        <section className="py-12 sm:py-16">
          <Link
            href="/directory"
            className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-brass transition-colors hover:text-maroon"
          >
            ← Back to directory
          </Link>

          {/* ---- Verification + the four facts, in mono ------------------ */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {person.verified ? (
              <VerifiedMark />
            ) : (
              <Pill tone="quiet">Verification pending</Pill>
            )}
            {person.featured ? <Pill tone="brass">Featured member</Pill> : null}
            {person.openToMentor ? <Pill tone="jade">Open to mentoring</Pill> : null}
          </div>

          {/* Single column on phones: the middle cell's label is a full
              department name, which cannot fit in a third of a 360px viewport. */}
          <div className="mt-6 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
            <div className="bg-white p-5 sm:p-6">
              <Stat value={shortBatch(person.batch)} label="Graduating batch" />
            </div>
            <div className="bg-white p-5 sm:p-6">
              <Stat value={person.department} label={departmentName} />
            </div>
            <div className="bg-white p-5 sm:p-6">
              <Stat
                value={person.openToMentor ? "Yes" : "No"}
                label="Mentoring alumni & students"
              />
            </div>
          </div>

          {/* ---- Detail + contact --------------------------------------- */}
          <div className="mt-12 grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
            <div className="space-y-10">
              <Block eyebrow="Profile" title="About">
                {person.bio ? (
                  <p className="max-w-2xl text-[0.975rem] leading-relaxed text-slate-ink">
                    {person.bio}
                  </p>
                ) : (
                  <p className="text-[0.9rem] leading-relaxed text-slate-ink">
                    This member has not written a bio yet. The designation and
                    company above are the fields they chose to publish.
                  </p>
                )}
                <dl className="font-mono mt-6 max-w-md space-y-1 text-[0.72rem] text-slate-ink">
                  <div className="flex justify-between gap-3">
                    <dt>Designation</dt>
                    <dd className="text-right text-ink">{person.designation}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Company</dt>
                    <dd className="text-right text-ink">
                      {person.company ?? "Not shared by this member"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Department</dt>
                    <dd className="text-right text-ink">{departmentName}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Batch</dt>
                    <dd className="tabular-nums text-ink">{person.batch}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Region</dt>
                    <dd className="text-right text-ink">
                      {person.region ?? "Not shared by this member"}
                    </dd>
                  </div>
                </dl>
              </Block>

              <Block eyebrow="Capability" title="Skills">
                {person.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {person.skills.map((skill) => (
                      <Pill key={skill}>{skill}</Pill>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.9rem] text-slate-ink">
                    No skills listed yet.
                  </p>
                )}
              </Block>

              <Block eyebrow="Sectors" title="Industries">
                {person.industries.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {person.industries.map((industry) => (
                      <Pill key={industry} tone="brass">
                        {industry}
                      </Pill>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.9rem] text-slate-ink">
                    No industries listed yet.
                  </p>
                )}
              </Block>

              {person.openToMentor ? (
                <Block eyebrow="Module 05 · Mentorship" title="Will mentor on">
                  {person.mentorTopics.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {person.mentorTopics.map((topic) => (
                        <Pill key={topic} tone="jade">
                          {topic}
                        </Pill>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[0.9rem] text-slate-ink">
                      Open to mentoring, but no specific topics listed. Ask one
                      precise question when you write.
                    </p>
                  )}
                  <div className="mt-5">
                    <Button href="/mentorship" variant="outline">
                      Mentorship network
                    </Button>
                  </div>
                </Block>
              ) : null}
            </div>

            {/* ---- Contact card ---------------------------------------- */}
            <div>
              <Card>
                <Eyebrow>Contact</Eyebrow>
                <h2 className="font-display mt-1.5 text-xl text-ink">
                  Reach {person.name}
                </h2>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
                  Only the fields this member marked public are shown. RITAA does
                  not relay messages on their behalf.
                </p>

                <dl className="mt-5 border-t border-line">
                  <ContactRow label="Email">
                    <Shared
                      value={person.email}
                      href={(value) => `mailto:${value}`}
                    />
                  </ContactRow>
                  <ContactRow label="Phone">
                    <Shared value={person.phone} href={(value) => `tel:${value}`} />
                  </ContactRow>
                  <ContactRow label="LinkedIn">
                    {person.linkedinUrl ? (
                      <a
                        href={person.linkedinUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                      >
                        View profile ↗
                      </a>
                    ) : (
                      <Shared value={null} />
                    )}
                  </ContactRow>
                </dl>

                <div className="mt-6 flex flex-wrap gap-2">
                  {mailto ? (
                    <Button
                      onClick={() => {
                        window.location.href = mailto;
                      }}
                    >
                      Request connect
                    </Button>
                  ) : (
                    <span title="Email not shared" className="inline-flex">
                      <Button disabled>
                        Request connect
                        <span className="sr-only">
                          — email not shared by this member
                        </span>
                      </Button>
                    </span>
                  )}
                  <Button href="/directory" variant="outline">
                    Back to directory
                  </Button>
                </div>
              </Card>

              {/* ---- Module 02 · the owner's way back in ---------------- */}
              <Card className="mt-6">
                <Eyebrow>Module 02 · Your profile</Eyebrow>
                <h2 className="font-display mt-1.5 text-xl text-ink">
                  Is this you?
                </h2>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
                  Everything on this page comes from what {person.name} chose to
                  publish. Edit your own details, tags and per-field privacy on
                  the profile page — the verified mark stays with the association.
                </p>
                <div className="mt-5">
                  {/* kit's Button takes a plain string href, which is what lets
                      this link compile before the route types are regenerated. */}
                  <Button href="/profile" variant="outline">
                    Edit your profile
                  </Button>
                </div>
              </Card>

              <p className="font-mono mt-4 text-[0.7rem] leading-relaxed text-slate-ink">
                Association office: {RITAA.email} · {RITAA.phone}
              </p>
            </div>
          </div>
        </section>
      </Shell>
    </>
  );
}
