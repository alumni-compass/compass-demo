"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Avatar,
  Button,
  Card,
  Empty,
  Eyebrow,
  inputClass,
  LoadingRows,
  Pill,
  VerifiedMark,
} from "@/components/kit";

/**
 * Admin: verify a member, or take it back.
 *
 * WHY IT IS A LIST OF MEMBERS AND NOT A QUEUE. The queue answers requests, and
 * the form that filed them was removed from `/join` — so a queue here would be
 * permanently empty while every real member sat unverified with no way to
 * change it. This works from the directory instead: search a name, see the
 * flag, change it.
 *
 * IT IS A REAL BUTTON, not a copyable command. Every privileged write in this
 * console is a shell line the admin runs themselves, because `/admin` has no
 * access gate and a public mutation would have let any visitor verify
 * themselves. `access.setVerified` is the first one promoted, and only because
 * the condition for promoting it now holds: it calls `requireRole(["admin"])`,
 * the caller's address comes from the session token rather than the request,
 * and the admin role is granted only by `access.setRole`, which is still
 * internal and CLI-only. A visitor pressing this gets a refusal from the
 * server, not a verified badge.
 *
 * UNVERIFIED FIRST, because that is what an admin came here to act on. The
 * counts are printed whole, so the hundred-row cap is visible rather than
 * silently standing in for the whole association.
 */
export default function VerifyMembers() {
  const [text, setText] = useState("");
  const data = useQuery(api.adminOps.membersForVerification, {
    text: text.trim() || undefined,
  });
  const setVerified = useMutation(api.access.setVerified);
  const [busy, setBusy] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <Card>
        <LoadingRows rows={5} />
      </Card>
    );
  }

  if (!data.authorized) {
    return (
      <Card>
        <Eyebrow>Admins only</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-slate-ink">
          Verification is granted by portal admins. Sign in with an admin
          account to change it — the query behind this panel returns nothing
          without that role, so an empty list here is not an empty association.
        </p>
      </Card>
    );
  }

  function toggle(email: string, next: boolean, name: string) {
    setBusy(email);
    setVerified({ email, verified: next })
      .then(() =>
        toast.success(next ? `${name} is now verified.` : `${name} is no longer verified.`),
      )
      .catch((error) => toast.error(actionErrorMessage(error)))
      .finally(() => setBusy(null));
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Verify members</Eyebrow>
        <div className="flex items-center gap-2">
          <Pill tone="jade">{data.counts.verified} verified</Pill>
          <Pill tone="quiet">{data.counts.total} on record</Pill>
        </div>
      </div>

      <p className="mt-2 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
        The tick beside a member&rsquo;s name across the portal is this flag.
        Check their batch and roll number against college records first — this
        button is the record of that decision, not the decision itself.
      </p>

      <div className="mt-4">
        <input
          className={inputClass}
          value={text}
          placeholder="Search by name, email, batch or programme"
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {data.rows.length === 0 ? (
        <div className="mt-5">
          <Empty
            title={text ? "Nobody matches that" : "No member records yet"}
            hint={
              text
                ? "Try a shorter search. Only members who have filled in their details appear here — verification is granted against their own record."
                : "As members complete the details form they appear here, unverified, waiting to be checked against college records."
            }
          />
        </div>
      ) : (
        <>
          <ul className="mt-5 divide-y divide-line">
            {data.rows.map((row) => (
              <li
                key={String(row.alumniId)}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <Avatar name={row.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.95rem] text-ink">{row.name}</span>
                    {row.verified ? (
                      <VerifiedMark />
                    ) : (
                      <Pill tone="brass">Not verified</Pill>
                    )}
                  </div>
                  <p className="font-mono truncate text-[0.7rem] text-slate-ink">
                    {row.email}
                  </p>
                  <p className="text-[0.78rem] leading-snug text-slate-ink">
                    Batch of {row.batch} · {row.department}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={row.verified ? "ghost" : "solid"}
                  disabled={busy === row.email}
                  onClick={() => toggle(row.email, !row.verified, row.name)}
                >
                  {busy === row.email
                    ? "Saving…"
                    : row.verified
                      ? "Remove verification"
                      : "Verify"}
                </Button>
              </li>
            ))}
          </ul>

          {data.counts.shown < data.counts.total ? (
            <p className="font-mono mt-4 text-[0.7rem] uppercase tracking-[0.1em] text-slate-ink">
              Showing {data.counts.shown} of {data.counts.total} — search to
              narrow it
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
