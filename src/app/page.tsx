"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";

import BatchRail from "@/components/batch-rail";
import {
  Button,
  Card,
  Eyebrow,
  Meter,
  Monogram,
  Pill,
  SectionHead,
  Shell,
  Stat,
  VerifiedMark,
} from "@/components/kit";
import { DEPARTMENT_NAMES, formatEventDate, inr, RITAA } from "@/lib/site";

/** The six member-facing modules, in the order the brief presents them. */
const PILLARS = [
  {
    href: "/directory",
    title: "Alumni Directory",
    copy: "Search every verified member by batch, department, company or region, then ask to connect — and see who you both already know.",
  },
  {
    href: "/careers",
    title: "Career Hub",
    copy: "Roles posted by alumni who will personally refer you. Upload a resume once and reuse it across applications.",
  },
  {
    href: "/mentorship",
    title: "Mentorship Network",
    copy: "Alumni mentor alumni, and alumni mentor students. Book a slot against one specific question.",
  },
  {
    href: "/race",
    title: "Entrepreneur Zone",
    copy: "RACE is where founders publish their ventures and where anyone with an idea can ask for guidance.",
  },
  {
    href: "/events",
    title: "Events",
    copy: "Sangamam, the founder clinic, placement intensives and the sports league. RSVP and get reminded.",
  },
  {
    href: "/giving",
    title: "Giving",
    copy: "Fund scholarships and labs, then follow every rupee through the usage tracker.",
  },
  // `as const` keeps the hrefs as literal route types for typedRoutes.
] as const;

