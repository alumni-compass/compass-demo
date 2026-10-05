"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import type { Id } from "@RIT-ALUMINI/backend/convex/_generated/dataModel";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  Avatar,
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  MutualNote,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
  TabBar,
  VerifiedMark,
} from "@/components/kit";
import FindPeople from "@/components/find-people";
import { DEPARTMENT_NAMES, formatDate, RITAA } from "@/lib/site";

/**
 * Your network — the connection graph, from the member's side.
 *
 * Four lists, and the ordering of the tabs is the point: requests waiting on
 * *you* come before the people you already know, because an unanswered request
 * is the only thing on this page that someone else is blocked on. Suggestions
 * come last — they are a prompt, not an inbox.
 *
 * Everything reads from one `network.myNetwork` subscription, so accepting a
 * request moves it out of Requests and into Connections in the same frame. Split
 * across four queries it would briefly appear in both, and a member watching a
 * count go from 1 to 1 learns nothing about whether their click worked.
 */

type Network = FunctionReturnType<typeof api.network.myNetwork>;
type Suggestions = FunctionReturnType<typeof api.network.suggestions>;
type Member = Network["connections"][number]["member"];
type Tab = "find" | "requests" | "connections" | "sent" | "suggestions";

/** Turns a Convex refusal into the sentence the handler actually wrote. */
function reason(error: unknown) {
  if (error instanceof ConvexError) return String(error.data);
  const raw = error instanceof Error ? error.message : String(error);
  const named = /Uncaught (?:ConvexError|Error):\s*([^\n]+)/.exec(raw);
  return named?.[1]?.trim() ?? "That did not go through. Try again in a moment.";
}

function shortBatch(batch: number | null) {
  if (batch === null || batch === 0) return null;
  return `’${String(batch).slice(2)}`;
}

/**
 * The line under a member's name: department, batch, then where they work.
 *
 * Assembled from whatever is actually present rather than printed with empty
 * slots — a member who has signed in but not filled in a profile has none of it,
 * and three bullet separators around nothing reads as broken.
 */
function MemberMeta({ member }: { member: Member }) {
  const batch = shortBatch(member.batch);
  const academic = [member.department, batch].filter(Boolean).join(" · ");
  const work = [member.designation, member.company]
    .filter((part) => part && part.trim().length > 0)
    .join(" · ");

  return (
    <>
      {academic ? (
        <p className="font-mono mt-1 text-[0.7rem] tabular-nums text-brass-ink">
          {academic}
        </p>
      ) : null}
      {work ? (
        <p className="mt-1.5 text-[0.85rem] leading-snug text-ink">{work}</p>
      ) : null}
      {!member.hasProfile ? (
        <p className="mt-1.5 text-[0.8rem] leading-snug text-slate-ink">
          Has not filled in a directory profile yet.
        </p>
      ) : null}
    </>
  );
}

/**
 * One row in any of the four lists.
 *
 * The same card everywhere, with the actions passed in. A request and a
 * connection are the same person in a different state, so they should not be two
 * different-looking cards — only the buttons change.
 */
