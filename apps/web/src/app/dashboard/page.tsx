"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";

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
  VerifiedMark,
} from "@/components/kit";
import { formatDate, formatEventDate, RITAA } from "@/lib/site";

/**
 * Points a member at the details form until they have finished it.
 *
 * Reads `profiles.completeness`, which derives the answer from whatever the
 * admin has configured as required rather than from a stored flag — so making
 * a field required in the console reopens this for everyone who never answered
 * it, and nobody is marked complete against a form that no longer exists.
 */
function DetailsNudge() {
  const status = useQuery(api.profiles.completeness);
  if (status === undefined || status.complete) return null;

  return (
    <div className="mt-10">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>Finish setting up</Eyebrow>
          {status.hasProfile ? (
            <Pill tone="brass">
              {status.answered} of {status.total} answered
            </Pill>
          ) : (
            <Pill tone="maroon">Nothing filled in yet</Pill>
          )}
        </div>
        <h3 className="font-display mt-2 text-xl text-ink">
          {status.hasProfile
            ? "A few details are still missing"
            : "Tell the association who you are"}
        </h3>
        <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
          {status.missing.length > 0
            ? `Still needed: ${status.missing.map((field) => field.label).join(", ")}.`
            : "Your name and email came from your sign-in. The rest is what makes you findable in the directory."}
        </p>
        <div className="mt-5">
          <Button href="/welcome">
            {status.hasProfile ? "Finish your details" : "Fill in your details"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Where a signed-in member most often wants to go next. */
const SHORTCUTS = [
  {
    href: "/map",
    title: "Where everyone is",
    copy: "The association on a map, drawn from the places members have shared — and every arc runs back to Rajapalayam.",
  },
  {
    href: "/network",
    title: "Your network",
    copy: "Answer connection requests, see who you are connected to, and find graduates you should know.",
  },
  {
    href: "/messages",
    title: "Messages",
    copy: "Direct threads with the members who accepted. Nothing leaves the portal.",
  },
  {
    href: "/profile",
    title: "Your profile",
    copy: "Edit your details and choose which contact fields other members can see.",
  },
  {
    href: "/directory",
    title: "Alumni directory",
    copy: "Search by batch, department, company or region.",
  },
  {
    href: "/careers",
    title: "Career hub",
    copy: "Roles posted by alumni, several offering a personal referral.",
  },
  {
    href: "/mentorship",
    title: "Mentorship",
    copy: "Book a mentor, or take requests as one.",
  },
  {
    href: "/race",
    title: "Entrepreneur zone",
    copy: "Ventures on RACE, and founders offering specific help.",
  },
  {
    href: "/giving",
    title: "Giving",
    copy: "Campaigns, the donor wall and the fund usage tracker.",
  },
] as const;

const ROLE_LABEL: Record<string, string> = {
  alumni: "Alumni",
  entrepreneur: "Entrepreneur",
  admin: "Admin",
  guest: "Guest",
};

function MemberDashboard() {
  const user = useQuery(api.auth.getCurrentUser);
  const email = user?.email ?? undefined;

  const role = useQuery(api.access.roleFor, email ? { email } : "skip");
  const verification = useQuery(
    api.access.verificationFor,
    email ? { email } : "skip",
  );
  const events = useQuery(api.events.list, { window: "upcoming" });
  const stats = useQuery(api.directory.stats);
  /* Both are session-derived — no argument names whose network to read. */
  const myNetwork = useQuery(api.network.myNetwork);
  const unread = useQuery(api.messaging.unreadCount);

  const nextEvent = (events ?? [])[0];
  const loading = user === undefined;

  if (loading) {
    return (
      <Shell className="py-16">
        <LoadingRows rows={4} />
      </Shell>
    );
  }

  return (
    <Shell className="py-14 sm:py-16">
      {/* Who you are, and what the association currently grants you. */}
      <div className="flex flex-wrap items-start gap-5 border-b border-line pb-10">
        <Monogram name={user?.name ?? user?.email ?? "Member"} size="lg" />
        <div className="min-w-0 flex-1">
          <Eyebrow>Signed in</Eyebrow>
          <h2 className="font-display mt-1 text-2xl text-ink">
            {user?.name ?? "Member"}
          </h2>
          {/* break-all so a long address cannot push the layout sideways. */}
          <p className="mt-1 break-all text-sm text-slate-ink">{user?.email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {role ? (
              <Pill tone={role.role === "guest" ? "quiet" : "brass"}>
                {ROLE_LABEL[role.role] ?? role.role}
              </Pill>
            ) : null}
            {verification?.status === "approved" ? <VerifiedMark /> : null}
            {verification?.status === "pending" ? (
              <Pill tone="quiet">Verification pending</Pill>
            ) : null}
            {verification?.status === "rejected" ? (
              <Pill tone="maroon">Verification declined</Pill>
            ) : null}
          </div>
        </div>
        <Button href="/profile" variant="outline">
          Edit profile
        </Button>
      </div>

      <DetailsNudge />

      {/* Verification is the gate on directory access, so surface it plainly.
          There is no form to send anyone to: /join is the sign-in screen and
          nothing in the portal calls access.requestVerification any more, so
          this names the office rather than offering a step that dead-ends. */}
      {verification === null ? (
        <div className="mt-10">
          <Card>
            <Eyebrow>Next step</Eyebrow>
            <h3 className="font-display mt-2 text-xl text-ink">
              Verify that you studied at RIT
            </h3>
            <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
              The association checks your roll number against college records before
              your profile joins the directory. It is a manual check, so allow a few
              days. There is no form on the site for it at the moment — write to the
              office with your batch, department and roll number and they will file
              the request.
            </p>
            <div className="mt-5">
              <Button href={`mailto:${RITAA.email}?subject=Alumni%20verification`}>
                Write to the office
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {verification?.status === "rejected" && verification.reviewNote ? (
        <div className="mt-10 border border-maroon/30 bg-maroon/5 p-6">
          <Eyebrow>Verification declined</Eyebrow>
          <p className="mt-2 text-[0.9rem] leading-relaxed text-ink">
            {verification.reviewNote}
          </p>
          <p className="mt-2 text-[0.85rem] text-slate-ink">
            Reviewed {formatDate(verification.reviewedAt ?? verification.createdAt)}.
            Write to {RITAA.email} if you think this is a mistake.
          </p>
        </div>
      ) : null}

      {/*
        Requests waiting on this member, above the association-wide numbers,
        because it is the only thing on this page that somebody else is blocked
        on. It renders as a card rather than a counter for the same reason — a
        number in a stat row reads as trivia, and this one needs answering.
      */}
      {myNetwork && myNetwork.counts.incoming > 0 ? (
        <div className="mt-10">
          <Card accent>
            <div className="flex flex-wrap items-start justify-between gap-4 pt-4">
              <div className="min-w-0">
                <Eyebrow>Waiting on you</Eyebrow>
                <h3 className="font-display mt-2 text-xl text-ink">
                  {myNetwork.counts.incoming === 1
                    ? `${myNetwork.incoming[0]?.member.name ?? "A member"} asked to connect`
                    : `${myNetwork.counts.incoming} members asked to connect`}
                </h3>
                <p className="mt-2 max-w-xl text-[0.9rem] leading-relaxed text-slate-ink">
                  {myNetwork.counts.incoming === 1
                    ? "Accepting opens a direct thread between you. Declining tells them nothing beyond that the request was answered."
                    : "Answer them from your network page. Accepting opens a direct thread with each member."}
                </p>
              </div>
              <Button href="/network">Review requests</Button>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Your own figures first, then the association's. */}
      <section className="py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            value={myNetwork?.counts.connections ?? "—"}
            label="Your connections"
          />
          <Stat value={unread ?? "—"} label="Unread messages" />
          <Stat value={stats?.alumni ?? "—"} label="Verified members" />
          <Stat value={stats?.mentors ?? "—"} label="Alumni mentoring" />
          <Stat value={stats?.companies ?? "—"} label="Companies" />
          <Stat value={stats?.ventures ?? "—"} label="Ventures on RACE" />
        </div>
      </section>

      {nextEvent ? (
        <section className="pb-4">
          <SectionHead eyebrow="Next event" title={nextEvent.title} />
          <Card>
            <p className="font-mono text-[0.75rem] tabular-nums text-maroon">
              {formatEventDate(nextEvent.startsAt)}
            </p>
            <p className="mt-2 text-[0.9rem] leading-relaxed text-slate-ink">
              {nextEvent.summary}
            </p>
            <div className="mt-5">
              <Button href="/events">Open events</Button>
            </div>
          </Card>
        </section>
      ) : null}

      <section className="py-12">
        <SectionHead eyebrow="Shortcuts" title="Where to go next" />
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUTS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group bg-white p-6 transition-colors hover:bg-bone"
            >
              <h3 className="font-display text-lg text-ink group-hover:text-maroon">
                {item.title}
              </h3>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
                {item.copy}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export default function DashboardPage() {
  return (
    <>
      <Authenticated>
        <MemberDashboard />
      </Authenticated>

      <Unauthenticated>
        <PageHeader
          module="Member area"
          title="Sign in to open your dashboard"
          lede="Your profile, the directory, mentorship and giving all live behind a RITAA account."
        />
        <Shell className="py-16">
          <Empty
            title="You are not signed in"
            hint="One click with Google or LinkedIn creates your account and opens your profile, the directory, mentorship and giving."
            action={<Button href="/join">Sign in or join RITAA</Button>}
          />
        </Shell>
      </Unauthenticated>

      <AuthLoading>
        <Shell className="py-16">
          <LoadingRows rows={4} />
        </Shell>
      </AuthLoading>
    </>
  );
}
