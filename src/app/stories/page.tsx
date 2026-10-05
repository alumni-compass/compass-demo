"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";

import {
  Button,
  Empty,
  Eyebrow,
  LoadingRows,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import { formatDate, RITAA } from "@/lib/site";

/**
 * Module 6 — news, success stories, achievements, event recaps and the entry to
 * the newsletter archive. One list query, filtered by category on the server.
 *
 * The newsletter archive itself lives at /newsletters: back issues want year
 * grouping and issue numbering, which a story grid cannot carry. This page
 * keeps the Newsletters filter (an issue is still a published piece) and hands
 * off to the archive for the full run.
 */

type StoryRow = FunctionReturnType<typeof api.stories.list>[number];
type Category = StoryRow["category"];
type Filter = "all" | Category;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "success", label: "Success stories" },
  { id: "achievement", label: "Achievements" },
  { id: "recap", label: "Event recaps" },
  { id: "newsletter", label: "Newsletters" },
];

const CATEGORY_LABEL: Record<Category, string> = {
  success: "Success story",
  achievement: "Achievement",
  recap: "Event recap",
  newsletter: "Newsletter",
};

const CATEGORY_TONE: Record<Category, "quiet" | "brass" | "jade" | "maroon"> = {
  success: "jade",
  achievement: "brass",
  recap: "quiet",
  newsletter: "maroon",
};

const EMPTY_COPY: Record<Filter, { title: string; hint: string }> = {
  all: {
    title: "Nothing is published yet",
    hint: "Stories are written by the editorial volunteers. Send yours to the association and it goes into the queue.",
  },
  success: {
    title: "No success stories yet",
    hint: "If you know an alumnus whose path is worth writing up, tell the association — most stories here started as a nomination.",
  },
  achievement: {
    title: "No achievements posted yet",
    hint: "Association milestones — endowment targets, RACE numbers, league results — are recorded here as they land.",
  },
  recap: {
    title: "No event recaps yet",
    hint: "Recaps are published within a fortnight of each event, alongside the photographs in the gallery.",
  },
  newsletter: {
    title: "The newsletter archive is empty",
    hint: "Issues are published quarterly. Write to the association to be added to the mailing list.",
  },
};

const actionClass =
  "font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors";

/**
 * `next.config.ts` sets `typedRoutes: true`, and Link's route union comes from
 * types Next regenerates on dev/build. /newsletters is a real route in this
 * directory, so the cast at the Link boundary — the same escape hatch kit.tsx
 * documents for dynamic hrefs — is what keeps it checking before that runs.
 */
const NEWSLETTERS: ComponentProps<typeof Link>["href"] =
  "/newsletters" as ComponentProps<typeof Link>["href"];

function isHttpUrl(value: string | undefined | null): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

