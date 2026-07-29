"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { NAV, RITAA } from "@/lib/site";

import RitLogo from "./rit-logo";

/**
 * Site header.
 *
 * Frosted glass: a translucent bone surface over `backdrop-blur-xl` with a touch
 * of saturation, so the convocation photograph behind the masthead reads through
 * it as colour rather than detail. The bar starts borderless and gains its rule
 * and shadow only once the page has scrolled — at rest it sits on the hero
 * without cutting a line across it.
 */
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
          ? "border-b border-line/80 bg-bone/75 shadow-[0_1px_20px_-8px_rgb(20_25_43/0.35)] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-bone/40 backdrop-blur-lg backdrop-saturate-150"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-2.5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
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

        <nav className="ml-auto hidden items-center lg:flex">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-sm px-3 py-2 text-[0.875rem] transition-colors ${
                  active ? "text-maroon" : "text-ink/75 hover:text-maroon"
                }`}
              >
                {item.label}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-1 block h-px bg-maroon"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <Link
            href="/join"
            className="font-mono hidden min-h-11 items-center bg-maroon px-4 text-[0.7rem] uppercase tracking-[0.12em] text-bone transition-colors hover:bg-maroon-deep sm:inline-flex"
          >
            Join RITAA
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex size-11 items-center justify-center border border-ink/20 lg:hidden"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4 stroke-ink"
              strokeWidth="1.5"
              aria-hidden
            >
              {open ? <path d="M3 3l10 10M13 3L3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="site-menu"
          className="border-t border-line/70 bg-bone/95 backdrop-blur-xl lg:hidden"
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
            <Link
              href="/join"
              className="flex min-h-11 items-center text-[0.9rem] text-maroon"
            >
              Join RITAA
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
