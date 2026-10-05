"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
 * Admin: the queue of communities members have asked to start.
 *
 * WHY A ROOM NEEDS APPROVING AT ALL. A community carries the association's
 * name and gets a members-only feed nobody outside can see. Reviewing one
 * takes a few seconds; discovering an unreviewed one after it has been used
 * takes considerably longer. So creation files a request, and this is where it
 * is answered.
 *
 * WHAT AN ADMIN ACTUALLY NEEDS TO DECIDE. Not the room in isolation — who is
 * asking. Each row leads with the requester, their batch and department and
 * whether they are verified, because "a verified 2021 CSE graduate wants a
 * placements room for their batch" is the whole decision, and the room's own
 * name is the least of it.
 *
 * REFUSALS KEEP THEIR REASON. Turning one down needs a sentence, enforced on
 * the server, and the refused rooms stay listed underneath so a decision can be
 * reversed without going to the database for the row.
 */
export default function ReviewCommunities() {
  const data = useQuery(api.communities.pendingCommunities);
  const review = useMutation(api.communities.reviewCommunity);

  /** Which row has its refusal box open, and what has been typed into it. */
  const [refusing, setRefusing] = useState<Id<"communities"> | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Id<"communities"> | null>(null);

  if (data === undefined) {
    return (
      <Card>
        <LoadingRows rows={3} />
      </Card>
    );
  }

  if (!data.authorized) {
    return (
      <Card>
        <Eyebrow>Association admins only</Eyebrow>
        <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
          Approving a community is an admin action, and this account does not
          carry that role. Everything else on this page still works.
        </p>
      </Card>
    );
  }

  async function decide(
    communityId: Id<"communities">,
    decision: "approved" | "rejected",
    reason?: string,
  ) {
    setBusy(communityId);
    try {
      const result = await review({ communityId, decision, note: reason });
      toast.success(
        decision === "approved"
          ? `${result.name} is open. Its members can post now.`
          : `${result.name} was turned down, and the member has been given your reason.`,
      );
      setRefusing(null);
      setNote("");
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (data.rows.length === 0) {
    return (
      <Empty
        title="No community requests"
        hint="When a member asks to start a community it appears here, with who asked and what they want it for. Nothing is visible to anybody else until you approve it."
        action={
          <Button href="/communities" variant="outline">
            See the open communities
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={data.counts.pending > 0 ? "brass" : "quiet"}>
          {data.counts.pending} waiting on you
        </Pill>
        {data.counts.rejected > 0 ? (
          <Pill tone="quiet">{data.counts.rejected} turned down</Pill>
        ) : null}
      </div>

      <ul className="space-y-4">
        {data.rows.map((row) => {
          const pending = row.state === "pending";
          const working = busy === row._id;

          return (
            <Card as="li" key={row._id} className="space-y-5">
              {/* ---- Who is asking ------------------------------------ */}
              <div className="flex flex-wrap items-start gap-4">
                <Avatar
                  name={row.creator.name}
                  src={row.creator.avatarUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display text-[1.05rem] text-ink">
                      {row.creator.name}
                    </span>
                    {row.creator.verified ? <VerifiedMark /> : null}
                  </div>
                  <p className="mt-0.5 text-[0.85rem] leading-snug text-slate-ink">
                    {[
                      row.creator.batch ? `Batch of ${row.creator.batch}` : null,
                      row.creator.department,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No profile details yet"}
                  </p>
                  <p className="font-mono mt-1 break-words text-[0.78rem] text-slate-soft">
                    {row.creator.email}
                  </p>
                </div>
                <Pill tone={pending ? "brass" : "quiet"}>
                  {pending ? "Waiting" : "Turned down"}
                </Pill>
              </div>

              {/* ---- What they want to start -------------------------- */}
              <div className="border-l-2 border-brass bg-bone px-4 py-3.5">
                <p className="font-display text-[1.05rem] text-ink">{row.name}</p>
                <p className="mt-1 text-[0.9rem] leading-relaxed text-slate-ink">
                  {row.tagline}
                </p>
                {row.description ? (
                  <p className="mt-2.5 text-[0.85rem] leading-relaxed text-slate-ink">
                    {row.description}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill tone="quiet">
                    {row.visibility === "open" ? "Anyone may join" : "Admins admit"}
                  </Pill>
                  {row.scopeBatch ? (
                    <Pill tone="quiet">{row.scopeBatch} batch</Pill>
                  ) : null}
                  {row.scopeDepartment ? (
                    <Pill tone="quiet">{row.scopeDepartment}</Pill>
                  ) : null}
                  <Pill tone="quiet">/communities/{row.slug}</Pill>
                </div>
              </div>

              {row.reviewNote ? (
                <p className="text-[0.85rem] leading-relaxed text-slate-ink">
                  <span className="text-ink">Your reason:</span> {row.reviewNote}
                </p>
              ) : null}

              {/* ---- The decision ------------------------------------- */}
              {refusing === row._id ? (
                <div className="space-y-2.5">
                  <label
                    htmlFor={`why-${row._id}`}
                    className="block text-[0.85rem] text-ink"
                  >
                    Why not? The member reads this.
                  </label>
                  <input
                    id={`why-${row._id}`}
                    className={inputClass}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="There is already a placements room for this batch."
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-2.5">
                    <Button
                      size="sm"
                      onClick={() => void decide(row._id, "rejected", note)}
                      disabled={working || note.trim().length === 0}
                    >
                      {working ? "Sending…" : "Turn it down"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRefusing(null);
                        setNote("");
                      }}
                      disabled={working}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    size="sm"
                    onClick={() => void decide(row._id, "approved")}
                    disabled={working}
                  >
                    {working ? "Opening…" : pending ? "Approve" : "Approve after all"}
                  </Button>
                  {pending ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRefusing(row._id);
                        setNote("");
                      }}
                      disabled={working}
                    >
                      Turn down
                    </Button>
                  ) : null}
                </div>
              )}
            </Card>
          );
        })}
      </ul>
    </div>
  );
}
