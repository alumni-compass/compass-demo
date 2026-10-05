"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Button,
  Eyebrow,
  Pill,
} from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import {
  type ProviderId,
  GoogleMark,
  LinkedInMark,
} from "@/components/sign-in-card";
import { RITAA } from "@/lib/site";

/**
 * Connected accounts — Google and LinkedIn on one member.
 *
 * WHY BOTH. A member who arrived through Google has an address the directory
 * can trust and nothing else; LinkedIn is where the employer and the job title
 * already live. A member who arrived through LinkedIn has the professional half
 * and a work address that will stop working the day they change jobs. Neither
 * on its own is the whole picture, so a profile is not finished until both are
 * attached — and once they are, either button signs the same member back in.
 *
 * WHAT LINKING IS NOT. It is not a second password and not a second identity.
 * The address this portal keys a profile on is the one it was created with, and
 * better-auth leaves it untouched when an account is linked — so connecting
 * LinkedIn to a Gmail-created account does not move the profile, split it, or
 * change who owns it. See the note in `convex/auth.ts`.
 *
 * WHY THE ACCOUNT LIST IS NOT A CONVEX QUERY. Linked accounts live in the
 * better-auth component's own tables, and the Convex client for that component
 * exposes no read for them. `authClient.listAccounts()` is the supported path,
 * so this holds the result in state and refetches after a change instead of
 * getting a reactive subscription for free. That is also why the list is
 * refetched on mount rather than trusted from a previous render: coming back
 * from a provider redirect is a fresh mount.
 *
 * ONLY CONFIGURED PROVIDERS ARE OFFERED. A "Connect LinkedIn" button on a
 * deployment with no LinkedIn credentials is a button that fails on click, and
 * this portal does not ship those — the same rule the sign-in screen follows.
 */

type LinkedAccount = {
  providerId: string;
  accountId: string;
  createdAt: string | Date;
};

const PROVIDERS: Array<{
  id: ProviderId;
  name: string;
  Mark: (props: { className?: string }) => React.ReactElement;
  brings: string;
}> = [
  {
    id: "google",
    name: "Google",
    Mark: GoogleMark,
    brings: "A confirmed personal address that outlasts any employer.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    Mark: LinkedInMark,
    brings: "Your employer and designation, already kept up to date.",
  },
];

export default function ConnectedAccounts({
  callbackURL = "/welcome",
}: {
  callbackURL?: string;
}) {
  const methods = useQuery(api.auth.configuredAuthMethods);
  const [accounts, setAccounts] = useState<LinkedAccount[] | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await authClient.listAccounts();
      if (result?.error) {
        setAccounts([]);
        return;
      }
      setAccounts((result?.data ?? []) as LinkedAccount[]);
    } catch {
      // Nothing actionable for the member here: the panel shows what it knows
      // and the Connect buttons still work.
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const linkedIds = new Set((accounts ?? []).map((row) => row.providerId));
  const linkedCount = linkedIds.size;

  async function connect(provider: ProviderId) {
    setBusy(provider);
    try {
      const result = await authClient.linkSocial({ provider, callbackURL });
      if (result?.error) {
        setBusy(null);
        toast.error(
          result.error.message ||
            `${provider === "google" ? "Google" : "LinkedIn"} refused the connection. If that account is already attached to another RITAA profile, write to ${RITAA.email}.`,
        );
      }
      // On success the call navigates to the provider, so `busy` stays set
      // until the page unloads — the same reason sign-in does not clear it.
    } catch (error) {
      setBusy(null);
      toast.error(actionErrorMessage(error));
    }
  }

  async function disconnect(provider: ProviderId) {
    setBusy(provider);
    try {
      const result = await authClient.unlinkAccount({ providerId: provider });
      if (result?.error) {
        toast.error(result.error.message || "Could not disconnect that account.");
      } else {
        toast.success(
          `${provider === "google" ? "Google" : "LinkedIn"} disconnected.`,
        );
      }
      await load();
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const loading = accounts === undefined || methods === undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Connected accounts</Eyebrow>
        {loading ? null : linkedCount >= 2 ? (
          <Pill tone="jade">Both connected</Pill>
        ) : (
          <Pill tone="brass">{linkedCount} of 2 connected</Pill>
        )}
      </div>

      <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
        Connect both and either button signs you in. Google keeps a personal
        address on your record that survives a job change; LinkedIn carries the
        employer and designation the directory asks for. Your profile stays
        attached to the address you first joined with either way.
      </p>

      <div className="mt-4 space-y-3">
        {PROVIDERS.map(({ id, name, Mark, brings }) => {
          const configured = methods?.[id] === true;
          const linked = linkedIds.has(id);
          const isBusy = busy === id;
          /* Better-auth refuses to unlink the last account, so the control is
             withheld rather than offered and then refused. */
          const canDisconnect = linked && linkedCount > 1;

          return (
            <div
              key={id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-3.5"
            >
              <Mark className="size-5 shrink-0" />
              <div className="min-w-40 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9rem] text-ink">{name}</span>
                  {loading ? null : linked ? (
                    <Pill tone="jade">Connected</Pill>
                  ) : configured ? (
                    <Pill tone="quiet">Not connected</Pill>
                  ) : (
                    <Pill tone="quiet">Unavailable</Pill>
                  )}
                </div>
                <p className="mt-0.5 text-[0.78rem] leading-snug text-slate-ink">
                  {configured
                    ? brings
                    : `The association has not added ${name} credentials to this deployment yet.`}
                </p>
              </div>

              {loading ? null : linked ? (
                canDisconnect ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => void disconnect(id)}
                  >
                    {isBusy ? "Working…" : "Disconnect"}
                  </Button>
                ) : (
                  <span
                    className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-slate-soft"
                    title="This is the only account attached, so disconnecting it would lock you out."
                  >
                    Only account
                  </span>
                )
              ) : (
                <Button
                  size="sm"
                  variant={configured ? "solid" : "quiet"}
                  disabled={!configured || isBusy}
                  onClick={configured ? () => void connect(id) : undefined}
                >
                  {isBusy ? "Redirecting…" : `Connect ${name}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {!loading && linkedCount < 2 ? (
        <p className="mt-3 text-[0.8rem] leading-relaxed text-slate-ink">
          Connecting the second one opens the provider you have not used yet and
          brings you straight back here. The two accounts do not have to carry
          the same email address — a personal Google address and a work LinkedIn
          are the normal case, and both end up on this one profile.
        </p>
      ) : null}
    </div>
  );
}
