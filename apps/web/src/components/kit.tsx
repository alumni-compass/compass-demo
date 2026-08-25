import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { UrlObject } from "url";

import { initials } from "@/lib/site";

/**
 * Shared presentational primitives for the RITAA portal.
 *
 * Every page composes from these so the brass rules, eyebrow labels, monogram
 * avatars and type scale stay identical across all twelve modules. None of these
 * are client components — pages opt into interactivity themselves.
 *
 * The network additions live at the bottom: `Avatar`, `DegreeMark` and
 * `MutualNote`. They are here rather than in the network pages because the
 * directory, the profile page and the message inbox all render the same
 * relationship, and it has to look the same in all three or it stops reading as
 * one fact about one person.
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * `next.config.ts` sets `typedRoutes: true`. Link's own href type is generic over
 * the route, so re-using it directly here collapses to `RouteImpl<unknown>` and
 * rejects dynamic hrefs like `/directory/${id}` — which Button legitimately needs.
 *
 * Button therefore accepts a plain string (or a URL object) and casts at the Link
 * boundary. Route-literal checking is still enforced everywhere the pages use
 * <Link> directly, which is the bulk of navigation; this only relaxes it for
 * hrefs built from record ids, where the route is dynamic by definition.
 */
type Href = string | UrlObject;

/** Page-width container. */
export function Shell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}

/**
 * Small label. Used for module names, counts and metadata.
 *
 * `brass-ink` rather than `brass`: the decorative brass is about 3:1 on white,
 * which fails AA at this size. See the palette note in index.css.
 */