/** A URL ending in a file is a real download; a landing page is not. */
function isDirectFile(url: string) {
  return /\.(pdf|epub|zip|docx?)(?:[?#]|$)/i.test(url);
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The issue file action, labelled for what the stored URL actually is. Today's
 * `downloadUrl` is the association's newsletter page, so this says "Open issue"
 * and names the host; a URL ending in .pdf gets a genuine download instead.
 */
function IssueFileAction({ url, title }: { url: string; title: string }) {
  const host = hostOf(url);
  if (isDirectFile(url)) {
    return (
      <a
        href={url}
        download
        aria-label={`Download the PDF of ${title}`}
        className={`${actionClass} text-ink hover:text-maroon`}
      >
        Download PDF ↓
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${title} on ${host ?? "the association site"} in a new tab — not a direct download`}
      className={`${actionClass} text-ink hover:text-maroon`}
    >
      Open issue ↗
    </a>
  );
}

function StoryCard({
  story,
  note,
  onShare,
}: {
  story: StoryRow;
  note: string | null;
  onShare: (story: StoryRow) => void;
}) {
  const file = isHttpUrl(story.downloadUrl) ? story.downloadUrl : null;

  return (
    <article className="flex flex-col bg-white p-7">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={CATEGORY_TONE[story.category]}>
          {CATEGORY_LABEL[story.category]}
        </Pill>
        {story.featured ? <Pill tone="brass">Featured</Pill> : null}
        {file ? <Pill>{isDirectFile(file) ? "PDF" : "Web issue"}</Pill> : null}
      </div>

      <p className="font-mono mt-4 text-[0.72rem] tabular-nums text-brass">
        {formatDate(story.publishedAt)}
      </p>
      <h3 className="font-display mt-2 text-xl leading-snug text-ink">
        <Link href={`/stories/${story.slug}`} className="hover:text-maroon">
          {story.title}
        </Link>
      </h3>
      <p className="mt-2.5 text-[0.9rem] leading-relaxed text-slate-ink">
        {story.excerpt}
      </p>

      <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
        <Monogram name={story.authorName} size="sm" tone="ink" />
        <div>
          <p className="text-[0.85rem] leading-snug text-ink">{story.authorName}</p>
          <p className="font-mono text-[0.7rem] tabular-nums text-slate-ink">
            {story.authorBatch ? `Batch of ${story.authorBatch}` : "RITAA editorial"}
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-5">
        <Link
          href={`/stories/${story.slug}`}
          className={`${actionClass} text-maroon hover:text-maroon-deep`}
        >
          Read →
        </Link>
        {file ? <IssueFileAction url={file} title={story.title} /> : null}
        <button
          type="button"
          onClick={() => onShare(story)}
          aria-label={`Copy a link to ${story.title}`}
          className={`${actionClass} text-ink hover:text-maroon`}
        >
          Copy link
        </button>
        {note ? (
          <span
            aria-hidden
            className="font-mono text-[0.7rem] tabular-nums text-jade"
          >
            {note}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export default function StoriesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);

  const all = useQuery(api.stories.list, {});
  const stories = useQuery(
    api.stories.list,
    filter === "all" ? {} : { category: filter },
  );

  // Clipboard confirmations are transient — they clear themselves, which also
  // lets an identical second confirmation re-announce in the live region.
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(timer);
  }, [note]);

  const list = stories ?? [];
  const allList = all ?? [];

  // `list` comes back newest-first, so the newsletter slice is already in order.
  const newsletters = allList.filter((s) => s.category === "newsletter");
  const latestIssue = newsletters[0];
  const issueYears = new Map<number, number>();
  for (const issue of newsletters) {
    const year = new Date(issue.publishedAt).getFullYear();
    issueYears.set(year, (issueYears.get(year) ?? 0) + 1);
  }
  const issueYearRows = Array.from(issueYears.entries()).sort(
    (a, b) => b[0] - a[0],
  );

  const storyYears = new Set(
    allList.map((s) => new Date(s.publishedAt).getFullYear()),
  );

  const latestFile =
    latestIssue && isHttpUrl(latestIssue.downloadUrl)
      ? latestIssue.downloadUrl
      : null;
  const latestHost = latestFile ? hostOf(latestFile) : null;

  function countFor(id: Filter) {
    if (!all) return "—";
    return id === "all"
      ? allList.length
      : allList.filter((s) => s.category === id).length;
  }

  async function share(story: StoryRow) {
    const url = `${window.location.origin}/stories/${story.slug}`;
    if (!navigator.clipboard?.writeText) {
      setNote({
        id: story._id,
        text: "Clipboard unavailable — copy from the address bar",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote({ id: story._id, text: "Link copied" });
    } catch {
      setNote({
        id: story._id,
        text: "Clipboard blocked — copy from the address bar",
      });
    }
  }

  return (
    <>
      <PageHeader
      image="/campus-4.jpg"
        module="Module 06 · News, Stories & Gallery"
        title="What the community has been doing, written down."
        lede="Success stories, association achievements, recaps of every event, the newsletter archive and the photographs. Written by alumni, edited by the association."
      >
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={all ? allList.length : "—"} label="Published pieces" onDark />
          <Stat value={all ? newsletters.length : "—"} label="Newsletter issues" onDark />
          <Stat
            value={all ? allList.filter((s) => s.featured).length : "—"}
            label="Featured on the homepage"
            onDark
          />
          <Stat value={all ? storyYears.size : "—"} label="Years covered" onDark />
        </div>
      </PageHeader>

      {/* One page-level live region for the whole page. Per-card confirmations
          are aria-hidden so a copy is announced exactly once. */}
      <p role="status" aria-live="polite" className="sr-only">
        {note?.text ?? ""}
      </p>

      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Archive"
            title="Read by section"
            lede="Success stories, achievements and event recaps, filtered to what you came for. Every piece has a shareable link."
            action={
              <Button href="/gallery" variant="outline">
                Media gallery
              </Button>
            }
          />

          {/* ---- Category filter ------------------------------------------ */}
          <div
            role="group"
            aria-label="Filter stories by category"
            className="flex flex-wrap gap-px bg-line"
          >
            {FILTERS.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(item.id)}
                  className={`font-mono flex items-baseline gap-2 px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? "bg-ink text-bone"
                      : "bg-white text-slate-ink hover:text-maroon"
                  }`}
                >
                  {item.label}
                  <span className={`tabular-nums ${active ? "text-brass-soft" : "text-brass"}`}>
                    {countFor(item.id)}
                  </span>
                </button>
              );
            })}
          </div>

          {filter === "newsletter" ? (
            <p className="mt-6 border-l-2 border-brass pl-4 text-[0.88rem] leading-relaxed text-slate-ink">
              These are the issues as published pieces. The{" "}
              <Link
                href={NEWSLETTERS}
                className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
              >
                newsletter archive
              </Link>{" "}
              lists the same run numbered and grouped by year, with a download or
              open action and both share options on every issue.
            </p>
          ) : null}

          {/* ---- Results -------------------------------------------------- */}
          <div className="mt-8">
            {stories === undefined ? (
              <LoadingRows rows={4} />
            ) : list.length === 0 ? (
              <Empty
                title={EMPTY_COPY[filter].title}
                hint={EMPTY_COPY[filter].hint}
                action={
                  filter === "all" ? (
                    <Button href="/about" variant="outline">
                      About the association
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setFilter("all")}>
                      Show everything
                    </Button>
                  )
                }
              />
            ) : (
              <>
                <p className="font-mono mb-5 text-[0.72rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                  {list.length} {list.length === 1 ? "piece" : "pieces"} · newest first
                </p>
                <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((story) => (
                    <StoryCard
                      key={story._id}
                      story={story}
                      note={note?.id === story._id ? note.text : null}
                      onShare={share}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </Shell>

      {/* ---- Newsletter archive ------------------------------------------- */}
      <section className="border-t border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Newsletter archive"
            title="The quarterly newsletter, every issue kept"
            lede="Issues go out to verified members four times a year and none are retired. The archive numbers them, groups them by year, and gives each one a download or open action plus two ways to share."
            action={
              <Button href="/newsletters" variant="outline">
                Open the archive
              </Button>
            }
          />

          {all === undefined ? (
            <LoadingRows rows={2} />
          ) : !latestIssue ? (
            <Empty
              title="No issues have been published yet"
              hint="The newsletter goes out quarterly once the editorial volunteers have enough to print. Write to the association to be on the list for the first one."
            />
          ) : (
            <div className="grid gap-px bg-line lg:grid-cols-[1.5fr_1fr]">
              <div className="flex flex-col bg-white p-7">
                <Eyebrow>Latest issue</Eyebrow>
                <p className="font-mono mt-3 text-[0.72rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                  {formatDate(latestIssue.publishedAt)}
                </p>
                <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                  <Link
                    href={`/stories/${latestIssue.slug}`}
                    className="hover:text-maroon"
                  >
                    {latestIssue.title}
                  </Link>
                </h3>
                <p className="mt-2.5 text-[0.9rem] leading-relaxed text-slate-ink">
                  {latestIssue.excerpt}
                </p>
                <div className="mt-auto pt-5">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <Link
                      href={`/stories/${latestIssue.slug}`}
                      className={`${actionClass} text-maroon hover:text-maroon-deep`}
                    >
                      Read the summary →
                    </Link>
                    {latestFile ? (
                      <IssueFileAction
                        url={latestFile}
                        title={latestIssue.title}
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => share(latestIssue)}
                      aria-label={`Copy a link to ${latestIssue.title}`}
                      className={`${actionClass} text-ink hover:text-maroon`}
                    >
                      Copy link
                    </button>
                    {note?.id === latestIssue._id ? (
                      <span
                        aria-hidden
                        className="font-mono text-[0.7rem] tabular-nums text-jade"
                      >
                        {note.text}
                      </span>
                    ) : null}
                  </div>
                  <p className="font-mono mt-3 text-[0.68rem] text-slate-ink">
                    {latestFile
                      ? isDirectFile(latestFile)
                        ? `Direct file download from ${latestHost ?? "the association"}.`
                        : `“Open issue” opens the association’s newsletter page on ${latestHost ?? "the association site"} in a new tab — it is not a direct PDF download.`
                      : "No file is attached to this issue yet — the summary is the full record."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col bg-white p-7">
                <Eyebrow>Back issues</Eyebrow>
                <dl className="font-mono mt-4 divide-y divide-line border-y border-line text-[0.75rem]">
                  {issueYearRows.map(([year, count]) => (
                    <div key={year} className="flex justify-between py-2.5">
                      <dt className="tabular-nums text-ink">{year}</dt>
                      <dd className="tabular-nums text-slate-ink">
                        {count} {count === 1 ? "issue" : "issues"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[0.85rem] leading-relaxed text-slate-ink">
                  Mailing list requests and issues older than this archive go to{" "}
                  <span className="font-mono text-ink">{RITAA.email}</span>.
                </p>
                <div className="mt-auto pt-5">
                  <Button href="/newsletters" variant="outline">
                    All {newsletters.length}{" "}
                    {newsletters.length === 1 ? "issue" : "issues"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Shell>
      </section>

      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
            <div>
              <Eyebrow>Contribute</Eyebrow>
              <h2 className="font-display mt-3 text-2xl leading-snug text-ink sm:text-3xl">
                Someone in your batch has a story nobody has written down.
              </h2>
              <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-slate-ink">
                Promotions, patents, a first export order, a lab someone funded — the
                editorial volunteers will write it up. Nominations and drafts both go to
                the same address.
              </p>
            </div>
            <div className="font-mono space-y-1 text-[0.8rem] text-slate-ink lg:text-right">
              <p className="text-ink">{RITAA.email}</p>
              <p className="tabular-nums">{RITAA.phone}</p>
              <p>{RITAA.website}</p>
            </div>
          </div>
        </Shell>
      </section>
    </>
  );
}