function MemberRow({
  member,
  meta,
  note,
  mutuals,
  actions,
}: {
  member: Member;
  meta?: string;
  note?: string | null;
  mutuals?: string[];
  actions: React.ReactNode;
}) {
  return (
    <Card as="li" className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Avatar name={member.name} src={member.avatarUrl} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {member.alumniId ? (
            <Link
              href={`/directory/${member.alumniId}` as never}
              className="font-display text-lg leading-snug text-ink transition-colors hover:text-maroon"
            >
              {member.name}
            </Link>
          ) : (
            <span className="font-display text-lg leading-snug text-ink">
              {member.name}
            </span>
          )}
          {member.verified ? <VerifiedMark /> : null}
          {member.openToMentor ? <Pill tone="jade">Mentors</Pill> : null}
        </div>

        <MemberMeta member={member} />

        {mutuals && mutuals.length > 0 ? (
          <div className="mt-2.5">
            <MutualNote names={mutuals} />
          </div>
        ) : null}

        {note ? (
          <blockquote className="mt-3 rounded-control border-l-2 border-brass bg-bone px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-ink">
            {note}
          </blockquote>
        ) : null}

        {meta ? (
          <p className="font-mono mt-3 text-[0.7rem] tabular-nums text-slate-ink">
            {meta}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
        {actions}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Connect control — a button that opens a note field                  */
/* ------------------------------------------------------------------ */

/**
 * Connect, with an optional note.
 *
 * The note is collapsed behind the button rather than shown next to it, because
 * a note is optional and a visible empty textarea reads as required. Opening it
 * is one click, and the request can still be sent without it.
 */
function ConnectControl({
  alumniId,
  name,
}: {
  alumniId: Id<"alumni">;
  name: string;
}) {
  const requestConnection = useMutation(api.network.requestConnection);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const result = await requestConnection({
        alumniId,
        note: note.trim() ? note.trim() : undefined,
      });
      if (result.status === "accepted") {
        // They had already asked. Say what actually happened.
        toast.success(`You and ${name} are now connected.`);
      } else {
        toast.success(`Request sent to ${name}.`);
      }
      setOpen(false);
      setNote("");
    } catch (error) {
      toast.error(reason(error));
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Connect
      </Button>
    );
  }

  return (
    <div className="w-full sm:w-64">
      <label
        htmlFor={`note-${alumniId}`}
        className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
      >
        Add a note (optional)
      </label>
      <textarea
        id={`note-${alumniId}`}
        rows={3}
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={`How do you know ${name.split(" ")[0]}, or what are you hoping to ask?`}
        className="mt-2 w-full rounded-control border border-line bg-surface px-3 py-2 text-[0.85rem] text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => void send()} disabled={sending}>
          {sending ? "Sending…" : "Send request"}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Opens the thread with a connected member and goes to it. */
function MessageButton({ connectionId }: { connectionId: Id<"connections"> }) {
  const router = useRouter();
  const openConversation = useMutation(api.messaging.openConversation);
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        openConversation({ connectionId })
          .then((result) =>
            // typedRoutes cannot express a query string; the cast is the same
            // escape hatch kit.tsx documents for dynamic hrefs.
            router.push(
              `/messages?c=${result.conversationId}` as Parameters<
                typeof router.push
              >[0],
            ),
          )
          .catch((error) => {
            setBusy(false);
            toast.error(reason(error));
          });
      }}
    >
      {busy ? "Opening…" : "Message"}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* The four lists                                                      */
/* ------------------------------------------------------------------ */

function IncomingList({ rows }: { rows: Network["incoming"] }) {
  const respond = useMutation(api.network.respondToConnection);
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(
    connectionId: Id<"connections">,
    decision: "accepted" | "declined",
    name: string,
  ) {
    setBusy(connectionId);
    try {
      await respond({ connectionId, decision });
      toast.success(
        decision === "accepted"
          ? `You and ${name} are now connected.`
          : `Request from ${name} declined.`,
      );
    } catch (error) {
      toast.error(reason(error));
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Empty
        title="No one is waiting on you."
        hint="Requests from other members land here. Nothing to answer right now."
        action={
          <Button href="/directory" variant="outline">
            Find members
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <MemberRow
          key={row.connectionId}
          member={row.member}
          note={row.note}
          meta={`Asked ${formatDate(row.askedAt)}`}
          actions={
            <>
              <Button
                size="sm"
                disabled={busy === row.connectionId}
                onClick={() =>
                  void answer(row.connectionId, "accepted", row.member.name)
                }
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={busy === row.connectionId}
                onClick={() =>
                  void answer(row.connectionId, "declined", row.member.name)
                }
              >
                Decline
              </Button>
            </>
          }
        />
      ))}
    </ul>
  );
}

function ConnectionsList({ rows }: { rows: Network["connections"] }) {
  const remove = useMutation(api.network.removeConnection);
  const [busy, setBusy] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Empty
        title="You have not connected with anyone yet."
        hint="Start with your own batch — they are the members most likely to recognise your name."
        action={
          <Button href="/directory" variant="outline">
            Open the directory
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <MemberRow
          key={row.connectionId}
          member={row.member}
          meta={`Connected ${formatDate(row.since)}${
            row.theyAsked ? " · they asked" : " · you asked"
          }`}
          actions={
            <>
              <MessageButton connectionId={row.connectionId} />
              <Button
                size="sm"
                variant="quiet"
                disabled={busy === row.connectionId}
                onClick={() => {
                  setBusy(row.connectionId);
                  remove({ connectionId: row.connectionId })
                    .then(() =>
                      toast.success(`Removed ${row.member.name} from your network.`),
                    )
                    .catch((error) => toast.error(reason(error)))
                    .finally(() => setBusy(null));
                }}
              >
                Remove
              </Button>
            </>
          }
        />
      ))}
    </ul>
  );
}