export function Eyebrow({
  children,
  tone = "brass",
}: {
  children: ReactNode;
  tone?: "brass" | "bone" | "slate";
}) {
  const tones = {
    brass: "text-brass-ink",
    bone: "text-brass-soft",
    slate: "text-slate-ink",
  };
  return (
    <span
      className={cx(
        "font-mono text-[0.7rem] uppercase tracking-[0.16em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Section heading with the brass rule that opens every major block. */
export function SectionHead({
  eyebrow,
  title,
  lede,
  action,
  onDark = false,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  action?: ReactNode;
  onDark?: boolean;
}) {
  return (
    <header className="mb-10">
      <div className={cx("h-px w-full", onDark ? "bg-white/15" : "rule-brass")} />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <Eyebrow tone={onDark ? "bone" : "brass"}>{eyebrow}</Eyebrow>
          <h2
            className={cx(
              "font-display mt-2 text-3xl leading-[1.1] sm:text-4xl",
              onDark ? "text-bone" : "text-ink",
            )}
          >
            {title}
          </h2>
          {lede ? (
            <p
              className={cx(
                "mt-3 text-[0.975rem] leading-relaxed",
                onDark ? "text-bone/70" : "text-slate-ink",
              )}
            >
              {lede}
            </p>
          ) : null}
        </div>
        {action}
      </div>
    </header>
  );
}

/** Vertical rhythm wrapper so section spacing never drifts between pages. */
export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("py-16 sm:py-20", className)}>
      {children}
    </section>
  );
}

/**
 * Page masthead used by every inner route.
 *
 * Pass `image` to back the masthead with one of the college's own photographs
 * (files in /public). The ink overlay is deliberately heavy — the headline has to
 * hold full contrast over a busy convocation crowd, and dimming the photograph
 * is more reliable than a text shadow.
 */
export function PageHeader({
  module,
  title,
  lede,
  image,
  children,
}: {
  module: string;
  title: string;
  lede: string;
  image?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "relative isolate overflow-hidden border-b border-white/10",
        !image && "ink-weave",
      )}
    >
      {image ? (
        <>
          {/* Local static asset, so a plain <img> avoids a needless loader hop. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover object-center"
          />
          <div aria-hidden className="absolute inset-0 bg-ink/90 mix-blend-multiply" />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-maroon/40"
          />
        </>
      ) : null}
      <Shell className="relative py-14 sm:py-18">
        <Eyebrow tone="bone">{module}</Eyebrow>
        <h1 className="font-display mt-3 max-w-3xl text-4xl leading-[1.05] text-bone sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-bone/70">
          {lede}
        </p>
        {children ? <div className="mt-8">{children}</div> : null}
      </Shell>
    </div>
  );
}

export function Card({
  children,
  className,
  as: As = "div",
  accent = false,
  image,
  imageAlt = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li";
  /** Draws a brass rule along the top edge, for cards that lead a section. */
  accent?: boolean;
  /** Photograph from /public, rendered above the content in a fixed frame. */
  image?: string;
  imageAlt?: string;
  /** Lifts on hover. Only for cards that are themselves a link or an action. */
  interactive?: boolean;
}) {
  return (
    <As
      className={cx(
        "rounded-card border border-line bg-surface shadow-card",
        interactive ? "card-interactive" : "transition-colors",
        // Padding sits on the inner wrapper when there is an image, so the
        // photograph can run edge to edge instead of floating inside a margin.
        !image && "p-6",
        image && "overflow-hidden",
        className,
      )}
    >
      {accent ? <div aria-hidden className="h-0.5 w-full bg-brass" /> : null}
      {image ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={imageAlt}
            loading="lazy"
            // Fixed ratio so a row of cards cannot jump as images decode.
            className="aspect-[16/9] w-full object-cover"
          />
          <div className="p-6">{children}</div>
        </>
      ) : (
        children
      )}
    </As>
  );
}

/**
 * Monogram avatar — avoids depending on external image hosts entirely.
 *
 * Circular, because these stand for people. Everything else in the portal is
 * square, which is what makes a person read as a person at a glance.
 */
export function Monogram({
  name,
  size = "md",
  tone = "maroon",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  tone?: "maroon" | "ink" | "brass";
}) {
  const sizes = {
    sm: "size-9 text-[0.7rem]",
    md: "size-12 text-sm",
    lg: "size-16 text-base",
  };
  const tones = {
    maroon: "bg-maroon text-bone",
    ink: "bg-ink text-bone",
    brass: "bg-brass text-ink",
  };
  return (
    <span
      aria-hidden
      className={cx(
        "font-mono inline-flex shrink-0 items-center justify-center rounded-chip tracking-tight",
        sizes[size],
        tones[tone],
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * A member's face: their photograph when there is one, their monogram when not.
 *
 * Sign-in is Google and LinkedIn only, so most members arrive with a provider
 * avatar. This falls back to the monogram on a missing *or broken* URL — a
 * provider image can 404 later, and a broken-image icon where a face should be
 * is worse than initials.
 */
export function Avatar({
  name,
  src,
  size = "md",
  tone = "maroon",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  tone?: "maroon" | "ink" | "brass";
}) {
  const sizes = { sm: "size-9", md: "size-12", lg: "size-16" };
  if (!src) return <Monogram name={name} size={size} tone={tone} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      className={cx(
        "shrink-0 rounded-chip border border-line object-cover",
        sizes[size],
      )}
    />
  );
}

export function Pill({
  children,
  tone = "quiet",
}: {
  children: ReactNode;
  tone?: "quiet" | "brass" | "jade" | "maroon" | "dark";
}) {
  const tones = {
    quiet: "border-line bg-bone text-slate-ink",
    brass: "border-brass/45 bg-brass/10 text-brass-ink",
    jade: "border-jade/30 bg-jade-tint text-jade",
    maroon: "border-maroon/30 bg-maroon-tint text-maroon",
    dark: "border-white/20 bg-white/10 text-bone",
  };
  return (
    <span
      className={cx(
        "font-mono inline-flex items-center gap-1 rounded-chip border px-2.5 py-0.5 text-[0.7rem] uppercase tracking-[0.1em]",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Verified badge — module 1's alumni verification, surfaced everywhere. */
export function VerifiedMark() {
  return (
    <span
      title="Verified alumnus"
      className="font-mono inline-flex items-center gap-1 text-[0.7rem] uppercase tracking-[0.1em] text-jade"
    >
      <svg viewBox="0 0 12 12" className="size-3 fill-current" aria-hidden>
        <path d="M6 0l1.6 1.2 2-.2.6 1.9 1.7 1.1-.9 1.8.3 2-1.9.6-1.2 1.6L6 11.2 4.2 12l-1.2-1.6-1.9-.6.3-2L.5 6l1.7-1.1.6-1.9 2 .2z" />
      </svg>
      Verified
    </span>
  );
}

/** Big figure + label. Kept mono so numbers align in a row. */
export function Stat({
  value,
  label,
  onDark = false,
}: {
  value: ReactNode;
  label: string;
  onDark?: boolean;
}) {
  return (
    <div>
      <div
        className={cx(
          "font-mono text-2xl tabular-nums sm:text-3xl",
          onDark ? "text-brass-soft" : "text-maroon",
        )}
      >
        {value}
      </div>
      <div
        className={cx(
          "mt-1 text-[0.8rem] leading-snug",
          onDark ? "text-bone/60" : "text-slate-ink",
        )}
      >
        {label}
      </div>
    </div>
  );
}

export function Button({
  href,
  children,
  variant = "solid",
  size = "md",
  type,
  onClick,
  disabled,
  className,
  title,
}: {
  href?: Href;
  children: ReactNode;
  variant?: "solid" | "outline" | "ghost" | "onDark" | "quiet";
  size?: "sm" | "md";
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const variants = {
    solid: "bg-maroon text-bone hover:bg-maroon-deep shadow-panel",
    outline:
      "border border-ink/20 bg-surface text-ink hover:border-maroon hover:text-maroon",
    ghost:
      "text-maroon hover:text-maroon-deep underline decoration-brass/50 underline-offset-4",
    onDark: "bg-bone text-ink hover:bg-brass-soft",
    /** For secondary actions sitting next to a solid one. */
    quiet: "bg-bone-deep text-ink hover:bg-line",
  };
  const sizes = {
    // min-h-11 (44px) is the accessible touch-target floor. Without it the
    // padding alone gave ~39px, and this is the CTA used across every page.
    md: "min-h-11 px-5 py-2.5 text-[0.75rem]",
    sm: "min-h-9 px-3.5 py-1.5 text-[0.7rem]",
  };
  const base = cx(
    "font-mono inline-flex items-center justify-center gap-2 rounded-control uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    sizes[size],
    variants[variant],
    className,
  );

  if (href) {
    return (
      <Link
        href={href as ComponentProps<typeof Link>["href"]}
        className={base}
        title={title}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={base}
      title={title}
    >
      {children}
    </button>
  );
}

/** Progress meter for campaign totals and the fund usage tracker. */
export function Meter({
  value,
  label,
  tone = "jade",
}: {
  value: number;
  label?: string;
  tone?: "jade" | "brass" | "maroon";
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tones = { jade: "bg-jade", brass: "bg-brass", maroon: "bg-maroon" };
  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-chip bg-bone-deep"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div className={cx("h-full", tones[tone])} style={{ width: `${pct}%` }} />
      </div>
      {label ? (
        <div className="mt-2 flex justify-between">
          <span className="font-mono text-[0.7rem] text-slate-ink">{label}</span>
          <span className="font-mono text-[0.7rem] tabular-nums text-ink">{pct}%</span>
        </div>
      ) : null}
    </div>
  );
}

/** Empty state. The brief's tone: say what to do next, never apologise. */
export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      <p className="font-display text-xl text-ink">{title}</p>
      {hint ? (
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-ink">{hint}</p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Loading placeholder that keeps layout height stable. */
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-card border border-line bg-surface/70"
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form field styling                                                  */
/* ------------------------------------------------------------------ */

/**
 * Shared field classes, so every form in the portal looks like the same form.
 *
 * These used to live in `auth-panels.tsx`, which existed to hold the password and
 * one-time-code panels. Sign-in is two provider buttons now, so that file is gone
 * and these moved here — the verification form on /join, the job posting desk and
 * the RACE submission form all still need them, and none of them were ever about
 * authentication.
 */
export const inputClass =
  "w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-soft focus:border-maroon disabled:cursor-not-allowed disabled:bg-bone disabled:text-slate-ink";
export const labelClass =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";
export const errorClass =
  "font-mono text-[0.7rem] leading-snug tracking-[0.04em] text-maroon";
export const hintClass = "text-[0.8rem] leading-snug text-slate-ink";

/**
 * Convex wraps an Error thrown inside a function with a request id and a stack
 * before it reaches the browser. The sentence the handler wrote is the one the
 * member needs to read, so lift that out and show it exactly as written.
 */
export function actionErrorMessage(error: unknown) {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const named = /Uncaught (?:ConvexError|Error):\s*([^\n]+)/.exec(raw);
  if (named?.[1]) return named[1].trim();
  const line = raw
    .split("\n")
    .map((part) => part.trim())
    .find(
      (part) =>
        part.length > 0 &&
        !part.startsWith("[") &&
        !/^at\s/.test(part) &&
        part !== "Server Error",
    );
  return line ?? "That did not go through. Try again in a moment.";
}

/* ------------------------------------------------------------------ */
/* Network primitives                                                  */
/* ------------------------------------------------------------------ */

/**
 * How close this member is to you.
 *
 * Three states and no fourth: connected, a mutual connection exists, or nothing
 * measured. There is deliberately no "3rd" — `network.profileEdge` does not walk
 * that far, and printing a degree it never measured would be a guess dressed as
 * a fact.
 */
export function DegreeMark({ degree }: { degree: 1 | 2 | null }) {
  if (degree === null) return null;
  return (
    <span
      title={
        degree === 1
          ? "Connected to you"
          : "Someone you are connected to knows this member"
      }
      className={cx(
        "font-mono rounded-chip border px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.1em]",
        degree === 1
          ? "border-jade/30 bg-jade-tint text-jade"
          : "border-line-strong bg-bone text-slate-ink",
      )}
    >
      {degree === 1 ? "1st" : "2nd"}
    </span>
  );
}

/**
 * THE SIGNATURE ELEMENT — who you both know, by name.
 *
 * Names one or two mutual connections and counts the rest, rather than showing a
 * bare number. The name is the useful part: it tells the member who to ask for
 * the introduction, which is the whole reason to surface a mutual at all.
 *
 * `complete` comes from the backend's bounded mutual walk. When the walk was
 * truncated this says "at least", because under-reporting silently would make a
 * well-connected member look isolated.
 */
export function MutualNote({
  names,
  complete = true,
  onDark = false,
}: {
  names: string[];
  complete?: boolean;
  onDark?: boolean;
}) {
  if (names.length === 0) return null;

  const [first, second] = names;
  const rest = names.length - (second ? 2 : 1);
  const who = second ? `${first} and ${second}` : first;
  const tail =
    rest > 0 ? ` and ${rest} other${rest === 1 ? "" : "s"}` : "";

  return (
    <p
      className={cx(
        "mutual-marker text-[0.8rem] leading-snug",
        onDark ? "text-bone/70" : "text-slate-ink",
      )}
    >
      {complete ? "" : "At least "}
      <span className={onDark ? "text-bone" : "text-ink"}>
        {who}
        {tail}
      </span>{" "}
      {names.length === 1 && !tail ? "knows" : "know"} you both
    </p>
  );
}

/**
 * Filter tabs with a count on each, used by /network and /messages.
 *
 * The count is part of the label rather than a separate badge because it is the
 * thing being chosen between: "Requests 3" is one piece of information, and
 * splitting it into two elements makes the reader assemble it themselves.
 */
export function TabBar<T extends string>({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onSelect: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-control border border-line bg-surface p-1 shadow-panel"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cx(
              "font-mono inline-flex min-h-9 items-center gap-2 rounded-[6px] px-3.5 text-[0.7rem] uppercase tracking-[0.1em] transition-colors",
              selected
                ? "bg-ink text-bone"
                : "text-slate-ink hover:bg-bone hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={cx(
                  "tabular-nums",
                  selected ? "text-brass-soft" : "text-slate-soft",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