export default function HomePage() {
  const stats = useQuery(api.directory.stats);
  const featured = useQuery(api.directory.featured, { limit: 4 });
  const events = useQuery(api.events.list, { window: "upcoming" });
  const stories = useQuery(api.stories.featured);
  const campaigns = useQuery(api.giving.listCampaigns, { activeOnly: true });
  const raceStats = useQuery(api.race.raceStats);
  /** Counts only, so this is readable before anyone signs in. */
  const network = useQuery(api.network.networkStats);

  const upcoming = (events ?? []).slice(0, 3);
  const topCampaign = (campaigns ?? [])[0];

  return (
    <>
      {/* ---- Hero: the thesis is "your batch is your door in" -------------
          Backed by the college's own convocation photograph — the people in it
          are the alumni this portal is for. A heavy ink overlay keeps the
          headline at full contrast rather than relying on a text shadow. */}
      <section className="relative isolate overflow-hidden">
        {/* Plain <img> and not next/image: this is a local static asset and
            next/image would add a loader round-trip for no benefit here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/campus-1.jpg"
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-ink/90 mix-blend-multiply"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-maroon/40"
        />
        <Shell className="relative pb-12 pt-16 sm:pb-16 sm:pt-24">
          <Eyebrow tone="bone">
            {RITAA.shortName} · Estd {RITAA.established} · Rajapalayam
          </Eyebrow>
          <h1 className="font-display mt-5 max-w-4xl text-[2.5rem] leading-[1.02] text-bone sm:text-6xl">
            Every RIT graduate is already in someone&rsquo;s network.
            <span className="text-brass-soft"> This is where you find them.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-bone/70">
            {RITAA.vision} Connect, collaborate, contribute — and keep growing long
            after the last semester.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Button href="/join" variant="onDark">
              Join RITAA
            </Button>
            <Button
              href="/directory"
              variant="ghost"
              className="!text-brass-soft hover:!text-bone"
            >
              Browse the directory →
            </Button>
          </div>

          {/* The signature device, sitting directly under the statement. */}
          <div className="mt-14 border-t border-white/10 pt-8">
            <BatchRail onDark />
          </div>
        </Shell>
      </section>

      {/* ---- Headline numbers -------------------------------------------- */}
      <section className="border-b border-line bg-surface">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-3 lg:grid-cols-6">
            <Stat value={stats?.alumni ?? "—"} label="Verified members" />
            <Stat value={network?.connections ?? "—"} label="Connections made" />
            <Stat value={stats?.batches ?? "—"} label="Batches represented" />
            <Stat value={stats?.companies ?? "—"} label="Companies & institutions" />
            <Stat value={stats?.mentors ?? "—"} label="Alumni mentoring" />
            <Stat value={stats?.ventures ?? "—"} label="Ventures on RACE" />
          </div>
        </Shell>
      </section>

      {/* ---- The network: what the portal is actually for ----------------
          Its own band rather than a seventh tile in the grid below. The six
          tiles map to the brief's modules; connecting is the thing that makes
          any of them work, so it gets stated before them and once. */}
      <section className="border-b border-line bg-surface-sunk">
        <Shell className="py-16 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-center">
            <div>
              <Eyebrow>Your network</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-[1.1] text-ink sm:text-4xl">
                A list of names is not a network.
              </h2>
              <p className="mt-4 max-w-lg text-[1rem] leading-relaxed text-slate-ink">
                Ask any member to connect and say why. When they accept, a direct
                thread opens between you — inside the portal, with no phone number
                changing hands. What other members can see of your contact details
                stays yours to set, and stays private by default.
              </p>
              <p className="mt-4 max-w-lg text-[0.9rem] leading-relaxed text-slate-ink">
                Where somebody you already know also knows the member you are
                looking at, {RITAA.shortName} names them. Knowing that one specific
                person can introduce you is the difference between a cold request
                and a warm one.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/network">Open your network</Button>
                <Button href="/directory" variant="outline">
                  Find members
                </Button>
              </div>
            </div>

            {/*
              A worked example of the mutual marker, not a screenshot. It is the
              one device on the site worth showing before a visitor has an account,
              because it is the thing they cannot get from a directory.
            */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
              <Eyebrow>What a member card tells you</Eyebrow>
              <div className="mt-5 flex items-start gap-4">
                <Monogram name="Priya Raman" size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg leading-snug text-ink">
                      Priya Raman
                    </span>
                    <VerifiedMark />
                    <span className="font-mono rounded-chip border border-line-strong bg-bone px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.1em] text-slate-ink">
                      2nd
                    </span>
                  </div>
                  <p className="font-mono mt-1 text-[0.7rem] tabular-nums text-brass-ink">
                    CSE · &rsquo;21
                  </p>
                  <p className="mt-1.5 text-[0.85rem] leading-snug text-ink">
                    Platform Engineer · Zoho
                  </p>
                  <p className="mutual-marker mt-3 text-[0.8rem] leading-snug text-slate-ink">
                    <span className="text-ink">Arun Kumar</span> knows you both
                  </p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
                <span className="font-mono inline-flex min-h-9 items-center rounded-control bg-maroon px-3.5 text-[0.7rem] uppercase tracking-[0.12em] text-bone">
                  Connect
                </span>
                <span className="font-mono inline-flex min-h-9 items-center rounded-control border border-ink/20 px-3.5 text-[0.7rem] uppercase tracking-[0.12em] text-ink">
                  View profile
                </span>
              </div>
              <p className="mt-5 text-[0.78rem] leading-snug text-slate-soft">
                An illustration of the card, with a sample member. Real members
                appear in the directory.
              </p>
            </div>
          </div>
        </Shell>
      </section>

      {/* ---- What the association does ----------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="What RITAA runs"
            title="Six things the association actually does"
            lede="Not a noticeboard. Each of these is staffed by alumni volunteers and used every week."
          />
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar) => (
              <Link
                key={pillar.href}
                href={pillar.href}
                className="group bg-white p-7 transition-colors hover:bg-bone"
              >
                <h3 className="font-display text-xl text-ink group-hover:text-maroon">
                  {pillar.title}
                </h3>
                <p className="mt-2.5 text-[0.9rem] leading-relaxed text-slate-ink">
                  {pillar.copy}
                </p>
                <span className="font-mono mt-4 inline-block text-[0.7rem] uppercase tracking-[0.12em] text-brass">
                  Open →
                </span>
              </Link>
            ))}
          </div>
        </section>
      </Shell>

      {/* ---- RACE: RITAA's differentiator, given real weight -------------- */}
      <section className="border-y border-line bg-ink-soft">
        <Shell className="py-16 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            <div>
              <Eyebrow tone="bone">Entrepreneur Zone · Powered by RACE</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-[1.1] text-bone sm:text-4xl">
                Hi Entrepreneur.
              </h2>
              <p className="mt-4 max-w-lg text-[1rem] leading-relaxed text-bone/70">
                RACE is the part of RITAA for people who started something — or want
                to. Established founders publish a full business profile. Anyone with
                an idea marks themselves <em>Upcoming</em>, describes it, and asks for
                the specific help they need.
              </p>
              <p className="mt-4 max-w-lg text-[0.9rem] leading-relaxed text-bone/55">
                Most requests here are not for money. They are for the one piece of
                operational knowledge that unblocks a founder — which body certifies a
                retrofit kit, how an FSSAI licence is actually issued, what a first
                export invoice looks like.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/race" variant="onDark">
                  Enter the zone
                </Button>
                <Button
                  href="/race#submit"
                  variant="ghost"
                  className="!text-brass-soft hover:!text-bone"
                >
                  Submit your venture →
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px bg-white/10">
              {[
                { v: raceStats?.total, l: "Ventures registered" },
                { v: raceStats?.established, l: "Established businesses" },
                { v: raceStats?.upcoming, l: "Ideas seeking guidance" },
                { v: raceStats?.categories, l: "Industries represented" },
              ].map((cell) => (
                <div key={cell.l} className="bg-ink-soft p-7">
                  <Stat value={cell.v ?? "—"} label={cell.l} onDark />
                </div>
              ))}
            </div>
          </div>
        </Shell>
      </section>

      {/* ---- Upcoming events --------------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Events"
            title="What's next on the calendar"
            lede="Reunions, webinars, sports and networking. RSVP once and the association reminds you."
            action={
              <Button href="/events" variant="outline">
                All events
              </Button>
            }
          />
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-ink">
              No events are open for RSVP right now. The next Sangamam is announced at
              the general body meeting.
            </p>
          ) : (
            <div className="grid gap-px bg-line lg:grid-cols-3">
              {upcoming.map((event) => (
                <article key={event._id} className="bg-white p-7">
                  <div className="flex items-center gap-2">
                    <Pill tone="brass">{event.kind}</Pill>
                    <Pill>{event.mode}</Pill>
                  </div>
                  <p className="font-mono mt-4 text-[0.75rem] tabular-nums text-maroon">
                    {formatEventDate(event.startsAt)}
                  </p>
                  <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                    <Link href={`/events#${event.slug}`} className="hover:text-maroon">
                      {event.title}
                    </Link>
                  </h3>
                  <p className="mt-2.5 text-[0.9rem] leading-relaxed text-slate-ink">
                    {event.summary}
                  </p>
                  <dl className="font-mono mt-5 space-y-1 text-[0.72rem] text-slate-ink">
                    <div className="flex justify-between gap-3">
                      <dt>Venue</dt>
                      <dd className="text-right text-ink">{event.venue}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Entry</dt>
                      <dd className="text-ink">
                        {event.ticketPriceInr === 0
                          ? "Free"
                          : inr(event.ticketPriceInr)}
                      </dd>
                    </div>
                    {event.seatsLeft !== null ? (
                      <div className="flex justify-between gap-3">
                        <dt>Seats left</dt>
                        <dd className="tabular-nums text-ink">{event.seatsLeft}</dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>
      </Shell>

      {/* ---- Featured alumni highlight reel ------------------------------ */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Highlight reel"
            title="Members worth knowing"
            lede="Featured by the association for what they have built, and for the time they give back."
            action={
              <Button href="/directory" variant="outline">
                Full directory
              </Button>
            }
          />
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {(featured ?? []).map((person) => (
              <li key={person._id} className="bg-white p-6">
                <Monogram name={person.name} size="lg" />
                <h3 className="font-display mt-4 text-lg leading-snug text-ink">
                  {person.name}
                </h3>
                <p className="font-mono mt-1 text-[0.7rem] tabular-nums text-brass">
                  {person.department} · &rsquo;{String(person.batch).slice(2)}
                </p>
                <p className="mt-2 text-[0.85rem] leading-snug text-ink">
                  {person.designation}
                </p>
                <p className="text-[0.85rem] text-slate-ink">{person.company}</p>
                {person.bio ? (
                  <p className="mt-3 text-[0.82rem] leading-relaxed text-slate-ink">
                    {person.bio}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {person.verified ? <VerifiedMark /> : null}
                  {person.openToMentor ? <Pill tone="jade">Mentors</Pill> : null}
                </div>
              </li>
            ))}
          </ul>
        </Shell>
      </section>

      {/* ---- Campus photographs from the college's own archive ----------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="On campus"
            title="Where it started"
            lede="Convocation at Rajapalayam. Every batch on the rail above walked through a hall like this one."
            action={
              <Button href="/gallery" variant="outline">
                Full gallery
              </Button>
            }
          />
          <div className="grid gap-px bg-line sm:grid-cols-3">
            {[
              { src: "/campus-2.jpg", caption: "Convocation, RIT campus" },
              { src: "/campus-4.jpg", caption: "Graduating cohort" },
              { src: "/campus-6.jpg", caption: "Degree day" },
            ].map((shot) => (
              <figure key={shot.src} className="bg-white">
                {/* aspect-[4/3] fixes the frame so the row cannot shift as
                    images decode at different rates. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.src}
                  alt={shot.caption}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                <figcaption className="font-mono px-4 py-3 text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                  {shot.caption}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </Shell>

      {/* ---- Stories + giving, side by side ------------------------------ */}
      <Shell>
        <section className="grid gap-16 py-16 sm:py-20 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <SectionHead
              eyebrow="News & stories"
              title="From the community"
              action={
                <Button href="/stories" variant="outline">
                  All stories
                </Button>
              }
            />
            <ul className="divide-y divide-line border-y border-line">
              {(stories ?? []).map((story) => (
                <li key={story._id} className="py-6">
                  <Pill tone="quiet">{story.category}</Pill>
                  <h3 className="font-display mt-3 text-xl leading-snug text-ink">
                    <Link
                      href={`/stories/${story.slug}`}
                      className="hover:text-maroon"
                    >
                      {story.title}
                    </Link>
                  </h3>
                  <p className="mt-2 text-[0.9rem] leading-relaxed text-slate-ink">
                    {story.excerpt}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SectionHead eyebrow="Giving" title="Where the money goes" />
            {topCampaign ? (
              <Card>
                <Eyebrow>{topCampaign.cause}</Eyebrow>
                <h3 className="font-display mt-2 text-xl text-ink">
                  {topCampaign.title}
                </h3>
                <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                  {topCampaign.summary}
                </p>
                <div className="mt-6">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-lg tabular-nums text-maroon">
                      {inr(topCampaign.raisedInr, { compact: true })}
                    </span>
                    <span className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                      of {inr(topCampaign.goalInr, { compact: true })}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Meter value={topCampaign.progress} />
                  </div>
                  <p className="font-mono mt-2 text-[0.72rem] tabular-nums text-slate-ink">
                    {topCampaign.donorCount} donors
                  </p>
                </div>
                <div className="mt-6">
                  <Button href="/giving">Give now</Button>
                </div>
              </Card>
            ) : null}
          </div>
        </section>
      </Shell>

      {/* ---- The brief's closing line, used exactly once ------------------ */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 text-center sm:py-20">
          <p className="font-display mx-auto max-w-3xl text-2xl leading-snug text-ink sm:text-[1.75rem]">
            {RITAA.creed}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/join">Create your profile</Button>
            <Button href="/about" variant="outline">
              About the association
            </Button>
          </div>
          <p className="font-mono mt-10 text-[0.72rem] uppercase tracking-[0.14em] text-slate-ink">
            {Object.keys(DEPARTMENT_NAMES).join(" · ")}
          </p>
        </Shell>
      </section>
    </>
  );
}
