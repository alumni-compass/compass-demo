"use client";

import { api, useQuery } from "@/lib/standalone";

import Link from "next/link";
import { useParams } from "next/navigation";
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
  Shell,
} from "@/components/kit";
import { formatDate, RITAA } from "@/lib/site";

/** Module 6 — a single story, achievement, recap or newsletter issue. */

const CATEGORY_LABEL: Record<string, string> = {
  success: "Success story",
  achievement: "Achievement",
  recap: "Event recap",
  newsletter: "Newsletter",
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

export default function StoryDetailPage() {
  const params = useParams();
  const raw = params?.slug;
  const slug = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  const story = useQuery(api.stories.bySlug, { slug });
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(timer);
  }, [note]);

  async function copyLink() {
    const url = window.location.href;
    if (!navigator.clipboard?.writeText) {
      setNote("Clipboard unavailable — copy the link from the address bar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied to your clipboard.");
    } catch {
      setNote("Clipboard blocked — copy the link from the address bar.");
    }
  }

  // undefined = the query is still in flight; null = no such story. The two are
  // kept strictly apart so the not-found state never flashes while loading.
  if (story === undefined) {
    return (
      <Shell>
        <div className="py-16 sm:py-20" aria-busy>
          <Eyebrow>Loading story</Eyebrow>
          <p role="status" className="sr-only">
            Loading this story.
          </p>
          <div className="mt-6">
            <LoadingRows rows={4} />
          </div>
        </div>
      </Shell>
    );
  }

  if (story === null) {
    return (
      <Shell>
        <div className="py-16 sm:py-20">
          <Link
            href="/stories"
            className={`${actionClass} text-maroon hover:text-maroon-deep`}
          >
            ← Back to stories
          </Link>
          <div className="mt-8">
            <Empty
              title="That story was not found"
              hint={`Nothing is published at /stories/${slug}. The piece may have been renamed, or the link may have been cut short in an email.`}
              action={
                <Button href="/stories" variant="outline">
                  Back to stories
                </Button>
              }
            />
          </div>
        </div>
      </Shell>
    );
  }

  const isNewsletter = story.category === "newsletter";
  const file = isHttpUrl(story.downloadUrl) ? story.downloadUrl : null;
  const direct = file ? isDirectFile(file) : false;
  const host = file ? hostOf(file) : null;
  const cover = isHttpUrl(story.coverUrl) ? story.coverUrl : null;

  // Blank lines separate paragraphs; a body with none is still one paragraph.
  const paragraphs = story.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <PageHeader
        module={`Module 06 · ${CATEGORY_LABEL[story.category] ?? "Story"}`}
        title={story.title}
        lede={story.excerpt}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Pill tone="dark">{CATEGORY_LABEL[story.category] ?? story.category}</Pill>
          {story.featured ? <Pill tone="dark">Featured</Pill> : null}
          <p className="font-mono flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] uppercase tracking-[0.12em] text-bone/60">
            <span className="text-brass-soft">{story.authorName}</span>
            {story.authorBatch ? (
              <span className="tabular-nums">Batch of {story.authorBatch}</span>
            ) : null}
            <span className="tabular-nums">{formatDate(story.publishedAt)}</span>
          </p>
        </div>
      </PageHeader>

      <Shell>
        <article className="py-16 sm:py-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
            <div className="flex flex-wrap items-center gap-5">
              <Link
                href="/stories"
                className={`${actionClass} text-maroon hover:text-maroon-deep`}
              >
                ← Back to stories
              </Link>
              {isNewsletter ? (
                <Link
                  href={NEWSLETTERS}
                  className={`${actionClass} text-ink hover:text-maroon`}
                >
                  Newsletter archive
                </Link>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-5">
              {file ? (
                direct ? (
                  <a
                    href={file}
                    download
                    aria-label={`Download the PDF of ${story.title}`}
                    className={`${actionClass} text-ink hover:text-maroon`}
                  >
                    Download PDF ↓
                  </a>
                ) : (
                  <a
                    href={file}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${story.title} on ${host ?? "the association site"} in a new tab — not a direct download`}
                    className={`${actionClass} text-ink hover:text-maroon`}
                  >
                    Open issue ↗
                  </a>
                )
              ) : null}
              <button
                type="button"
                onClick={copyLink}
                aria-label={`Copy a link to ${story.title}`}
                className={`${actionClass} text-ink hover:text-maroon`}
              >
                Copy link
              </button>
            </div>
          </div>

          {/* The announcement lives in one sr-only region and the visible copy
              is aria-hidden, so a single copy is spoken exactly once. */}
          <p role="status" aria-live="polite" className="sr-only">
            {note ?? ""}
          </p>
          {note ? (
            <p aria-hidden className="font-mono mt-4 text-[0.72rem] text-jade">
              {note}
            </p>
          ) : null}

          {file && !direct ? (
            <p className="font-mono mt-4 text-[0.68rem] text-slate-ink">
              &ldquo;Open issue&rdquo; opens the association&rsquo;s newsletter page
              on {host ?? "the association site"} in a new tab — it is not a direct
              PDF download.
            </p>
          ) : null}

          {/* Cover art reaches an <img> only when it is a real URL. The seeded
              records hold catalogue references, so nothing is rendered today and
              a published URL starts showing on its own. */}
          {cover ? (
            <figure className="mt-10 max-w-prose">
              {/* Plain <img>: remote hosts are supplied by the association at
                  runtime, so there is no build-time host list for next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={`Cover image — ${story.title}`}
                loading="lazy"
                decoding="async"
                className="aspect-[16/9] w-full border border-line bg-bone-deep object-cover"
              />
            </figure>
          ) : null}

          <div className="mt-10 max-w-prose space-y-6 text-[1.05rem] leading-[1.75] text-ink">
            {paragraphs.length > 0 ? (
              paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)
            ) : (
              <p className="text-slate-ink">
                {story.excerpt} The full write-up has not been filed yet — the
                summary above is the whole record for now.
              </p>
            )}
          </div>

          <div className="mt-12 max-w-prose border-t border-line pt-6">
            <div className="flex items-center gap-4">
              <Monogram name={story.authorName} tone="maroon" />
              <div>
                <p className="text-[0.95rem] leading-snug text-ink">
                  {story.authorName}
                </p>
                <p className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                  {story.authorBatch
                    ? `Batch of ${story.authorBatch} · published ${formatDate(story.publishedAt)}`
                    : `RITAA editorial · published ${formatDate(story.publishedAt)}`}
                </p>
              </div>
            </div>
            <p className="mt-6 text-[0.88rem] leading-relaxed text-slate-ink">
              Corrections, additions or a story of your own? Write to{" "}
              <span className="font-mono text-ink">{RITAA.email}</span>. The editorial
              volunteers publish nominations from any batch.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button href="/stories">All stories</Button>
              {isNewsletter ? (
                <Button href="/newsletters" variant="outline">
                  Newsletter archive
                </Button>
              ) : null}
              <Button href="/gallery" variant="outline">
                Media gallery
              </Button>
            </div>
          </div>
        </article>
      </Shell>
    </>
  );
}
