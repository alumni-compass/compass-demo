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
} from "@/components/kit";
import { formatDate } from "@/lib/site";

/**
 * Admin: the general feed, as a moderation queue.
 *
 * WHAT THIS FIXED. `feed.setPostHidden` used to refuse every general-feed post
 * with "General-feed posts have no community moderator" — which was true, and
 * meant the one feed every member reads had no moderator at all. A portal admin
 * is now that moderator, because the general feed is the association's own
 * square. A community's feed still belongs to its own moderators; the server
 * refuses a portal admin there deliberately.
 *
 * HIDE, NEVER DELETE. A hidden post stays readable to its author and to admins,
 * so the decision can be argued with and reversed — which matters most for
 * exactly the posts somebody felt strongly enough to hide. There is no delete
 * button here and no admin delete behind it. An admin who truly needs a row
 * gone can do it from the CLI, where it is a deliberate act rather than a
 * mis-click next to "Hide".
 *
 * A REASON IS OPTIONAL BUT ASKED FOR. It is shown on the card to the author, so
 * the person whose post disappeared is told why rather than left guessing.
 */
export default function ModeratePosts() {
  const data = useQuery(api.adminOps.postsForModeration);
  const setPostHidden = useMutation(api.feed.setPostHidden);

  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  if (data === undefined) {
    return (
      <Card>
        <LoadingRows rows={4} />
      </Card>
    );
  }

  if (!data.authorized) {
    return (
      <Card>
        <Eyebrow>Admins only</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-slate-ink">
          The feed is moderated by portal admins. Sign in with an admin account
          to see it — the query returns nothing without that role, so an empty
          list here is not an empty feed.
        </p>
      </Card>
    );
  }

  function hide(postId: Id<"posts">, hidden: boolean) {
    const key = String(postId);
    setBusy(key);
    setPostHidden({
      postId,
      hidden,
      reason: hidden ? reasons[key] || undefined : undefined,
    })
      .then(() => {
        setReasons((prev) => ({ ...prev, [key]: "" }));
        toast.success(hidden ? "Post hidden from the feed." : "Post restored.");
      })
      .catch((error) => toast.error(actionErrorMessage(error)))
      .finally(() => setBusy(null));
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Moderate the feed</Eyebrow>
        <div className="flex items-center gap-2">
          {data.counts.hidden > 0 ? (
            <Pill tone="maroon">{data.counts.hidden} hidden</Pill>
          ) : null}
          <Pill tone="quiet">{data.counts.total} recent posts</Pill>
        </div>
      </div>

      <p className="mt-2 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
        The association-wide feed only. A hidden post stays readable to its
        author and to you, so this is reversible — which is why there is no
        delete here. Hidden posts are listed first.
      </p>

      {data.rows.length === 0 ? (
        <div className="mt-5">
          <Empty
            title="Nothing posted yet"
            hint="Posts to the association-wide feed appear here as they are written, newest first, with the hidden ones on top."
          />
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-line">
          {data.rows.map((row) => {
            const key = String(row.postId);
            return (
              <li key={key} className="py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={row.authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9rem] text-ink">
                        {row.authorName}
                      </span>
                      {row.hidden ? <Pill tone="maroon">Hidden</Pill> : null}
                      {row.kind === "poll" ? <Pill tone="quiet">Poll</Pill> : null}
                      {row.isShare ? <Pill tone="quiet">Share</Pill> : null}
                      {row.hasMedia ? <Pill tone="quiet">Media</Pill> : null}
                    </div>
                    <p className="font-mono truncate text-[0.68rem] text-slate-soft">
                      {row.authorEmail} · {formatDate(row.createdAt)} ·{" "}
                      {row.likeCount} likes · {row.commentCount} comments
                    </p>

                    <p className="mt-1.5 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">
                      {row.body || (
                        <span className="text-slate-soft">
                          (no text — media or a share)
                        </span>
                      )}
                    </p>

                    {row.hidden && row.hiddenReason ? (
                      <p className="font-mono mt-1.5 text-[0.7rem] uppercase tracking-[0.1em] text-maroon">
                        Reason given: {row.hiddenReason}
                      </p>
                    ) : null}

                    {!row.hidden ? (
                      <input
                        className={`${inputClass} mt-2`}
                        value={reasons[key] ?? ""}
                        placeholder="Reason, shown to the author — optional"
                        onChange={(event) =>
                          setReasons((prev) => ({
                            ...prev,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    ) : null}
                  </div>

                  <div className="shrink-0">
                    <Button
                      size="sm"
                      variant={row.hidden ? "outline" : "ghost"}
                      disabled={busy === key}
                      onClick={() => hide(row.postId, !row.hidden)}
                    >
                      {busy === key
                        ? "Saving…"
                        : row.hidden
                          ? "Restore"
                          : "Hide"}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
