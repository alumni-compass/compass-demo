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

import Composer from "@/components/feed/composer";
import PostCard from "@/components/feed/post-card";
import {
  Avatar,
  Button,
  Eyebrow,
  Pill,
  Shell,
  VerifiedMark,
} from "@/components/kit";
import { MEMBER_NAV, RITAA } from "@/lib/site";

/**
 * The feed — where a member lands after signing in.
 *
 * WHY THERE IS NO MASTHEAD. Every other route on this portal opens with a dark
 * photographic header, which is right for a page you arrive at from outside and
 * wrong for the one page you return to daily. A masthead here would push the
 * composer and the first two posts below the fold every single visit. So this
 * route starts at the content, directly under the site bar, the way every feed
 * anyone already uses does.
 *
 * THREE COLUMNS, EACH DOING ONE JOB. Left: who you are and where you were
 * going. Centre: the conversation. Right: what is happening in the association
 * and who you have not met. The rails are sticky and the centre scrolls, so the
 * reading column never fights the page for height. Below `lg` the right rail
 * drops (its content is a digest, not a duty) and below `md` the left rail
 * becomes a scrolling strip of the same links.
 *
 * MOTION IS ORCHESTRATED, NOT SPRINKLED. One page-load sequence — the rails
 * settle, then the posts arrive staggered — and after that, motion only ever
 * responds to something a member did or something that genuinely arrived. Every
 * transform is dropped for a member who asked for reduced motion.
 */

/* ------------------------------------------------------------------ */
/* Rails                                                              */
/* ------------------------------------------------------------------ */

