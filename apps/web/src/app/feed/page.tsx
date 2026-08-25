"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import Link from "next/link";

import {
  Button,
  Card,
  Eyebrow,
  LoadingRows,
  PageHeader,
  Pill,
  Shell,
  Stat,
} from "@/components/kit";
import { Composer, PostList } from "@/components/post-feed";
import { RITAA } from "@/lib/site";

/**
 * The general feed — every batch, every year, one place.
 *
 * This is the surface the association asked for: a post here reaches the whole
 * membership rather than one cohort or one community. Community feeds live on each
 * community's own page, and `feed.generalFeed` deliberately excludes them, so this
 * page never mixes a private group's conversation into the shared one.
 *
 * Verified members only, on both sides. Reading is gated because it is the
 * association's internal square, not a public noticeboard; posting is gated for the
 * same reason. A guest gets the verification prompt rather than an empty feed,
 * because an empty feed would read as "nothing is happening here".
 */

function FeedBody() {
  const feed = useQuery(api.feed.generalFeed, {});
  const stats = useQuery(api.feed.feedStats);
  const mine = useQuery(api.communities.myCommunities);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_19rem] lg:items-start">
      <div className="space-y-4">
        <Composer placeholder="Share something with every RITAA member — an opening, a milestone, a question for the network." />
        <PostList
          posts={feed?.posts}
          emptyTitle="Nothing has been posted yet."
          emptyHint="Be the first. A post here is read by every verified member, across every batch and department."
        />
      </div>

      {/* ---- Side rail ------------------------------------------------- */}
      <aside className="space-y-4 lg:sticky lg:top-24">
        <Card>
          <Eyebrow>This feed</Eyebrow>
          <div className="mt-4 grid grid-cols-2 gap-5">
            <Stat value={stats?.generalPosts ?? "—"} label="Posts" />
            <Stat value={stats?.contributors ?? "—"} label="Members posting" />
            <Stat value={stats?.polls ?? "—"} label="Polls" />
            <Stat value={stats?.communityPosts ?? "—"} label="In communities" />
          </div>
          <p className="mt-5 border-t border-line pt-4 text-[0.8rem] leading-relaxed text-slate-ink">
            Everything here is visible to every verified member. For a smaller
            audience, post inside a community instead.
          </p>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>Your communities</Eyebrow>
            {mine && mine.pending > 0 ? (
              <Pill tone="brass">{mine.pending} pending</Pill>
            ) : null}
          </div>

          {mine === undefined ? (
            <p className="mt-3 text-[0.85rem] text-slate-ink">Loading…</p>
          ) : mine.rows.length === 0 ? (
            <>
              <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
                You have not joined any community yet. They are smaller rooms — a
                batch, a department, a shared interest — with their own feed.
              </p>
              <div className="mt-4">
                <Button href="/communities" variant="outline" size="sm">
                  Browse communities
                </Button>
              </div>
            </>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {mine.rows.map((community) => (
                  <li key={community._id} className="py-2.5">
                    <Link
                      href={`/communities/${community.slug}` as never}
                      className="group flex items-start justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[0.875rem] text-ink transition-colors group-hover:text-maroon">
                          {community.name}
                        </span>
                        <span className="font-mono block text-[0.65rem] tabular-nums text-slate-ink">
                          {community.memberCount} members ·{" "}
                          {community.postCount} posts
                        </span>
                      </span>
                      {community.standing === "pending" ? (
                        <Pill tone="brass">Pending</Pill>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Button href="/communities" variant="outline" size="sm">
                  All communities
                </Button>
              </div>
            </>
          )}
        </Card>
      </aside>
    </div>
  );
}

export default function FeedPage() {
  return (
    <>
      <PageHeader
        module="General feed"
        title="One place the whole association reads."
        lede="Every verified member sees this feed, whatever their batch or department. Post an opening, an achievement, a question — or run a poll and get an answer from the whole membership."
      />

      <Shell>
        <section className="py-12 sm:py-16">
          <AuthLoading>
            <LoadingRows rows={4} />
          </AuthLoading>

          <Unauthenticated>
            <div className="mx-auto max-w-lg text-center">
              <Eyebrow>Members only</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-snug text-ink">
                Sign in to read the feed.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-slate-ink">
                This is the association&rsquo;s internal square rather than a public
                noticeboard, so it needs to know who you are. Signing in takes one
                click with Google or LinkedIn.
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
            <FeedBody />
          </Authenticated>
        </section>
      </Shell>
    </>
  );
}
