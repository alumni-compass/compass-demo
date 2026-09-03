"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

/**
 * The media on a post: up to four images, or one video.
 *
 * MOSAIC BY COUNT, not a carousel. One image gets the full width, two split it,
 * three make a lead plus a stack, four make a square grid — the arrangement
 * tells you how many there are before you count them, and nothing hides behind
 * a swipe. Every tile keeps a fixed aspect box so the card never reflows when
 * an image finishes loading, which is what makes a feed jump under the cursor.
 *
 * VIDEO IS A URL, and the shape of the URL decides the player. A YouTube or
 * Vimeo link becomes that platform's embed — the association's recap videos are
 * already there, and re-hosting them was never the point. Anything else is
 * handed to the browser's own `<video>`, which is the right player for a phone
 * clip on someone's own storage. YouTube is embedded through
 * `youtube-nocookie.com`: same player, no tracking cookie set on a member who
 * only scrolled past it.
 */

type Props = {
  imageUrls: string[];
  videoUrls: string[];
  /** Quoted media inside a share renders smaller and without the lightbox. */
  compact?: boolean;
};

/** youtu.be/ID · watch?v=ID · /embed/ID · /shorts/ID */
function youTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i,
  );
  return match?.[1] ?? null;
}

function vimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d{6,})/i);
  return match?.[1] ?? null;
}

function VideoFrame({ url, compact }: { url: string; compact?: boolean }) {
  const youtube = youTubeId(url);
  const vimeo = youtube ? null : vimeoId(url);
  const embed = youtube
    ? `https://www.youtube-nocookie.com/embed/${youtube}`
    : vimeo
      ? `https://player.vimeo.com/video/${vimeo}`
      : null;

  return (
    <div
      className={`relative overflow-hidden rounded-card border border-line bg-ink ${
        compact ? "aspect-video" : "aspect-video"
      }`}
    >
      {embed ? (
        <iframe
          src={embed}
          title="Video"
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full"
        />
      ) : (
        // No autoplay and no loop: a feed that starts making noise on scroll is
        // a feed people close.
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          className="absolute inset-0 size-full bg-ink object-contain"
        />
      )}
    </div>
  );
}

export default function PostMedia({ imageUrls, videoUrls, compact }: Props) {
  const reduce = useReducedMotion();
  const [zoomed, setZoomed] = useState<string | null>(null);

  const images = imageUrls.slice(0, 4);
  const video = videoUrls[0];

  if (images.length === 0 && !video) return null;

  /* Tailwind cannot build these from a variable, so the four arrangements are
     written out. Four literal strings beat a class the compiler cannot see. */
  const grid =
    images.length === 1
      ? "grid-cols-1"
      : images.length === 2
        ? "grid-cols-2"
        : images.length === 3
          ? "grid-cols-2 [&>*:first-child]:row-span-2"
          : "grid-cols-2";

  const tileHeight = compact
    ? images.length === 1
      ? "aspect-[16/9]"
      : "aspect-square"
    : images.length === 1
      ? "aspect-[16/10]"
      : images.length === 3
        ? "aspect-square"
        : "aspect-[4/3]";

  return (
    <>
      <div className={`mt-3 space-y-3 ${compact ? "max-w-md" : ""}`}>
        {video ? <VideoFrame url={video} compact={compact} /> : null}

        {images.length > 0 ? (
          <div className={`grid gap-1.5 ${grid}`}>
            {images.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                disabled={compact}
                onClick={compact ? undefined : () => setZoomed(url)}
                aria-label={compact ? undefined : "Open image"}
                className={`group relative overflow-hidden rounded-card border border-line bg-surface-sunk ${tileHeight} ${
                  compact ? "cursor-default" : "cursor-zoom-in"
                }`}
              >
                {/* Member-supplied hosts, so a plain <img> — next/image would
                    need every host declared at build time. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {zoomed ? (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.18 }}
            onClick={() => setZoomed(null)}
            role="dialog"
            aria-modal
          >
            <motion.img
              src={zoomed}
              alt=""
              className="max-h-full max-w-full rounded-card object-contain shadow-lift"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
            />
            <button
              type="button"
              onClick={() => setZoomed(null)}
              className="font-mono absolute right-5 top-5 rounded-control border border-white/25 px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] text-bone transition-colors hover:bg-white/10"
            >
              Close
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