function IdentityCard() {
  const me = useQuery(api.profiles.byEmail);
  const status = useQuery(api.profiles.completeness);

  if (me === undefined) {
    return <div className="h-40 animate-pulse rounded-card bg-surface-sunk" />;
  }

  if (me === null) {
    return (
      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <Eyebrow>Not in the directory yet</Eyebrow>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          Your posts carry your name once you fill in your details. It takes a
          minute, and it is what makes you findable.
        </p>
        <div className="mt-4">
          <Button href="/welcome" size="sm">
            Fill in your details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {/* A band of the institutional weave, so the card reads as a membership
          card rather than a profile widget. */}
      <div className="ink-weave h-14" />
      <div className="-mt-7 px-4 pb-4">
        <Avatar name={me.name} src={me.avatarUrl ?? null} size="lg" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="font-display text-[1.15rem] font-medium leading-tight text-ink">
            {me.name}
          </p>
          {me.verified ? <VerifiedMark /> : null}
        </div>
        <p className="mt-1 text-[0.875rem] leading-snug text-slate-ink">
          {[me.batch ? `Batch of ${me.batch}` : null, me.department]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {me.designation || me.company ? (
          <p className="text-[0.875rem] leading-snug text-slate-ink">
            {[me.designation, me.company].filter(Boolean).join(" at ")}
          </p>
        ) : null}

        {status && !status.complete ? (
          <Link
            href="/welcome"
            className="mt-4 flex min-h-11 items-center justify-between rounded-control border border-brass/40 bg-bone px-4 text-[0.875rem] font-medium text-brass-ink transition-colors hover:border-brass"
          >
            <span>Finish your details</span>
            <span className="font-mono tabular-nums">
              {status.answered}/{status.total}
            </span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Shortcuts() {
  const pending = useQuery(api.network.pendingCount);
  const unread = useQuery(api.messaging.unreadCount);
  const moderation = useQuery(api.communities.moderationCount);

  const counts: Record<string, number | undefined> = {
    connections: pending,
    messages: unread,
    moderation,
  };

  return (
    <nav className="rounded-card border border-line bg-surface p-2 shadow-card">
      <ul>
        {MEMBER_NAV.map((item) => {
          const count = item.counter ? counts[item.counter] : undefined;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center justify-between gap-2 rounded-control px-3.5 text-[0.9375rem] text-ink/85 transition-colors hover:bg-bone hover:text-maroon"
              >
                {item.label}
                {count !== undefined && count > 0 ? (
                  <span className="count-badge">{count > 9 ? "9+" : count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <li className="mt-1 border-t border-line pt-1">
          <Link
            href="/directory"
            className="flex min-h-11 items-center rounded-control px-3.5 text-[0.9375rem] text-ink/85 transition-colors hover:bg-bone hover:text-maroon"
          >
            Directory
          </Link>
        </li>
      </ul>
    </nav>
  );
}

function ThisWeek() {
  const stats = useQuery(api.feed.feedStats);
  if (stats === undefined || !stats.authorized) return null;

  const rows = [
    { label: "Posts here", value: stats.generalPosts },
    { label: "In communities", value: stats.communityPosts },
    { label: "Polls", value: stats.polls },
    { label: "People posting", value: stats.contributors },
  ];

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <Eyebrow>The association, so far</Eyebrow>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
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
    </div>
  );
}

function PeopleToKnow() {
  const suggestions = useQuery(api.network.suggestions);
  if (suggestions === undefined || suggestions.needsProfile) return null;
  if (suggestions.rows.length === 0) return null;

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <Eyebrow>People you have not met</Eyebrow>
      <ul className="mt-3 space-y-3">
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
              <p className="truncate text-[0.8125rem] leading-snug text-slate-ink">
                {reason}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button href="/network" variant="outline" size="sm">
          Your network
        </Button>
      </div>
    </div>
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
      <div className="space-y-4">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-44 animate-pulse rounded-card border border-line bg-surface-sunk"
          />
        ))}
      </div>
    );
  }

  /* A signed-in member who is not yet verified. Say what the state is and what
     ends it, rather than showing an empty feed that reads as "nothing here". */
  if (!feed.authorized) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <Eyebrow>Waiting on verification</Eyebrow>
        <h2 className="font-display mt-2 text-xl leading-snug text-ink">
          Your account is in. The feed opens once the office confirms you.
        </h2>
        <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
          The association checks your batch and roll number against college
          records by hand — this feed is its internal square, so reading it waits
          for that. Everything public stays open to you in the meantime.
        </p>

        {/*
          WHICH ACCOUNT THIS IS, and it is the whole diagnostic. Roles are
          keyed on the email address, so somebody granted admin on their
          college address and signed in with a personal one sees this panel and
          has no way to tell why. Naming the address turns a mystery into a
          one-line answer.
        */}
        {me?.email ? (
          <div className="mt-4 rounded-control border border-line bg-bone px-3.5 py-2.5">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-slate-ink">
              Signed in as
            </p>
            <p className="font-mono mt-0.5 break-words text-[0.8rem] text-ink">
              {me.email}
            </p>
            <p className="mt-1.5 text-[0.78rem] leading-snug text-slate-ink">
              This address resolves to the{" "}
              <strong className="font-normal text-ink">
                {resolved?.role ?? "guest"}
              </strong>{" "}
              role. Access is granted per address, so if you were expecting more
              than this, you are probably signed in with a different account
              than the one the association granted it to.
            </p>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button href="/welcome">Check your details</Button>
          <Button href="/directory" variant="outline">
            Browse the directory
          </Button>
        </div>
        <p className="mt-4 text-[0.8rem] leading-relaxed text-slate-ink">
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
      <div className="rounded-card border border-dashed border-line-strong bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-brass-ink">
          Nothing posted yet
        </p>
        <h2 className="font-display mt-2 text-xl leading-snug text-ink">
          The first post is yours.
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-[0.9rem] leading-relaxed text-slate-ink">
          Whatever you write here reaches every verified member, across every
          batch and department. An opening at your company, a milestone, a
          question — start with one line.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-4"
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
    <div className="mx-auto w-full max-w-[1320px] px-5 py-6 sm:px-8 sm:py-8">
      <AuthLoading>
        <div className="h-64 animate-pulse rounded-card bg-surface-sunk" />
      </AuthLoading>

      <Unauthenticated>
        <div className="mx-auto max-w-lg py-16 text-center">
          <Eyebrow>Members only</Eyebrow>
          <h1 className="font-display mt-3 text-3xl leading-snug text-ink">
            Sign in to read the feed.
          </h1>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-slate-ink">
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
        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)_19rem] lg:items-start">
          <motion.aside
            className="hidden space-y-4 md:block lg:sticky lg:top-20"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <IdentityCard />
            <Shortcuts />
          </motion.aside>

          <div className="min-w-0 space-y-5">
            {/* On a phone the rails are gone, so the shortcuts ride along the
                top of the reading column instead of disappearing. */}
            <div className="-mx-5 overflow-x-auto px-5 md:hidden">
              <div className="flex gap-2">
                {MEMBER_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex min-h-10 shrink-0 items-center rounded-chip border border-line bg-surface px-4 text-[0.875rem] text-slate-ink"
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
            className="hidden space-y-4 lg:sticky lg:top-20 lg:block"
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
            <p className="px-1 text-[0.72rem] leading-relaxed text-slate-soft">
              {RITAA.name} · Estd {RITAA.established}
            </p>
          </motion.aside>
        </div>
      </Authenticated>
    </div>
  );
}
