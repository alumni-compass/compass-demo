import Link from "next/link";

import { Eyebrow, Shell } from "@/components/kit";
import RitLogo from "@/components/rit-logo";
import { NAV, OFFICE_BEARERS, RITAA } from "@/lib/site";

export default function SiteFooter() {
  return (
    <footer className="ink-weave border-t border-white/10">
      <Shell className="py-16">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-3">
              <RitLogo className="size-12" />
              <div>
                <div className="font-display text-2xl text-bone">
                  {RITAA.shortName}
                </div>
                <p className="font-mono mt-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-brass-soft">
                  Estd {RITAA.established}
                </p>
              </div>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-bone/65">
              {RITAA.name}
            </p>
            <address className="mt-5 not-italic text-sm leading-relaxed text-bone/65">
              {RITAA.institute}
              <br />
              {RITAA.address}
            </address>
          </div>

          <div>
            <Eyebrow tone="bone">Sections</Eyebrow>
            <ul className="mt-4 space-y-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-bone/70 transition-colors hover:text-brass-soft"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Eyebrow tone="bone">Office bearers</Eyebrow>
            <ul className="mt-4 space-y-4">
              {OFFICE_BEARERS.map((person) => (
                <li key={person.email}>
                  <div className="text-sm text-bone">{person.name}</div>
                  <div className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-brass-soft">
                    {person.designation}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[0.8rem] text-bone/60">
                    <a
                      href={`mailto:${person.email}`}
                      className="transition-colors hover:text-brass-soft"
                    >
                      {person.email}
                    </a>
                    <a
                      href={`tel:+91${person.phone}`}
                      className="font-mono tabular-nums transition-colors hover:text-brass-soft"
                    >
                      {person.phone}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <div className="font-mono flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-bone/55">
            <a href={`tel:04563233400`} className="tabular-nums hover:text-brass-soft">
              {RITAA.phone}
            </a>
            <a href={`mailto:${RITAA.email}`} className="hover:text-brass-soft">
              {RITAA.email}
            </a>
            <span>{RITAA.website}</span>
          </div>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-bone/40">
            Ramco Institute of Technology Alumni Association
          </p>
        </div>
      </Shell>
    </footer>
  );
}
