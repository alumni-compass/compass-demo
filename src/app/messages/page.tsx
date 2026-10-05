"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Avatar,
  Button,
  Empty,
  Eyebrow,
  LoadingRows,
  PageHeader,
  Pill,
  Shell,
  VerifiedMark,
} from "@/components/kit";

/**
 * Messages — direct conversations between connected members.
 *
 * Two panes on desktop, one at a time on mobile: the inbox is the page until a
 * thread is chosen, and the thread is the page once one is. A cramped two-column
 * layout on a phone would make both halves unusable, and this is the surface most
 * likely to be read on a phone.
 *
 * The open thread lives in `?c=<id>` rather than in component state, so a
 * conversation is a linkable address. `/network` sends members straight here
 * after opening a thread, and a member can bookmark or share the URL of a
 * conversation with a colleague.
 *
 * The composer closes when the connection does. `messaging.sendMessage` re-checks
 * the edge on every send, so this is not a cosmetic disable — the page just says
 * what the server will do rather than letting someone type into a channel that
 * will refuse them.
 */

type Inbox = FunctionReturnType<typeof api.messaging.myConversations>;
type Thread = FunctionReturnType<typeof api.messaging.conversation>;

function reason(error: unknown) {
  if (error instanceof ConvexError) return String(error.data);
  const raw = error instanceof Error ? error.message : String(error);
  const named = /Uncaught (?:ConvexError|Error):\s*([^\n]+)/.exec(raw);
  return named?.[1]?.trim() ?? "That message did not send. Try again in a moment.";
}

