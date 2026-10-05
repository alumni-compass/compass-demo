"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
import { RITAA } from "@/lib/site";

/**
 * Module 6 — media gallery (images and videos).
 *
 * The album media stored today are catalogue references — "sangamam-2025-3" —
 * not resolvable URLs, so every value is checked with `isHttpUrl` before it is
 * allowed near an <img> or an <a>. A reference renders as a numbered contact
 * sheet tile; a real http(s) value renders as the photograph itself. Uploading
 * real URLs over the references therefore upgrades this page on its own, with
 * no code change: covers, contact sheets and the video entry all switch to the
 * live asset the moment the value looks like a URL.
 */

type Album = FunctionReturnType<typeof api.stories.albums>[number];

/** Tints for the CSS stand-in tiles. Palette only — brass, maroon, bone. */
const TINTS = ["bg-bone-deep", "bg-brass/20", "bg-maroon/10"];

const actionClass =
  "font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/** The single guard that decides whether a stored value is safe to render. */
/**
 * True for a value that can actually be rendered as an image.
 *
 * Accepts absolute http(s) URLs and site-relative paths like `/campus-2.jpg`,
 * since the college's own photographs are served from /public. Catalogue slugs
 * such as "sangamam-2025-3" fail both tests and fall through to the placeholder
 * tile, which is what keeps a half-populated album from showing broken images.
 */
function isHttpUrl(value: string | undefined | null): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^https?:\/\/\S+$/i.test(v) || /^\/[^/\s]\S*\.(jpe?g|png|webp|avif|gif)$/i.test(v);
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * One frame of the contact sheet: the real photograph when the album holds a
 * URL, otherwise a numbered tile carrying the catalogue reference.
 */
function MediaTile({
  value,
  index,
  albumTitle,
}: {
  value: string;
  index: number;
  albumTitle: string;
}) {
  if (isHttpUrl(value)) {
    return (
      // Plain <img> rather than next/image: album hosts are supplied by the
      // association at runtime, so there is no build-time host list for
      // next/image to validate against.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value}
        alt={`${albumTitle} — photograph ${index + 1}`}
        loading="lazy"
        decoding="async"
        className="aspect-square w-full bg-bone-deep object-cover"
      />
    );
  }
  return (
    <span
      title={value}
      className={`font-mono flex aspect-square items-center justify-center text-[0.62rem] tabular-nums text-slate-ink ${
        TINTS[index % TINTS.length]
      }`}
    >
      {String(index + 1).padStart(2, "0")}
      <span className="sr-only"> — catalogue reference {value}</span>
    </span>
  );
}

/** Album thumbnail: the cover photograph if published, else a tiled stand-in. */
function AlbumCover({ album }: { album: Album }) {
  const cover = isHttpUrl(album.coverUrl)
    ? album.coverUrl
    : album.imageUrls.find(isHttpUrl);

  if (cover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cover}
        alt={`Cover photograph — ${album.title}`}
        loading="lazy"
        decoding="async"
        className="aspect-[4/3] w-full border border-line bg-bone-deep object-cover"
      />
    );
  }

  if (album.imageUrls.length === 0) {
    return (
      <div
        aria-hidden
        className="aspect-[4/3] w-full border border-line bg-bone-deep"
      />
    );
  }

  return (
    <div
      aria-hidden
      className="grid aspect-[4/3] grid-cols-3 grid-rows-2 gap-px border border-line bg-line"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={TINTS[i % TINTS.length]} />
      ))}
    </div>
  );
}