function OutgoingList({ rows }: { rows: Network["outgoing"] }) {
  const withdraw = useMutation(api.network.withdrawConnection);
  const [busy, setBusy] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Empty
        title="No requests are outstanding."
        hint="Requests you send sit here until the other member answers."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <MemberRow
          key={row.connectionId}
          member={row.member}
          note={row.note}
          meta={`Sent ${formatDate(row.askedAt)} · waiting`}
          actions={
            <Button
              size="sm"
              variant="quiet"
              disabled={busy === row.connectionId}
              onClick={() => {
                setBusy(row.connectionId);
                withdraw({ connectionId: row.connectionId })
                  .then(() => toast.success("Request withdrawn."))
                  .catch((error) => toast.error(reason(error)))
                  .finally(() => setBusy(null));
              }}
            >
              Withdraw
            </Button>
          }
        />
      ))}
    </ul>
  );
}

function SuggestionsList({ data }: { data: Suggestions | undefined }) {
  if (data === undefined) return <LoadingRows rows={4} />;

  if (data.needsProfile) {
    return (
      <Empty
        title="Fill in your profile and this fills itself in."
        hint="Suggestions are worked out from your batch, department, employer and region. Without those there is nothing to match you on."
        action={<Button href="/profile">Edit your profile</Button>}
      />
    );
  }

  if (data.rows.length === 0) {
    return (
      <Empty
        title="Nobody new to suggest yet."
        hint="You have already connected with, or asked, everyone the directory can match to your batch, department, employer or region."
        action={
          <Button href="/directory" variant="outline">
            Search the whole directory
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {data.rows.map((row) => (
        <MemberRow
          key={row.member.alumniId}
          member={row.member}
          meta={row.reason}
          actions={
            // Suggestions are drawn from directory rows, so alumniId is always
            // present here — but the type does not know that, so it is checked.
            row.member.alumniId ? (
              <ConnectControl
                alumniId={row.member.alumniId}
                name={row.member.name}
              />
            ) : null
          }
        />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function NetworkPanels() {
  const network = useQuery(api.network.myNetwork);
  const suggestions = useQuery(api.network.suggestions);

  // Requests first when there are any: the tab that opens should be the one with
  // something on it, not always the same one.
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab =
    tab ??
    ((network?.counts.incoming ?? 0) > 0
      ? "requests"
      : (network?.counts.connections ?? 0) > 0
        ? "connections"
        : "find");

  if (network === undefined) {
    return (
      <>
        <div className="grid grid-cols-3 gap-6 border-y border-line bg-surface px-7 py-9">
          {["Connections", "Requests", "Sent"].map((label) => (
            <Stat key={label} value="—" label={label} />
          ))}
        </div>
        <div className="mt-10">
          <LoadingRows rows={4} />
        </div>
      </>
    );
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "find", label: "Find people" },
    { id: "requests", label: "Requests", count: network.counts.incoming },
    { id: "connections", label: "Connections", count: network.counts.connections },
    { id: "sent", label: "Sent", count: network.counts.outgoing },
    { id: "suggestions", label: "Suggestions" },
  ];

  return (
    <>
      <div className="rounded-card border border-line bg-surface shadow-card">
        <div className="grid grid-cols-3 gap-6 p-7 sm:p-9">
          <Stat value={network.counts.connections} label="Connections" />
          <Stat value={network.counts.incoming} label="Waiting on you" />
          <Stat value={network.counts.outgoing} label="Waiting on them" />
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <TabBar
          tabs={tabs}
          active={active}
          onSelect={setTab}
          label="Which part of your network"
        />
        <Button href="/directory" variant="outline" size="sm">
          Full directory
        </Button>
      </div>

      <div className="mt-8">
        {/* Search sits in the same tab strip as the requests, so finding
            somebody and answering the person who found you are one page. */}
        {active === "find" ? <FindPeople /> : null}
        {active === "requests" ? <IncomingList rows={network.incoming} /> : null}
        {active === "connections" ? (
          <ConnectionsList rows={network.connections} />
        ) : null}
        {active === "sent" ? <OutgoingList rows={network.outgoing} /> : null}
        {active === "suggestions" ? (
          <SuggestionsList data={suggestions} />
        ) : null}
      </div>
    </>
  );
}

export default function NetworkPage() {
  const stats = useQuery(api.network.networkStats);

  return (
    <>
      <PageHeader
        module="Your network"
        title="The people who will take your call."
        lede="A directory tells you who exists. This tells you who you can actually reach — the members you are connected to, the requests waiting on you, and the graduates you almost certainly should know."
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="dark">
            {stats?.connections ?? "—"} connections association-wide
          </Pill>
          <Pill tone="dark">{stats?.membersConnected ?? "—"} members connected</Pill>
          {stats?.averageConnections !== null &&
          stats?.averageConnections !== undefined ? (
            <Pill tone="dark">{stats.averageConnections} on average</Pill>
          ) : null}
        </div>
      </PageHeader>

      <Shell>
        <section className="py-14 sm:py-20">
          <AuthLoading>
            <LoadingRows rows={5} />
          </AuthLoading>

          <Unauthenticated>
            <div className="mx-auto max-w-lg text-center">
              <Eyebrow>Members only</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-snug text-ink">
                Sign in to see your network.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-slate-ink">
                Connections are between named, verified members, so this page needs
                to know who you are. Signing in takes one click with Google or
                LinkedIn.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button href="/join">Sign in</Button>
                <Button href="/directory" variant="outline">
                  Browse the directory
                </Button>
              </div>
            </div>
          </Unauthenticated>

          <Authenticated>
            <NetworkPanels />
          </Authenticated>
        </section>
      </Shell>

      {/* ---- What a connection actually gets you ------------------------- */}
      <section className="border-t border-line bg-surface">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="How connecting works here"
            title="Mutual, and nothing happens without both sides"
            lede="The rules are short on purpose, and they are enforced on the server rather than described in the interface."
          />
          <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
            {[
              {
                t: "Both sides agree",
                c: "A request does nothing until the other member accepts it. Either of you can withdraw or remove it later, and removing a connection closes the message thread while leaving the history readable to you both.",
              },
              {
                t: "Messaging follows the connection",
                c: "Accepting opens a direct thread inside the portal. That is deliberately not the same as publishing a phone number — what contact details other members can see stays entirely under your control on your profile.",
              },
              {
                t: "Introductions are named",
                c: `Where a mutual connection exists, ${RITAA.shortName} names them rather than showing you a degree. Knowing that a specific person knows you both is the difference between a cold request and a warm one.`,
              },
            ].map((item) => (
              <div key={item.t} className="bg-surface p-7">
                <h3 className="font-display text-lg leading-snug text-ink">
                  {item.t}
                </h3>
                <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                  {item.c}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-[0.85rem] leading-relaxed text-slate-ink">
            Members are listed by department —{" "}
            {Object.keys(DEPARTMENT_NAMES).join(", ")} — and by graduating batch.
            Both are the fastest way to find someone who will recognise your name.
          </p>
        </Shell>
      </section>
    </>
  );
}
