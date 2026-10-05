"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Button,
  Empty,
  Eyebrow,
  LoadingRows,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import { formatDate, RITAA } from "@/lib/site";

/**
 * Module 6 — the newsletter archive, which the brief names as its own thing
 * ("newsletter archive with download/share options") rather than as one more
 * category of story. It therefore gets its own route: back issues stack up
 * indefinitely and want year grouping and issue numbering, neither of which
 * belongs in the story grid on /stories.
 *
 * Honesty about the file: `downloadUrl` currently points at the association's
 * newsletter page, not at a PDF. Nothing here is labelled "download" unless the
 * stored URL actually ends in a file extension — otherwise the action says it
 * opens the association's page, and names the host it will open. Replace the
 * URL with a real PDF and the same row starts offering a true download.
 */

type Story = FunctionReturnType<typeof api.stories.list>[number];

const actionClass =
  "font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors";

function isHttpUrl(value: string | undefined | null): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

/** A URL that ends in a file is a real download; a page is not. */
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
 * Issue numbers live in the title and slug ("… — Issue 07", "newsletter-issue-07"),
 * so they are read from there rather than invented from list position — deleting
 * an issue must not renumber the ones around it.
 */
function issueNumber(story: Story): number | null {
  for (const source of [story.slug, story.title]) {
    const match = source.match(/issue[^0-9]{0,4}(\d{1,3})/i);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function issueLabel(story: Story) {
  const n = issueNumber(story);
  return n === null ? "Issue —" : `Issue ${String(n).padStart(2, "0")}`;
}

function IssueRow({
  story,
  latest,
  note,
  shareUrl,
  onCopy,
}: {
  story: Story;
  latest: boolean;
  note: string | null;
  shareUrl: string;
  onCopy: () => void;
}) {
  const file = isHttpUrl(story.downloadUrl) ? story.downloadUrl : null;
  const direct = file ? isDirectFile(file) : false;
  const host = file ? hostOf(file) : null;
  const label = issueLabel(story);

  const mailto = `mailto:?subject=${encodeURIComponent(
    `RITAA Newsletter — ${label}`,
  )}&body=${encodeURIComponent(
    `${story.title}\n\n${story.excerpt}\n\n${shareUrl}`,
  )}`;

  return (
    <article className="flex flex-col gap-5 bg-white p-6 sm:flex-row sm:gap-7">
      {/* Issue number, given the weight an archive spine needs. */}
      <div className="sm:w-32 sm:shrink-0">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-brass">
          {label.split(" ")[0]}
        </p>
        <p className="font-mono text-3xl leading-none tabular-nums text-ink">
          {issueNumber(story) === null
            ? "—"
            : String(issueNumber(story)).padStart(2, "0")}
        </p>
        <p className="font-mono mt-2 text-[0.7rem] tabular-nums text-slate-ink">
          {formatDate(story.publishedAt)}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {latest ? <Pill tone="brass">Latest issue</Pill> : null}
          {direct ? <Pill tone="jade">PDF</Pill> : null}
          {file && !direct ? <Pill>Web issue</Pill> : null}
          {!file ? <Pill>No file yet</Pill> : null}
        </div>

        <h3 className="font-display mt-3 text-lg leading-snug text-ink">
          <Link href={`/stories/${story.slug}`} className="hover:text-maroon">
            {story.title}
          </Link>
        </h3>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-slate-ink">
          {story.excerpt}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href={`/stories/${story.slug}`}
            className={`${actionClass} text-maroon hover:text-maroon-deep`}
          >
            Read the summary →
          </Link>

          {file ? (
            direct ? (
              <a
                href={file}
                download
                aria-label={`Download the PDF of ${label} — ${story.title}`}
                className={`${actionClass} text-ink hover:text-maroon`}
              >
                Download PDF ↓
              </a>
            ) : (
              <a
                href={file}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${label} on ${host ?? "the association site"} in a new tab`}
                className={`${actionClass} text-ink hover:text-maroon`}
              >
                Open issue ↗
              </a>
            )
          ) : null}

          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy a link to ${label} — ${story.title}`}
            className={`${actionClass} text-ink hover:text-maroon`}
          >
            Copy link
          </button>

          <a
            href={mailto}
            aria-label={`Share ${label} by email`}
            className={`${actionClass} text-ink hover:text-maroon`}
          >
            Share by email
          </a>

          {note ? (
            <span
              aria-hidden
              className="font-mono text-[0.7rem] tabular-nums text-jade"
            >
              {note}
            </span>
          ) : null}
        </div>

        {/* The honest caption: say what the action actually does. */}
        <p className="font-mono mt-3 text-[0.68rem] text-slate-ink">
          {file
            ? direct
              ? `Direct file download from ${host ?? "the association"}.`
              : `“Open issue” opens the association’s newsletter page on ${host ?? "the association site"} in a new tab — it is not a direct PDF download.`
            : "No file has been attached to this issue yet — the summary above is the full record."}
        </p>
      </div>
    </article>
  );
}

export default function NewslettersPage() {
  const issues = useQuery(api.stories.list, { category: "newsletter" });
  const list = issues ?? [];

  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  // window is unavailable during the server render, so the canonical association
  // address is used until the client has mounted and can report its own origin.
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(timer);
  }, [note]);

  const base = origin || `https://${RITAA.website}`;

  async function copyLink(story: Story) {
    const url = `${base}/stories/${story.slug}`;
    if (!navigator.clipboard?.writeText) {
      setNote({
        id: story._id,
        text: "Clipboard unavailable — copy from the address bar",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote({ id: story._id, text: "Issue link copied" });
    } catch {
      setNote({
        id: story._id,
        text: "Clipboard blocked — copy from the address bar",
      });
    }
  }

  // The list query already returns newest first; group it by publication year.
  const groups = new Map<number, Story[]>();
  for (const story of list) {
    const year = new Date(story.publishedAt).getFullYear();
    const bucket = groups.get(year);
    if (bucket) bucket.push(story);
    else groups.set(year, [story]);
  }
  const years = Array.from(groups.keys()).sort((a, b) => b - a);

  const latest = list[0];
  const withFiles = list.filter((s) => isHttpUrl(s.downloadUrl)).length;
  const latestNumber = latest ? issueNumber(latest) : null;

  return (
    <>
      <PageHeader
      image="/campus-4.jpg"
        module="Module 06 · Newsletter Archive"
        title="Every issue of the RITAA newsletter, kept."
        lede="The newsletter goes out quarterly to verified members. Nothing is retired — back issues stay here by year, numbered, each one openable and shareable."
      >
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={issues ? list.length : "—"} label="Issues archived" onDark />
          <Stat value={issues ? years.length : "—"} label="Years covered" onDark />
          <Stat
            value={
              issues
                ? latestNumber === null
                  ? "—"
                  : String(latestNumber).padStart(2, "0")
                : "—"
            }
            label="Latest issue number"
            onDark
          />
          <Stat value={issues ? withFiles : "—"} label="Issues with a file" onDark />
        </div>
      </PageHeader>

      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Archive"
            title="Back issues by year"
            lede="Each issue carries its number, its publication date, a summary you can read here, and both share options — a link to copy and an email draft."
            action={
              <Button href="/stories" variant="outline">
                News &amp; stories
              </Button>
            }
          />

          <p className="mb-8 border-l-2 border-brass pl-4 text-[0.88rem] leading-relaxed text-slate-ink">
            To be added to the mailing list, or to ask for an issue that predates
            this archive, write to{" "}
            <span className="font-mono text-ink">{RITAA.email}</span> or call{" "}
            <span className="font-mono tabular-nums text-ink">{RITAA.phone}</span>.
          </p>

          {/* One page-level live region announces every clipboard result; the
              per-row confirmations are aria-hidden so nothing double-speaks. */}
          <p role="status" aria-live="polite" className="sr-only">
            {note?.text ?? ""}
          </p>

          {issues === undefined ? (
            <LoadingRows rows={4} />
          ) : list.length === 0 ? (
            <Empty
              title="The newsletter archive is empty"
              hint="Issues are published quarterly. Write to the association to be added to the mailing list and the next one will reach you directly."
              action={
                <Button href="/stories" variant="outline">
                  Read the stories instead
                </Button>
              }
            />
          ) : (
            <div className="space-y-14">
              {years.map((year) => {
                const yearIssues = groups.get(year) ?? [];
                return (
                  <div key={year}>
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
                      <h2 className="font-mono text-2xl tabular-nums text-ink sm:text-3xl">
                        {year}
                      </h2>
                      <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                        {yearIssues.length}{" "}
                        {yearIssues.length === 1 ? "issue" : "issues"}
                      </p>
                    </div>
                    <div className="grid gap-px bg-line">
                      {yearIssues.map((story) => (
                        <IssueRow
                          key={story._id}
                          story={story}
                          latest={latest?._id === story._id}
                          note={note?.id === story._id ? note.text : null}
                          shareUrl={`${base}/stories/${story.slug}`}
                          onCopy={() => void copyLink(story)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </Shell>

      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
            <div>
              <Eyebrow>Contribute to the next issue</Eyebrow>
              <h2 className="font-display mt-3 text-2xl leading-snug text-ink sm:text-3xl">
                The newsletter is assembled from what alumni send in.
              </h2>
              <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-slate-ink">
                A promotion, a new venture, a batch meet-up, a photograph worth
                printing — send it before the quarter closes and it goes into the
                next issue.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button href="/stories" variant="outline">
                  All stories
                </Button>
                <Button href="/gallery" variant="outline">
                  Media gallery
                </Button>
              </div>
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
