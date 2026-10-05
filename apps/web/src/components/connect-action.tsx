"use client";

import { api, type Id, Authenticated, Unauthenticated, useMutation } from "@/lib/standalone";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Pill } from "@/components/kit";

/**
 * The Connect control, wherever a member appears.
 *
 * One component for all five states, because they are five states of one thing —
 * a member rendering "Connect" on the directory and "Pending" on the profile page
 * would be the same relationship described twice, and the two descriptions would
 * eventually disagree.
 *
 * NO ADDRESS PASSES THROUGH HERE. The handles are `alumniId` to ask someone new
 * and `connectionId` to act on an existing edge; the server resolves both. See the
 * note at the top of `convex/network.ts` for why that constraint exists — in
 * short, an email is a contact detail and module 2 makes those opt-in.
 *
 * `size="sm"` throughout, because this always sits inside a card's action row
 * rather than being a page's primary call to action.
 */

export type EdgeState =
  | "self"
  | "none"
  | "connected"
  | "outgoing"
  | "incoming"
  | "declined";

function reason(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const named = /Uncaught (?:ConvexError|Error):\s*([^\n]+)/.exec(raw);
  return named?.[1]?.trim() ?? "That did not go through. Try again in a moment.";
}

/** Asks to connect, with the note collapsed behind the button until wanted. */
function AskToConnect({
  alumniId,
  name,
  wasDeclined,
}: {
  alumniId: Id<"alumni">;
  name: string;
  wasDeclined: boolean;
}) {
  const requestConnection = useMutation(api.network.requestConnection);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const firstName = name.trim().split(/\s+/)[0] ?? name;

  async function send() {
    setSending(true);
    try {
      const result = await requestConnection({
        alumniId,
        note: note.trim() ? note.trim() : undefined,
      });
      // A crossing request connects on the spot. Report what happened, not what
      // the button said it would do.
      toast.success(
        result.status === "accepted"
          ? `You and ${firstName} are now connected.`
          : `Request sent to ${firstName}.`,
      );
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
        {wasDeclined ? "Ask again" : "Connect"}
      </Button>
    );
  }

  return (
    <div className="w-full sm:w-72">
      <label
        htmlFor={`connect-note-${alumniId}`}
        className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
      >
        Add a note (optional)
      </label>
      <textarea
        id={`connect-note-${alumniId}`}
        rows={3}
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={`How do you know ${firstName}, or what are you hoping to ask?`}
        className="mt-2 w-full rounded-control border border-line bg-surface px-3 py-2 text-[0.85rem] leading-relaxed text-ink transition-colors placeholder:text-slate-soft focus:border-maroon"
      />
      <div className="mt-2 flex flex-wrap gap-2">
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

/** Opens the thread on an accepted edge and goes to it. */
function MessageAction({ connectionId }: { connectionId: Id<"connections"> }) {
  const router = useRouter();
  const openConversation = useMutation(api.messaging.openConversation);
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        openConversation({ connectionId })
          .then((result) =>
            // typedRoutes cannot express a query string; this is the same escape
            // hatch kit.tsx documents for dynamic hrefs.
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

export default function ConnectAction({
  alumniId,
  name,
  state,
  connectionId,
}: {
  alumniId: Id<"alumni">;
  name: string;
  /** Undefined while `network.edgeStates` is still in flight. */
  state: EdgeState | undefined;
  connectionId?: Id<"connections">;
}) {
  const respond = useMutation(api.network.respondToConnection);
  const withdraw = useMutation(api.network.withdrawConnection);
  const [busy, setBusy] = useState(false);

  const firstName = name.trim().split(/\s+/)[0] ?? name;

  return (
    <>
      {/*
        Signed out, the button is a prompt rather than a dead control. Hiding it
        would leave a visitor with no idea that connecting is what this portal is
        for; disabling it would say "not for you" instead of "sign in".
      */}
      <Unauthenticated>
        <Button size="sm" variant="outline" href="/join">
          Sign in to connect
        </Button>
      </Unauthenticated>

      <Authenticated>
        {state === undefined ? (
          // Reserve the row rather than popping a button in a frame later.
          <Button size="sm" variant="outline" disabled>
            Checking…
          </Button>
        ) : state === "self" ? (
          <Pill>This is you</Pill>
        ) : state === "connected" && connectionId ? (
          <MessageAction connectionId={connectionId} />
        ) : state === "outgoing" && connectionId ? (
          <>
            <Pill tone="brass">Request sent</Pill>
            <Button
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                withdraw({ connectionId })
                  .then(() => toast.success("Request withdrawn."))
                  .catch((error) => toast.error(reason(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Withdraw
            </Button>
          </>
        ) : state === "incoming" && connectionId ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                respond({ connectionId, decision: "accepted" })
                  .then(() =>
                    toast.success(`You and ${firstName} are now connected.`),
                  )
                  .catch((error) => toast.error(reason(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                respond({ connectionId, decision: "declined" })
                  .then(() => toast.success("Request declined."))
                  .catch((error) => toast.error(reason(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Decline
            </Button>
          </>
        ) : (
          <AskToConnect
            alumniId={alumniId}
            name={name}
            wasDeclined={state === "declined"}
          />
        )}
      </Authenticated>
    </>
  );
}
