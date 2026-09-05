"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";

import Composer from "@/components/feed/composer";
import PostCard from "@/components/feed/post-card";
import { Avatar, Button, VerifiedMark } from "@/components/kit";
import { RITAA } from "@/lib/site";

/**
 * The feed — where a member lands after signing in.
 *
 * TWO RAILS, TWO JOBS. Left: who you are and where to go — the card is the
 * anchor and the destinations carry their live counts, so the rail tells you
 * what has happened since you were last here. Right: what the association is
 * doing and who you have not met — a digest, not a duty, which is why it is the
 * one that drops first on a narrow screen.
 *
 * NO MASTHEAD. Every other route opens with a dark photographic header, which
 * is right for a page you arrive at from outside and wrong for the one you
 * return to daily — it would push the composer below the fold every visit.
 *
 * MOTION IS ONE SEQUENCE. The rails settle, then the posts arrive staggered.
 * After that, motion only answers something a member did or something that
 * genuinely arrived, and every transform is dropped under reduced motion.
 */

/* ------------------------------------------------------------------ */
/* Rail                                                               */
/* ------------------------------------------------------------------ */

/**
 * The destinations, drawn as marks rather than an icon library.
 *
 * Each one is a line drawing of the thing itself — a globe for the map, two
 * figures for the network, a sheet for the feed. Six glyphs is not worth a
 * dependency, and drawing them here keeps their weight matched to the type.
 */
function RailIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "size-5 shrink-0",
    "aria-hidden": true,
  };
  switch (name) {
    case "/feed":
      return (
        <svg {...common}>
          <rect x="3" y="3.5" width="14" height="13" rx="2" />
          <path d="M6.5 8h7M6.5 11.5h4" />
        </svg>
      );
    case "/map":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <path d="M3 10h14M10 3a11 11 0 0 1 0 14 11 11 0 0 1 0-14z" />
        </svg>
      );
    case "/communities":
      return (
        <svg {...common}>
          <circle cx="7" cy="8" r="2.5" />
          <circle cx="13.5" cy="8" r="2" />
          <path d="M3 16c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5M12 12.8c2 .2 3.5 1.4 3.5 3.2" />
        </svg>
      );
    case "/network":
      return (
        <svg {...common}>
          <circle cx="10" cy="6.5" r="2.5" />
          <path d="M5 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
        </svg>
      );
    case "/messages":
      return (
        <svg {...common}>
          <path d="M3.5 5.5h13v8h-8l-3.5 3v-3h-1.5z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 6h12M4 10h12M4 14h8" />
        </svg>
      );
  }
}

function RailLink({
  href,
  label,
  count,
}: {
  href: string;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href as never}
      className="group flex min-h-12 items-center gap-3 rounded-[10px] px-3 text-[0.9375rem] text-ink/85 transition-colors hover:bg-bone hover:text-maroon"
    >
      <span className="text-slate-ink transition-colors group-hover:text-maroon">
        <RailIcon name={href} />
      </span>
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className="count-badge">{count > 9 ? "9+" : count}</span>
      ) : null}
    </Link>
  );
}

/**
 * Who you are, at the top of the rail.
 *
 * The photograph and the batch line are the anchor: on a page of other
 * people's posts, the card is what says whose feed this is and gives one
 * click back to your own record. It reads its own query rather than taking
 * props, so it updates the moment a new photograph is saved on /profile.
 */
