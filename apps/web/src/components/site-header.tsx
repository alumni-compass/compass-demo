"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { initials, MEMBER_MENU, MEMBER_NAV, NAV, RITAA } from "@/lib/site";

import RitLogo from "./rit-logo";

/**
 * Site header.
 *
 * Frosted glass: a translucent bone surface over `backdrop-blur-xl` with a touch
 * of saturation, so the convocation photograph behind the masthead reads through
 * it as colour rather than detail. The bar starts borderless and gains its rule
 * and shadow only once the page has scrolled — at rest it sits on the hero
 * without cutting a line across it.
 *
 * The signed-in bar is a different bar. Network and Messages appear with live
 * counts, and the Join button becomes the member's own avatar menu. A header that
 * looks identical signed in and signed out is a header that never tells anyone
 * something happened while they were away — and on a network, something happening
 * while you were away is the entire point.
 */

/** One nav link, with the active underline the bar has always used. */
function NavLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href as never}
      aria-current={active ? "page" : undefined}
      className={`relative rounded-sm px-3 py-2 text-[0.875rem] transition-colors ${
        active ? "text-maroon" : "text-ink/75 hover:text-maroon"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {badge !== undefined && badge > 0 ? (
          <span className="count-badge" aria-label={`${badge} new`}>
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      {active ? (
        <span
          aria-hidden
          className="absolute inset-x-3 bottom-1 block h-px bg-maroon"
        />
      ) : null}
    </Link>
  );
}

/** The member's own menu. Replaces the Join button once a session exists. */
function AccountMenu() {
  const router = useRouter();
  const user = useQuery(api.auth.getCurrentUser);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape, so the menu never traps focus or
  // stays open behind a navigation.
  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = user?.name ?? "";
  const email = user?.email ?? "";
  const image = (user as { image?: string | null } | null | undefined)?.image;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Your account"
        className="flex size-10 items-center justify-center overflow-hidden rounded-chip border border-line bg-surface transition-colors hover:border-maroon"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" aria-hidden className="size-full object-cover" />
        ) : (
          <span className="font-mono text-[0.7rem] text-ink">
            {initials(name || email || "?")}
          </span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-60 rounded-card border border-line bg-surface p-1.5 shadow-lift"
        >
          <div className="border-b border-line px-3 pb-3 pt-2">
            <p className="truncate text-[0.9rem] text-ink">{name || "Your account"}</p>
            <p className="font-mono mt-0.5 truncate text-[0.7rem] text-slate-ink">
              {email}
            </p>
          </div>
          {MEMBER_MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href as never}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center rounded-[6px] px-3 text-[0.875rem] text-ink/85 transition-colors hover:bg-bone hover:text-maroon"
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void authClient.signOut({
                fetchOptions: { onSuccess: () => router.push("/") },
              });
            }}
            className="mt-1 flex min-h-10 w-full items-center rounded-[6px] border-t border-line px-3 text-left text-[0.875rem] text-maroon transition-colors hover:bg-maroon-tint"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The member-only links. Its own component so the counts load with them. */
function MemberLinks({ pathname }: { pathname: string }) {
  const pending = useQuery(api.network.pendingCount);
  const unread = useQuery(api.messaging.unreadCount);
  const moderation = useQuery(api.communities.moderationCount);

  const counts: Record<string, number | undefined> = {
    connections: pending,
    messages: unread,
    moderation,
  };

  return (
    <>
      {MEMBER_NAV.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          active={pathname.startsWith(item.href)}
          badge={item.counter ? counts[item.counter] : undefined}
        />
      ))}
    </>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Close the mobile sheet on navigation so the menu never traps the user.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    // passive: this listener never calls preventDefault, so the browser can
    // keep scrolling on its own thread.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-[background-color,box-shadow,border-color] duration-200 ${
        scrolled
          ? "border-b border-line/80 bg-bone/80 shadow-sticky backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-bone/40 backdrop-blur-lg backdrop-saturate-150"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-2.5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <RitLogo className="size-10" />
          <span className="leading-none">
            <span className="font-display block text-lg tracking-tight text-ink">
              {RITAA.shortName}
            </span>
            <span className="font-mono block text-[0.6rem] uppercase tracking-[0.16em] text-slate-ink">
              Estd {RITAA.established}
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center xl:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              active={
                pathname === item.href || pathname.startsWith(`${item.href}/`)
              }
            />
          ))}
          <Authenticated>
            <span aria-hidden className="mx-2 h-5 w-px bg-line-strong" />
            <MemberLinks pathname={pathname} />
          </Authenticated>
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:ml-3">
          <Unauthenticated>
            <Link
              href="/join"
              className="font-mono hidden min-h-11 items-center rounded-control bg-maroon px-4 text-[0.7rem] uppercase tracking-[0.12em] text-bone shadow-panel transition-colors hover:bg-maroon-deep sm:inline-flex"
            >
              Join RITAA
            </Link>
          </Unauthenticated>
          <Authenticated>
            <AccountMenu />
          </Authenticated>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex size-11 items-center justify-center rounded-control border border-ink/20 xl:hidden"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4 stroke-ink"
              strokeWidth="1.5"
              fill="none"
              aria-hidden
            >
              {open ? (
                <path d="M3 3l10 10M13 3L3 13" />
              ) : (
                <path d="M2 4h12M2 8h12M2 12h12" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="site-menu"
          className="border-t border-line/70 bg-bone/95 backdrop-blur-xl xl:hidden"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 px-5 py-2 sm:px-8">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 items-center text-[0.9rem] text-ink/80"
              >
                {item.label}
              </Link>
            ))}
            <Authenticated>
              <MemberLinks pathname={pathname} />
            </Authenticated>
            <Unauthenticated>
              <Link
                href="/join"
                className="flex min-h-11 items-center text-[0.9rem] text-maroon"
              >
                Join RITAA
              </Link>
            </Unauthenticated>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