/** Relative for today, clock for this week, date beyond that. */
function messageTime(ts: number) {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const days = (now.getTime() - ts) / 86_400_000;
  if (days < 7) {
    return date.toLocaleDateString("en-IN", { weekday: "short" });
  }
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function fullTime(ts: number) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortBatch(batch: number | null) {
  if (batch === null || batch === 0) return null;
  return `’${String(batch).slice(2)}`;
}

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

function InboxList({
  rows,
  activeId,
  onSelect,
}: {
  rows: Inbox["rows"];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-5">
        <Empty
          title="No conversations yet."
          hint="Messaging opens with a member once you are connected. Accept a request, or send one."
          action={
            <Button href="/network" variant="outline">
              Your network
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => {
        const active = row.conversationId === activeId;
        const batch = shortBatch(row.counterpart.batch);
        return (
          <li key={row.conversationId}>
            <button
              type="button"
              onClick={() => onSelect(row.conversationId)}
              aria-current={active ? "true" : undefined}
              className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors ${
                active ? "bg-maroon-tint" : "hover:bg-bone"
              }`}
            >
              <Avatar
                name={row.counterpart.name}
                src={row.counterpart.avatarUrl}
                size="md"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[0.925rem] text-ink">
                    {row.counterpart.name}
                  </span>
                  <span className="font-mono shrink-0 text-[0.65rem] tabular-nums text-slate-ink">
                    {messageTime(row.lastMessageAt)}
                  </span>
                </span>

                {row.counterpart.department || batch ? (
                  <span className="font-mono mt-0.5 block text-[0.65rem] tabular-nums text-brass-ink">
                    {[row.counterpart.department, batch]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}

                <span className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[0.8rem] text-slate-ink">
                    {row.lastMessagePreview
                      ? `${row.lastFromMe ? "You: " : ""}${row.lastMessagePreview}`
                      : "No messages yet — say hello."}
                  </span>
                  {row.unread > 0 ? (
                    <span className="count-badge shrink-0">
                      {row.unread > 9 ? "9+" : row.unread}
                    </span>
                  ) : null}
                </span>

                {!row.stillConnected ? (
                  <span className="font-mono mt-1.5 block text-[0.65rem] uppercase tracking-[0.1em] text-slate-soft">
                    Connection removed
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Thread                                                              */
/* ------------------------------------------------------------------ */

function Composer({
  conversationId,
  counterpartName,
  closed,
}: {
  conversationId: Id<"conversations">;
  counterpartName: string;
  closed: boolean;
}) {
  const sendMessage = useMutation(api.messaging.sendMessage);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (text.length === 0) return;

    setSending(true);
    try {
      await sendMessage({ conversationId, body: text });
      setBody("");
    } catch (error) {
      toast.error(reason(error));
    } finally {
      setSending(false);
    }
  }

  if (closed) {
    return (
      <div className="border-t border-line bg-bone px-6 py-5 sm:px-7">
        <p className="text-[0.85rem] leading-relaxed text-slate-ink">
          You are no longer connected to {counterpartName}, so this conversation is
          closed. Everything already said stays here.{" "}
          <Link
            href={"/network" as never}
            className="text-maroon underline decoration-brass/50 underline-offset-4"
          >
            Send a new request
          </Link>{" "}
          to reopen it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface p-4">
      <label htmlFor="composer" className="sr-only">
        Message {counterpartName}
      </label>
      <textarea
        id="composer"
        rows={3}
        maxLength={4000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter breaks the line — the convention every
          // messaging surface these members already use.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit(event);
          }
        }}
        placeholder={`Message ${counterpartName.split(" ")[0]}…`}
        className="w-full resize-none rounded-control border border-line bg-surface px-3.5 py-2.5 text-[0.9rem] leading-relaxed text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
      />
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="font-mono text-[0.65rem] tabular-nums text-slate-soft">
          Enter sends · Shift + Enter for a new line
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={sending || body.trim().length === 0}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function ThreadPane({
  conversationId,
  onBack,
}: {
  conversationId: Id<"conversations">;
  onBack: () => void;
}) {
  const thread = useQuery(api.messaging.conversation, { conversationId });
  const markRead = useMutation(api.messaging.markRead);
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  // Mark the other side's messages read once the thread is on screen. Keyed on
  // the id so switching threads marks the new one, not the old one again.
  useEffect(() => {
    void markRead({ conversationId }).catch(() => {
      // A failed read receipt is not worth a toast — the messages are readable
      // either way, and the mutation retries on the next open.
    });
  }, [conversationId, markRead]);

  // Stick to the newest message as it arrives, without yanking the view while
  // someone is reading back through history.
  useEffect(() => {
    const count = thread?.messages.length ?? 0;
    if (count !== lastCount.current) {
      lastCount.current = count;
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }
  }, [thread?.messages.length]);

  if (thread === undefined) {
    return (
      <div className="p-6">
        <LoadingRows rows={4} />
      </div>
    );
  }

  const batch = shortBatch(thread.counterpart.batch);
  const work = [thread.counterpart.designation, thread.counterpart.company]
    .filter((part) => part && part.trim().length > 0)
    .join(" · ");

  return (
    <div className="flex h-full flex-col">
      {/* ---- Thread header ------------------------------------------------ */}
      <header className="flex items-start gap-3.5 border-b border-line bg-surface px-6 py-5 sm:px-7">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-control border border-line text-ink transition-colors hover:border-maroon lg:hidden"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4 stroke-current"
            strokeWidth="1.5"
            fill="none"
            aria-hidden
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>

        <Avatar
          name={thread.counterpart.name}
          src={thread.counterpart.avatarUrl}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {thread.counterpart.alumniId ? (
              <Link
                href={`/directory/${thread.counterpart.alumniId}` as never}
                className="font-display text-lg leading-snug text-ink transition-colors hover:text-maroon"
              >
                {thread.counterpart.name}
              </Link>
            ) : (
              <span className="font-display text-lg leading-snug text-ink">
                {thread.counterpart.name}
              </span>
            )}
            {thread.counterpart.verified ? <VerifiedMark /> : null}
          </div>
          {thread.counterpart.department || batch ? (
            <p className="font-mono mt-0.5 text-[0.68rem] tabular-nums text-brass-ink">
              {[thread.counterpart.department, batch].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {work ? (
            <p className="mt-1 truncate text-[0.82rem] text-slate-ink">{work}</p>
          ) : null}
        </div>
      </header>

      {/* ---- Messages ---------------------------------------------------- */}
      <div
        ref={scroller}
        className="min-h-[22rem] flex-1 space-y-4 overflow-y-auto bg-bone px-6 py-8 sm:px-7"
      >
        {thread.truncated ? (
          <p className="font-mono text-center text-[0.65rem] uppercase tracking-[0.12em] text-slate-soft">
            Showing the most recent messages
          </p>
        ) : null}

        {thread.messages.length === 0 ? (
          <p className="py-8 text-center text-[0.9rem] leading-relaxed text-slate-ink">
            You are connected. Nothing has been said yet — open with what you are
            hoping to ask.
          </p>
        ) : null}

        {thread.messages.map((message) => (
          <div
            key={message._id}
            className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[85%] sm:max-w-[70%]">
              <div
                className={`rounded-card px-4 py-2.5 text-[0.9rem] leading-relaxed whitespace-pre-wrap ${
                  message.fromMe
                    ? "bg-maroon text-bone"
                    : "border border-line bg-surface text-ink shadow-card"
                }`}
              >
                {message.body}
              </div>
              <p
                className={`font-mono mt-1 text-[0.62rem] tabular-nums text-slate-soft ${
                  message.fromMe ? "text-right" : ""
                }`}
                title={fullTime(message.createdAt)}
              >
                {messageTime(message.createdAt)}
                {message.fromMe && message.readAt ? " · read" : ""}
              </p>
            </div>
          </div>
        ))}
      </div>

      <Composer
        conversationId={conversationId}
        counterpartName={thread.counterpart.name}
        closed={!thread.stillConnected}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function MessagesPanels() {
  const router = useRouter();
  const params = useSearchParams();
  const inbox = useQuery(api.messaging.myConversations);

  /*
   * The open thread comes from the URL, so it is untrusted text. It is only ever
   * handed to `messaging.conversation`, which loads the row and refuses unless the
   * session is one of its two participants — a fabricated id reads nothing.
   */
  const activeId = (params.get("c") ?? null) as Id<"conversations"> | null;

  type Push = Parameters<typeof router.replace>[0];

  function select(id: string) {
    router.replace(`/messages?c=${id}` as Push);
  }

  if (inbox === undefined) return <LoadingRows rows={5} />;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="grid lg:grid-cols-[20rem_1fr]">
        {/* ---- Inbox ---------------------------------------------------- */}
        <div
          className={`border-line lg:border-r ${
            activeId ? "hidden lg:block" : "block"
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
            <Eyebrow>Conversations</Eyebrow>
            {inbox.totalUnread > 0 ? (
              <Pill tone="maroon">{inbox.totalUnread} unread</Pill>
            ) : null}
          </div>
          <div className="max-h-[34rem] overflow-y-auto">
            <InboxList
              rows={inbox.rows}
              activeId={activeId}
              onSelect={select}
            />
          </div>
        </div>

        {/* ---- Thread --------------------------------------------------- */}
        <div className={activeId ? "block" : "hidden lg:block"}>
          {activeId ? (
            <ThreadPane
              conversationId={activeId}
              onBack={() => router.replace("/messages" as Push)}
            />
          ) : (
            <div className="flex h-full min-h-[24rem] items-center justify-center p-8">
              <div className="max-w-sm text-center">
                <Eyebrow>Nothing open</Eyebrow>
                <p className="font-display mt-3 text-xl leading-snug text-ink">
                  Pick a conversation.
                </p>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
                  {inbox.rows.length === 0
                    ? "You have no threads yet. Connect with a member and messaging opens."
                    : "Choose someone on the left to read and reply."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <>
      <PageHeader
        module="Messages"
        title="Talk to the members who accepted."
        lede="Direct conversations inside the portal, open with anyone you are connected to. No phone number changes hands — what contact details other members can see stays entirely yours to set."
      />

      <Shell>
        <section className="py-14 sm:py-20">
          <AuthLoading>
            <LoadingRows rows={5} />
          </AuthLoading>

          <Unauthenticated>
            <div className="mx-auto max-w-lg text-center">
              <Eyebrow>Members only</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-snug text-ink">
                Sign in to read your messages.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-slate-ink">
                Threads are private to the two members in them, so this page needs
                to know who you are.
              </p>
              <div className="mt-8 flex justify-center">
                <Button href="/join">Sign in</Button>
              </div>
            </div>
          </Unauthenticated>

          <Authenticated>
            {/* useSearchParams needs a Suspense boundary during prerender. */}
            <Suspense fallback={<LoadingRows rows={5} />}>
              <MessagesPanels />
            </Suspense>
          </Authenticated>
        </section>
      </Shell>
    </>
  );
}