function AlbumRow({
  album,
  open,
  note,
  onToggle,
  onShare,
}: {
  album: Album;
  open: boolean;
  note: string | null;
  onToggle: () => void;
  onShare: () => void;
}) {
  const panelId = `album-panel-${album._id}`;
  const photos = album.imageUrls.length;
  const published = album.imageUrls.filter(isHttpUrl).length;
  const video = album.videoUrl;
  const videoLink = isHttpUrl(video) ? video : null;
  const videoHost = videoLink ? hostOf(videoLink) : null;

  return (
    <article id={`album-${album._id}`} className="scroll-mt-24 bg-white">
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:gap-6">
        <div className="w-full sm:w-44 sm:shrink-0">
          <AlbumCover album={album} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="brass">{album.eventName}</Pill>
            {video ? <Pill tone="maroon">Video</Pill> : null}
            {published > 0 ? (
              <Pill tone="jade">{published} published</Pill>
            ) : (
              <Pill>Catalogued</Pill>
            )}
          </div>

          <h3 className="font-display mt-3 text-lg leading-snug text-ink">
            {album.title}
          </h3>

          <dl className="font-mono mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.72rem] text-slate-ink">
            <div className="flex gap-2">
              <dt>Year</dt>
              <dd className="tabular-nums text-ink">{album.year}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Photographs</dt>
              <dd className="tabular-nums text-ink">{photos}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Videos</dt>
              <dd className="tabular-nums text-ink">{video ? 1 : 0}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={panelId}
              className={`${actionClass} text-maroon hover:text-maroon-deep`}
            >
              {open ? "Hide contact sheet" : "View contact sheet"}
              <span aria-hidden> {open ? "▴" : "▾"}</span>
            </button>
            <button
              type="button"
              onClick={onShare}
              aria-label={`Copy a link to the album ${album.title}`}
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
        </div>
      </div>

      {/* Kept mounted so `aria-controls` always resolves to a real element. */}
      <div
        id={panelId}
        hidden={!open}
        className="border-t border-line bg-bone/60 p-6"
      >
        <Eyebrow>Contact sheet</Eyebrow>
        <p className="font-mono mt-2 text-[0.72rem] tabular-nums text-slate-ink">
          {photos} {photos === 1 ? "frame" : "frames"} · {published} published
          {published === 0 && photos > 0
            ? " — numbered tiles stand in until the files are uploaded"
            : ""}
        </p>

        {photos === 0 ? (
          <p className="mt-4 text-[0.88rem] leading-relaxed text-slate-ink">
            Nothing has been catalogued in this album yet.
          </p>
        ) : (
          <ol className="mt-4 grid grid-cols-4 gap-px bg-line sm:grid-cols-6 lg:grid-cols-8">
            {album.imageUrls.map((reference, i) => (
              <li key={`${reference}-${i}`} className="bg-white">
                <MediaTile
                  value={reference}
                  index={i}
                  albumTitle={album.title}
                />
              </li>
            ))}
          </ol>
        )}

        <div className="mt-6 border-t border-line pt-5">
          <Eyebrow>Video</Eyebrow>
          {videoLink ? (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <a
                href={videoLink}
                target="_blank"
                rel="noreferrer"
                className={`${actionClass} text-maroon hover:text-maroon-deep`}
              >
                Watch the recap ↗
              </a>
              {videoHost ? (
                <span className="font-mono text-[0.72rem] text-slate-ink">
                  Opens {videoHost} in a new tab
                </span>
              ) : null}
            </p>
          ) : video ? (
            <p className="mt-2 text-[0.88rem] leading-relaxed text-slate-ink">
              One recap video is catalogued as{" "}
              <span className="font-mono text-ink">{video}</span>. It becomes a
              playable link here once the committee publishes the file.
            </p>
          ) : (
            <p className="mt-2 text-[0.88rem] leading-relaxed text-slate-ink">
              No video was recorded for this album — photographs only.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export default function GalleryPage() {
  const albums = useQuery(api.stories.albums, {});
  const list = albums ?? [];

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);

  // Clipboard confirmations are transient — they clear themselves, which also
  // lets an identical second confirmation re-announce in the live region.
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(timer);
  }, [note]);

  // A shared album link (/gallery#album-<id>) opens that album and scrolls to it.
  useEffect(() => {
    if (albums === undefined) return;
    const match = window.location.hash.match(/^#album-(.+)$/);
    const id = match?.[1];
    if (!id || !albums.some((a) => a._id === id)) return;
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    document.getElementById(`album-${id}`)?.scrollIntoView({ block: "start" });
  }, [albums]);

  function toggle(id: string) {
    setOpenIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function shareAlbum(album: Album) {
    const url = `${window.location.origin}/gallery#album-${album._id}`;
    if (!navigator.clipboard?.writeText) {
      setNote({
        id: album._id,
        text: "Clipboard unavailable — copy from the address bar",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote({ id: album._id, text: "Album link copied" });
    } catch {
      setNote({
        id: album._id,
        text: "Clipboard blocked — copy from the address bar",
      });
    }
  }

  // Group by year, newest cohort of albums first.
  const groups = new Map<number, Album[]>();
  for (const album of list) {
    const bucket = groups.get(album.year);
    if (bucket) bucket.push(album);
    else groups.set(album.year, [album]);
  }
  const years = Array.from(groups.keys()).sort((a, b) => b - a);

  const totalPhotos = list.reduce((sum, a) => sum + a.imageUrls.length, 0);
  const publishedPhotos = list.reduce(
    (sum, a) => sum + a.imageUrls.filter(isHttpUrl).length,
    0,
  );
  const videos = list.filter((a) => a.videoUrl).length;
  const allOpen = list.length > 0 && openIds.length === list.length;

  return (
    <>
      <PageHeader
      image="/campus-2.jpg"
        module="Module 06 · Media Gallery"
        title="Every reunion, clinic and league, catalogued by year."
        lede="Photographs and recap videos from RITAA events, sorted into albums the organising committee maintains after each one."
      >
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={albums ? list.length : "—"} label="Albums catalogued" onDark />
          <Stat value={albums ? totalPhotos : "—"} label="Photographs indexed" onDark />
          <Stat value={albums ? videos : "—"} label="Recap videos" onDark />
          <Stat value={albums ? years.length : "—"} label="Years covered" onDark />
        </div>
      </PageHeader>

      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Albums"
            title="Browse the albums"
            lede="Open an album to see its full contact sheet, the frame count and the recap video where one was shot. Photographs and videos both sit inside the album they belong to."
            action={
              <Button href="/events" variant="outline">
                Event calendar
              </Button>
            }
          />

          <p className="mb-8 border-l-2 border-brass pl-4 text-[0.9rem] leading-relaxed text-slate-ink">
            {publishedPhotos > 0
              ? `${publishedPhotos} of ${totalPhotos} catalogued frames have their full-resolution file published; the rest show as numbered tiles until the committee uploads them.`
              : "Frames are catalogued on the day of the event and the full-resolution files follow, usually within a fortnight. Until a file is uploaded its frame shows as a numbered tile rather than a broken photograph."}{" "}
            For a specific photograph, write to{" "}
            <span className="font-mono text-ink">{RITAA.email}</span>.
          </p>

          {/* One page-level live region announces every clipboard result. The
              per-album confirmations are aria-hidden so nothing double-speaks. */}
          <p role="status" aria-live="polite" className="sr-only">
            {note?.text ?? ""}
          </p>

          {albums === undefined ? (
            <LoadingRows rows={4} />
          ) : list.length === 0 ? (
            <Empty
              title="No albums have been published yet"
              hint="Photographs from the next Sangamam are uploaded within a fortnight of the event."
              action={
                <Button href="/events" variant="outline">
                  See what is coming up
                </Button>
              }
            />
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-y border-line py-3">
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                  {list.length} {list.length === 1 ? "album" : "albums"} ·{" "}
                  {totalPhotos} photographs · {videos}{" "}
                  {videos === 1 ? "video" : "videos"}
                </p>
                <div className="flex flex-wrap items-center gap-5">
                  <button
                    type="button"
                    onClick={() => setOpenIds(list.map((a) => a._id))}
                    disabled={allOpen}
                    className={`${actionClass} text-ink hover:text-maroon`}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenIds([])}
                    disabled={openIds.length === 0}
                    className={`${actionClass} text-ink hover:text-maroon`}
                  >
                    Collapse all
                  </button>
                </div>
              </div>

              <div className="space-y-14">
                {years.map((year) => {
                  const yearAlbums = groups.get(year) ?? [];
                  const yearPhotos = yearAlbums.reduce(
                    (sum, a) => sum + a.imageUrls.length,
                    0,
                  );
                  const yearVideos = yearAlbums.filter((a) => a.videoUrl).length;
                  return (
                    <div key={year}>
                      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
                        <h2 className="font-mono text-2xl tabular-nums text-ink sm:text-3xl">
                          {year}
                        </h2>
                        <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                          {yearAlbums.length}{" "}
                          {yearAlbums.length === 1 ? "album" : "albums"} ·{" "}
                          {yearPhotos} photographs · {yearVideos}{" "}
                          {yearVideos === 1 ? "video" : "videos"}
                        </p>
                      </div>
                      <div className="grid gap-px bg-line">
                        {yearAlbums.map((album) => (
                          <AlbumRow
                            key={album._id}
                            album={album}
                            open={openIds.includes(album._id)}
                            note={note?.id === album._id ? note.text : null}
                            onToggle={() => toggle(album._id)}
                            onShare={() => void shareAlbum(album)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </Shell>

      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
            <div>
              <Eyebrow>Send us your photographs</Eyebrow>
              <h2 className="font-display mt-3 text-2xl leading-snug text-ink sm:text-3xl">
                The best pictures from every reunion are taken by alumni, not
                photographers.
              </h2>
              <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-slate-ink">
                If you shot photographs or video at a RITAA event, send them in with
                the album name and the year. Credit is published alongside the frame.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button href="/stories" variant="outline">
                  News &amp; stories
                </Button>
                <Button href="/newsletters" variant="outline">
                  Newsletter archive
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
