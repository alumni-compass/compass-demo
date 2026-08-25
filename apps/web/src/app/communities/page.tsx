"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Button,
  Card,
  Empty,
  Eyebrow,
  inputClass,
  labelClass,
  LoadingRows,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
  TabBar,
} from "@/components/kit";
import { BATCH_YEARS, DEPARTMENTS, RITAA } from "@/lib/site";

/**
 * Communities — the list, and the form for starting one.
 *
 * TWO JOIN MODES, MADE OBVIOUS. An open community admits anyone who asks,
 * instantly. An approval community holds the request until its admins accept it.
 * The card says which, before anyone clicks, because the difference decides whether
 * pressing the button gets you in or gets you a wait.
 *
 * Any verified member can create one and becomes its first admin. That admin role
 * is scoped to that community only — it grants nothing anywhere else in the portal,
 * which is what makes it safe to hand out freely.
 */

type Community = FunctionReturnType<
  typeof api.communities.listCommunities
>["rows"][number];
type Tab = "all" | "mine" | "open" | "approval";

function shortBatch(batch: number | null) {
  if (batch === null || batch === 0) return null;
  return `’${String(batch).slice(2)}`;
}

/** The button, chosen from the caller's standing rather than from visibility. */
function JoinControl({ community }: { community: Community }) {
  const requestToJoin = useMutation(api.communities.requestToJoin);
  const [busy, setBusy] = useState(false);

  // An approval community may ask screening questions, which belong on a form and
  // not on a card — so the card sends the member to the community page to answer.
  if (community.visibility === "approval" && community.standing === "guest") {
    return (
      <Button href={`/communities/${community.slug}`} size="sm" variant="outline">
        Request to join
      </Button>
    );
  }

  switch (community.standing) {
    case "admin":
      return <Pill tone="maroon">You run this</Pill>;
    case "moderator":
      return <Pill tone="brass">Moderator</Pill>;
    case "member":
      return (
        <Button href={`/communities/${community.slug}`} size="sm" variant="outline">
          Open
        </Button>
      );
    case "pending":
      return <Pill tone="brass">Request pending</Pill>;
    case "removed":
      return <Pill>Removed</Pill>;
    case "declined":
      return (
        <Button href={`/communities/${community.slug}`} size="sm" variant="quiet">
          Ask again
        </Button>
      );
    default:
      return (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            requestToJoin({ communityId: community._id })
              .then((result) =>
                toast.success(
                  result.alreadyIn
                    ? "You are already a member."
                    : result.status === "active"
                      ? `You have joined ${community.name}.`
                      : "Request sent to the community's admins.",
                ),
              )
              .catch((error) => toast.error(actionErrorMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Joining…" : "Join"}
        </Button>
      );
  }
}

function CommunityCard({ community }: { community: Community }) {
  const scope = [
    community.scopeDepartment,
    shortBatch(community.scopeBatch),
  ].filter(Boolean);

  return (
    <Card as="li" interactive className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl leading-snug text-ink">
            <Link
              href={`/communities/${community.slug}` as never}
              className="transition-colors hover:text-maroon"
            >
              {community.name}
            </Link>
          </h3>
          <p className="font-mono mt-1.5 text-[0.68rem] uppercase tracking-[0.1em] text-brass-ink">
            {community.visibility === "open"
              ? "Anyone can join"
              : "Admins accept members"}
            {scope.length > 0 ? ` · ${scope.join(" · ")}` : ""}
          </p>
        </div>
        <Pill tone={community.visibility === "open" ? "jade" : "brass"}>
          {community.visibility === "open" ? "Open" : "Approval"}
        </Pill>
      </div>

      <p className="mt-3 flex-1 text-[0.9rem] leading-relaxed text-slate-ink">
        {community.tagline}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="font-mono text-[0.7rem] tabular-nums text-slate-ink">
          {community.memberCount}{" "}
          {community.memberCount === 1 ? "member" : "members"} ·{" "}
          {community.postCount} {community.postCount === 1 ? "post" : "posts"}
        </span>
        <JoinControl community={community} />
      </div>

      <p className="font-mono mt-3 text-[0.65rem] text-slate-soft">
        Started by {community.createdByName}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                            */
/* ------------------------------------------------------------------ */

function CreateCommunity() {
  const router = useRouter();
  const createCommunity = useMutation(api.communities.createCommunity);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    description: "",
    visibility: "open" as "open" | "approval",
    scopeBatch: "",
    scopeDepartment: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createCommunity({
        name: form.name,
        tagline: form.tagline,
        description: form.description,
        visibility: form.visibility,
        scopeBatch: form.scopeBatch ? Number(form.scopeBatch) : undefined,
        scopeDepartment: form.scopeDepartment || undefined,
      });
      toast.success(`${form.name} created. You are its first admin.`);
      router.push(`/communities/${result.slug}` as never);
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Start a community</Button>
    );
  }

  return (
    <Card accent className="w-full">
      <form onSubmit={submit} className="pt-4">
        <Eyebrow>Start a community</Eyebrow>
        <h3 className="font-display mt-2 text-xl leading-snug text-ink">
          You will be its first admin
        </h3>
        <p className="mt-2 max-w-2xl text-[0.85rem] leading-relaxed text-slate-ink">
          That role is scoped to this community — it lets you accept members, set
          joining questions and moderate its feed, and nothing else anywhere in the
          portal.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="c-name">
              Name
            </label>
            <input
              id="c-name"
              required
              maxLength={80}
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="CSE 2022–26, or RIT Founders"
              className={`${inputClass} mt-2`}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="c-tagline">
              Tagline
            </label>
            <input
              id="c-tagline"
              required
              maxLength={160}
              value={form.tagline}
              onChange={(event) => set("tagline", event.target.value)}
              placeholder="One line. It is what members read in the list."
              className={`${inputClass} mt-2`}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="c-description">
              What it is for
            </label>
            <textarea
              id="c-description"
              rows={4}
              maxLength={4000}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              placeholder="Who it is for, and what gets posted here."
              className={`${inputClass} mt-2 resize-none`}
            />
          </div>

          {/* The one decision that changes behaviour, so it gets real labels
              rather than a checkbox called "private". */}
          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>Who can join</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    id: "open",
                    title: "Anyone can join",
                    copy: "A verified member who asks is admitted immediately. Best for a batch or department group.",
                  },
                  {
                    id: "approval",
                    title: "Admins accept members",
                    copy: "A request waits until you accept it, and you can set questions for people to answer first.",
                  },
                ] as const
              ).map((choice) => (
                <label
                  key={choice.id}
                  className={`cursor-pointer rounded-card border p-4 transition-colors ${
                    form.visibility === choice.id
                      ? "border-maroon bg-maroon-tint"
                      : "border-line bg-surface hover:border-maroon/40"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="visibility"
                      value={choice.id}
                      checked={form.visibility === choice.id}
                      onChange={() => set("visibility", choice.id)}
                      className="size-4 accent-maroon"
                    />
                    <span className="text-[0.9rem] text-ink">{choice.title}</span>
                  </span>
                  <span className="mt-2 block text-[0.8rem] leading-relaxed text-slate-ink">
                    {choice.copy}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className={labelClass} htmlFor="c-dept">
              Department (optional)
            </label>
            <select
              id="c-dept"
              value={form.scopeDepartment}
              onChange={(event) => set("scopeDepartment", event.target.value)}
              className={`${inputClass} font-mono mt-2 uppercase tracking-[0.08em]`}
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
            <label className={labelClass} htmlFor="c-batch">
              Batch (optional)
            </label>
            <select
              id="c-batch"
              value={form.scopeBatch}
              onChange={(event) => set("scopeBatch", event.target.value)}
              className={`${inputClass} font-mono mt-2 tabular-nums`}
            >
              <option value="">Any</option>
              {[...BATCH_YEARS].reverse().map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap gap-3 border-t border-line pt-5">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create community"}
          </Button>
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                              */
/* ------------------------------------------------------------------ */

function CommunityList() {
  const data = useQuery(api.communities.listCommunities);
  const mine = useQuery(api.communities.myCommunities);
  const moderation = useQuery(api.communities.moderationCount);
  const [tab, setTab] = useState<Tab>("all");

  if (data === undefined) return <LoadingRows rows={4} />;

  const rows = data.rows.filter((community) => {
    if (tab === "mine") {
      return (
        community.standing !== "guest" &&
        community.standing !== "declined" &&
        community.standing !== "removed"
      );
    }
    if (tab === "open") return community.visibility === "open";
    if (tab === "approval") return community.visibility === "approval";
    return true;
  });

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "all", label: "All", count: data.rows.length },
    { id: "mine", label: "Yours", count: mine?.rows.length },
    {
      id: "open",
      label: "Open",
      count: data.rows.filter((c) => c.visibility === "open").length,
    },
    {
      id: "approval",
      label: "Approval",
      count: data.rows.filter((c) => c.visibility === "approval").length,
    },
  ];

  return (
    <>
      {moderation !== undefined && moderation > 0 ? (
        <Card accent className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
            <div>
              <Eyebrow>Waiting on you</Eyebrow>
              <p className="font-display mt-1.5 text-xl text-ink">
                {moderation} join {moderation === 1 ? "request" : "requests"} across
                the communities you run
              </p>
            </div>
            <Button onClick={() => setTab("mine")} size="sm">
              Show mine
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <TabBar
          tabs={tabs}
          active={tab}
          onSelect={setTab}
          label="Filter communities"
        />
        <CreateCommunity />
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <Empty
            title={
              tab === "mine"
                ? "You have not joined a community yet."
                : "No community here yet."
            }
            hint={
              tab === "mine"
                ? "Join one from the All tab, or start your own — a batch group is the usual first one."
                : "Start the first one. A batch or department group is the easiest to fill."
            }
          />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {rows.map((community) => (
              <CommunityCard key={community._id} community={community} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export default function CommunitiesPage() {
  const data = useQuery(api.communities.listCommunities);
  const totals = (data?.rows ?? []).reduce(
    (acc, row) => ({
      members: acc.members + row.memberCount,
      posts: acc.posts + row.postCount,
    }),
    { members: 0, posts: 0 },
  );

  return (
    <>
      <PageHeader
        module="Communities"
        title="Smaller rooms, inside the association."
        lede="A batch, a department, a shared interest — each with its own members and its own feed. Some are open to anyone; others are held until their admins accept you, and can ask you a few questions first."
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="dark">{data?.rows.length ?? "—"} communities</Pill>
          <Pill tone="dark">{totals.members || "—"} memberships</Pill>
          <Pill tone="dark">{totals.posts || "—"} posts</Pill>
        </div>
      </PageHeader>

      <Shell>
        <section className="py-12 sm:py-16">
          <AuthLoading>
            <LoadingRows rows={4} />
          </AuthLoading>

          <Unauthenticated>
            <div className="mx-auto max-w-lg text-center">
              <Eyebrow>Members only</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-snug text-ink">
                Sign in to see the communities.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-slate-ink">
                Communities are made of named, verified members, so this needs to
                know who you are.
              </p>
              <div className="mt-8 flex justify-center">
                <Button href="/join">Sign in</Button>
              </div>
            </div>
          </Unauthenticated>

          <Authenticated>
            <CommunityList />
          </Authenticated>
        </section>
      </Shell>

      {/* ---- How the two modes differ ----------------------------------- */}
      <section className="border-t border-line bg-surface">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="How joining works"
            title="Open, or by approval"
            lede="One field on the community decides it, and the card tells you which before you press anything."
          />
          <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
            <div className="bg-surface p-7">
              <Pill tone="jade">Open</Pill>
              <h3 className="font-display mt-3 text-xl leading-snug text-ink">
                Anyone verified can walk in
              </h3>
              <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                Press Join and you are in, immediately. Right for a batch group or a
                department group, where the membership is obvious and gatekeeping it
                would only create work.
              </p>
            </div>
            <div className="bg-surface p-7">
              <Pill tone="brass">Approval</Pill>
              <h3 className="font-display mt-3 text-xl leading-snug text-ink">
                The admins decide
              </h3>
              <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                Your request waits in a queue. The community&rsquo;s admins can set
                questions — which batch, what you are building, anything they need —
                and they read your answers beside your profile before accepting.
              </p>
            </div>
          </div>
          <p className="mt-8 max-w-3xl text-[0.85rem] leading-relaxed text-slate-ink">
            Either way, posts inside a community are readable only by its active
            members. For something the whole of {RITAA.shortName} should see, use the{" "}
            <Link
              href="/feed"
              className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
            >
              general feed
            </Link>{" "}
            instead.
          </p>
        </Shell>
      </section>
    </>
  );
}