function IdentityCard() {
  const me = useQuery(api.profiles.byEmail);
  const status = useQuery(api.profiles.completeness);

  if (me === undefined) {
    return <div className="h-52 animate-pulse rounded-[14px] bg-surface-sunk" />;
  }

  if (me === null) {
    return (
      <div className="rounded-[14px] bg-surface p-5 shadow-card">
        <h2 className="font-display text-[1rem] font-medium text-ink">
          You are not in the directory yet
        </h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
          Your posts carry your name once you fill in your details, and it is
          what makes you findable to the batch below you.
        </p>
        <div className="mt-4">
          <Button href="/welcome" size="sm">
            Fill in your details
          </Button>
        </div>
      </div>
    );
  }

  const work = [me.designation, me.company].filter(Boolean).join(" at ");

  return (
    <div className="overflow-hidden rounded-[14px] bg-surface shadow-card">
      {/* A band of the institutional weave, so the card reads as a membership
          card rather than a profile widget. */}
      <div className="ink-weave h-16" />
      <div className="-mt-9 px-5 pb-5">
        <Link href="/profile" className="inline-block">
          <span className="block rounded-full ring-4 ring-surface">
            <Avatar name={me.name} src={me.avatarUrl ?? null} size="lg" />
          </span>
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Link
            href="/profile"
            className="font-display text-[1.15rem] font-medium leading-tight text-ink transition-colors hover:text-maroon"
          >
            {me.name}
          </Link>
          {me.verified ? <VerifiedMark /> : null}
        </div>

        {[me.batch ? `Batch of ${me.batch}` : null, me.department].filter(Boolean)
          .length > 0 ? (
          <p className="mt-1 text-[0.875rem] leading-snug text-slate-ink">
            {[me.batch ? `Batch of ${me.batch}` : null, me.department]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {work ? (
          <p className="text-[0.875rem] leading-snug text-slate-ink">{work}</p>
        ) : null}
        {me.location ? (
          <p className="mt-1 text-[0.8125rem] leading-snug text-slate-soft">
            {me.location}
          </p>
        ) : null}

        {status && !status.complete ? (
          <Link
            href="/welcome"
            className="mt-4 flex min-h-11 items-center justify-between rounded-[10px] border border-brass/40 bg-bone px-4 text-[0.875rem] font-medium text-brass-ink transition-colors hover:border-brass"
          >
            <span>Finish your details</span>
            <span className="font-mono tabular-nums">
              {status.answered}/{status.total}
            </span>
          </Link>
        ) : (
          <Link
            href="/profile"
            className="mt-4 flex min-h-11 items-center justify-center rounded-[10px] border border-line bg-bone px-4 text-[0.875rem] font-medium text-slate-ink transition-colors hover:border-line-strong hover:text-ink"
          >
            Edit your profile
          </Link>
        )}
      </div>
    </div>
  );
}

function Rail() {
  const pending = useQuery(api.network.pendingCount);
  const unread = useQuery(api.messaging.unreadCount);
  const moderation = useQuery(api.communities.moderationCount);
  const role = useQuery(api.access.roleFor, {});

  const counts: Record<string, number | undefined> = {
    "/network": pending,
    "/messages": unread,
    "/communities": moderation,
  };

  const links = [
    { href: "/feed", label: "Feed" },
    { href: "/network", label: "Network" },
    { href: "/messages", label: "Messages" },
    { href: "/communities", label: "Communities" },
    { href: "/map", label: "Where everyone is" },
    { href: "/directory", label: "Directory" },
  ];

  return (
    <div className="rounded-[14px] bg-surface p-2.5 shadow-card">
      <nav>
        {links.map((link) => (
          <RailLink
            key={link.href}
            href={link.href}
            label={link.label}
            count={counts[link.href]}
          />
        ))}
      </nav>

      {role?.role === "admin" ? (
        <div className="mt-1.5 border-t border-line pt-1.5">
          <RailLink href="/admin" label="Admin console" />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right rail                                                         */
/* ------------------------------------------------------------------ */

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] bg-surface p-5 shadow-card">
      <h2 className="font-display text-[1rem] font-medium leading-snug text-ink">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ThisWeek() {
  const stats = useQuery(api.feed.feedStats);
  if (stats === undefined || !stats.authorized) return null;

  const rows = [
    { label: "Posts here", value: stats.generalPosts },
    { label: "In communities", value: stats.communityPosts },
    { label: "Polls running", value: stats.polls },
    { label: "People posting", value: stats.contributors },
  ];

  return (
    <Panel title="The association, so far">
      <dl className="space-y-2.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5 last:border-0 last:pb-0"
          >
            <dt className="text-[0.875rem] text-slate-ink">{row.label}</dt>
            {/* Figures stay mono and tabular — a column of numbers is the one
                place the utility face is doing real work. */}
            <dd className="font-mono text-[1rem] tabular-nums text-ink">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function PeopleToKnow() {
  const suggestions = useQuery(api.network.suggestions);
  if (suggestions === undefined || suggestions.needsProfile) return null;
  if (suggestions.rows.length === 0) return null;

  return (
    <Panel title="People you have not met">
      <ul className="space-y-3.5">
        {suggestions.rows.slice(0, 4).map(({ member, reason }) => (
          <li key={String(member.alumniId)} className="flex gap-3">
            <Avatar name={member.name} src={member.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <Link
                href={`/directory/${member.alumniId}`}
                className="block truncate text-[0.9375rem] text-ink transition-colors hover:text-maroon"
              >
                {member.name}
              </Link>
              {/* Two lines rather than one: the reason now names mutual
                  connections as well as the batch, and truncating it to a
                  single line cut off the half that persuades anybody. */}
              <p className="line-clamp-2 text-[0.8125rem] leading-snug text-slate-ink">
                {reason}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button href="/network" variant="outline" size="sm">
          Find people
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* The stream                                                          */
/* ------------------------------------------------------------------ */

function Stream() {
  const feed = useQuery(api.feed.generalFeed, {});
  const me = useQuery(api.auth.getCurrentUser);
  const resolved = useQuery(
    api.access.roleFor,
    me?.email ? { email: me.email } : {},
  );
  const reduce = useReducedMotion();

  if (feed === undefined) {
    return (
      <div className="space-y-5">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-52 animate-pulse rounded-[14px] bg-surface-sunk"
          />
        ))}
      </div>
    );
  }

  /* A signed-in member who is not yet verified. Say what the state is, what
     ends it, and which account this actually is. */
  if (!feed.authorized) {
    return (
      <div className="rounded-[14px] bg-surface p-7 shadow-card">
        <p className="text-[0.875rem] font-medium text-brass-ink">
          Waiting on verification
        </p>
        <h2 className="font-display mt-2 text-[1.4rem] leading-snug text-ink">
          Your account is in. The feed opens once the office confirms you.
        </h2>
        <p className="mt-3 text-[1rem] leading-[1.65] text-slate-ink">
          The association checks your batch and roll number against college
          records by hand — this feed is its internal square, so reading it waits
          for that. Everything public stays open to you in the meantime.
        </p>

        {/* Which account this is, and it is the whole diagnostic: roles are
            keyed on the address, so somebody granted access on one and signed
            in with another needs to be told which one they are. */}
        {me?.email ? (
          <div className="mt-5 rounded-[10px] bg-bone px-4 py-3.5">
            <p className="text-[0.8125rem] text-slate-ink">Signed in as</p>
            <p className="font-mono mt-0.5 break-words text-[0.9375rem] text-ink">
              {me.email}
            </p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
              This address resolves to the{" "}
              <strong className="font-medium text-ink">
                {resolved?.role ?? "guest"}
              </strong>{" "}
              role. Access is granted per address, so if you expected more than
              this, you are probably signed in with a different account than the
              one it was granted to.
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/welcome">Check your details</Button>
          <Button href="/directory" variant="outline">
            Browse the directory
          </Button>
        </div>
        <p className="mt-4 text-[0.875rem] leading-relaxed text-slate-ink">
          Waiting longer than you expected? Write to{" "}
          <a
            href={`mailto:${RITAA.email}`}
            className="text-maroon underline decoration-brass/50 underline-offset-4"
          >
            {RITAA.email}
          </a>
          .
        </p>
      </div>
    );
  }

  if (feed.posts.length === 0) {
    return (
      <div className="rounded-[14px] bg-surface p-10 text-center shadow-card">
        <p className="text-[0.875rem] font-medium text-brass-ink">
          Nothing posted yet
        </p>
        <h2 className="font-display mt-2 text-[1.4rem] leading-snug text-ink">
          The first post is yours.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[1rem] leading-[1.65] text-slate-ink">
          Whatever you write here reaches every verified member, across every
          batch and department. An opening at your company, a milestone, a
          question — start with one line.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-5"
      initial="rest"
      animate="in"
      variants={{ in: { transition: { staggerChildren: reduce ? 0 : 0.04 } } }}
    >
      <AnimatePresence initial={false}>
        {feed.posts.map((post) => (
          <motion.div
            key={String(post._id)}
            layout={!reduce}
            variants={{
              rest: reduce ? { opacity: 0 } : { opacity: 0, y: 10 },
              in: { opacity: 1, y: 0 },
            }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration: reduce ? 0.01 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <PostCard post={post} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export default function FeedPage() {
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto w-full max-w-[1320px] px-5 py-8 sm:px-8 sm:py-11">
      <AuthLoading>
        <div className="h-72 animate-pulse rounded-[14px] bg-surface-sunk" />
      </AuthLoading>

      <Unauthenticated>
        <div className="mx-auto max-w-lg py-20 text-center">
          <p className="text-[0.875rem] font-medium text-brass-ink">
            Members only
          </p>
          <h1 className="font-display mt-3 text-[2rem] leading-snug text-ink">
            Sign in to read the feed.
          </h1>
          <p className="mt-4 text-[1.0625rem] leading-[1.65] text-slate-ink">
            This is the association&rsquo;s internal square rather than a public
            noticeboard, so it needs to know who you are. One click with Google
            or LinkedIn.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/join">Sign in</Button>
            <Button href="/about" variant="outline">
              About {RITAA.shortName}
            </Button>
          </div>
        </div>
      </Unauthenticated>

      <Authenticated>
        <div className="grid gap-7 lg:grid-cols-[17rem_minmax(0,1fr)_19rem] lg:items-start xl:gap-8">
          <motion.aside
            className="hidden md:block lg:sticky lg:top-20"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="space-y-5">
              <IdentityCard />
              <Rail />
            </div>
          </motion.aside>

          <div className="min-w-0 space-y-6">
            {/* On a phone the rails are gone, so the destinations ride along
                the top of the reading column instead of disappearing. */}
            <div className="-mx-5 overflow-x-auto px-5 md:hidden">
              <div className="flex gap-2">
                {[
                  { href: "/network", label: "Network" },
                  { href: "/messages", label: "Messages" },
                  { href: "/communities", label: "Communities" },
                  { href: "/map", label: "Map" },
                  { href: "/directory", label: "Directory" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href as never}
                    className="flex min-h-10 shrink-0 items-center rounded-chip bg-surface px-4 text-[0.875rem] text-slate-ink shadow-card"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            <Composer />
            <Stream />
          </div>

          <motion.aside
            className="hidden space-y-5 lg:sticky lg:top-20 lg:block"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: reduce ? 0.01 : 0.35,
              delay: reduce ? 0 : 0.06,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <ThisWeek />
            <PeopleToKnow />
            <p className="px-1 text-[0.8125rem] leading-relaxed text-slate-soft">
              {RITAA.name} · Estd {RITAA.established}
            </p>
          </motion.aside>
        </div>
      </Authenticated>
    </div>
  );
}
