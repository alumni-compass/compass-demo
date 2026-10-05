import type { Metadata } from "next";

import {
  Button,
  Card,
  Eyebrow,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import {
  BATCH_YEARS,
  DEPARTMENT_NAMES,
  OFFICE_BEARERS,
  RITAA,
} from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `${RITAA.name} — established ${RITAA.established} at ${RITAA.institute}.`,
};

/**
 * The association's own page. No hooks, so it stays a server component and ships
 * no client JavaScript at all.
 *
 * Every contact detail here comes from the RITAA constants, which are taken
 * verbatim from the association's brief. The module list and the security note
 * describe what is actually built versus what is still an intention — that
 * distinction is the point of the page, not a caveat on it.
 */

/** The twelve modules of the brief, each with one honest line. */
const MODULES = [
  {
    n: "01",
    name: "User roles & access",
    line: "Sign-in is Google or LinkedIn, and nothing else — a provider-confirmed identity is a better starting point for a members' directory than a self-declared address. Both switch on once the association adds their credentials, and until one is set nobody can sign in. The four-role access model is defined but not yet enforced in code.",
  },
  {
    n: "02",
    name: "Alumni profiles",
    line: "Batch, department, designation, employer, region, skills and industries — with a per-field visibility list the server honours before anything is sent to a browser.",
  },
  {
    n: "03",
    name: "Alumni directory",
    line: "Search by name with filters for batch, department, company and region, running on a Convex search index. Connecting is a real mutual edge, not a mail draft: ask, they accept, and a direct thread opens. Where a member you know also knows the one you are viewing, the portal names them. The batch rail is the fastest way in.",
  },
  {
    n: "04",
    name: "Career hub",
    line: "Alumni post full-time roles, internships and contracts, and can mark a post as one they will personally refer for. Posts stay listed while marked active.",
  },
  {
    n: "05",
    name: "Mentorship network",
    line: "Mentors are alumni who opted in and named their topics, so there is no second profile to maintain. Students and alumni request a slot against one specific question.",
  },
  {
    n: "06",
    name: "News, stories & gallery",
    line: "Success stories, achievements, event recaps and newsletter issues, plus year-wise media albums from Sangamam and the sports league.",
  },
  {
    n: "07",
    name: "Event management",
    line: "Reunions, webinars, sports and networking events. RSVP is idempotent per email address and respects capacity, so headcounts stay honest.",
  },
  {
    n: "08",
    name: "Fundraising & giving",
    line: "Campaigns with a goal, a donor wall that counts anonymous gifts without naming them, and a usage tracker showing what each allocation paid for. Gifts are written from a confirmed payment webhook, never straight from the browser.",
  },
  {
    n: "09",
    name: "Entrepreneur zone (RACE)",
    line: "Established founders publish a business profile; anyone with an idea marks themselves upcoming and asks for the specific help they need. Submissions stay unapproved until the association reviews them.",
  },
  {
    n: "10",
    name: "Admin panel",
    line: "A live, read-only dashboard of members, published content and campaign performance, with working CSV exports. Moderation actions, notifications and the admin-only route guard are still to be wired.",
  },
  {
    n: "11",
    name: "Mobile optimisation",
    line: "Every page is laid out mobile-first and works down to a small phone in a browser. Messages collapse to one pane at a time on a phone rather than squeezing two columns. The Expo app in native/ shares this backend but is not built out.",
  },
  {
    n: "12",
    name: "Security & compliance",
    line: "Transport encryption, server-side field redaction and a written access model. Activity logging and formal data-protection work sit with the association — details below.",
  },
];

const IN_PLACE = [
  {
    t: "Encrypted in transit",
    c: "The portal is served over HTTPS with TLS terminated by the hosting platform, and the Convex client connects over a secure WebSocket. No page on this site accepts credentials over plain HTTP.",
  },
  {
    t: "Per-field visibility, enforced on the server",
    c: "The directory redacts hidden fields inside the Convex query rather than in the browser. If a member hides a phone number or a LinkedIn URL, that value is never sent to any client — hiding it is not a CSS trick.",
  },
  {
    t: "Credentials handled by better-auth",
    c: "Passwords are hashed and sessions issued by better-auth. The association never stores or sees a member's password, and nothing in the portal logs one.",
  },
  {
    t: "Connections and messages never publish an address",
    c: "Asking to connect names the member by their directory id, never by email, and the address is resolved on the server — so a member who keeps their address private is exactly as reachable as one who publishes it. Messaging carries the conversation instead of handing over a phone number, and removing a connection closes the thread while leaving the history readable to both sides.",
  },
  {
    t: "No third-party trackers or image hosts",
    c: "Member avatars are monograms drawn in the page and the crest is a single static image served from this site, so the directory needs no external image host. Type is the platform's own system font, so no webfont is downloaded at all, and no analytics script is loaded — nothing on this site reports back who is reading what.",
  },
];

const COMMITMENTS = [
  {
    t: "Role-based access enforcement",
    c: "The four roles in the brief are documented on the join page, but route-level gating and an admin-only query wrapper still have to be added. The admin panel is unauthenticated until that lands.",
  },
  {
    t: "Activity logging and audit trail",
    c: "Who verified a member, approved a venture or unpublished a story should be recorded with a timestamp. That log does not exist yet and needs to accompany the first moderation mutation.",
  },
  {
    t: "GDPR-style data rights",
    c: "Data export, correction and erasure on request are association policy commitments. They are not implemented as self-service flows in the portal today — requests go to the secretary by email.",
  },
  {
    t: "ISO and formal certification",
    c: "The brief names ISO-aligned practice as an objective. To be plain about it: this portal holds no certification, and nothing here should be read as claiming one.",
  },
];

export default function AboutPage() {
  const departments = Object.entries(DEPARTMENT_NAMES);
  const firstBatch = BATCH_YEARS[0];
  const latestBatch = BATCH_YEARS[BATCH_YEARS.length - 1];

  return (
    <>
      <PageHeader
        module="About the association"
        title={RITAA.name}
        lede={RITAA.vision}
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="dark">Estd {RITAA.established}</Pill>
          <Pill tone="dark">{RITAA.institute}</Pill>
          <Pill tone="dark">Rajapalayam · Virudhunagar</Pill>
        </div>
      </PageHeader>

      {/* ---- Identity ---------------------------------------------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-4">
            <Stat value={RITAA.established} label="Association established" />
            <Stat value={departments.length} label="Departments represented" />
            <Stat
              value={`${String(firstBatch).slice(2)}–${String(latestBatch).slice(2)}`}
              label="Batches on the rail"
            />
            <Stat value={RITAA.shortName} label="Short name in use" />
          </div>
        </Shell>
      </section>

      {/* ---- Who we are -------------------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Identity"
            title="What RITAA is"
            lede="The alumni association of Ramco Institute of Technology, Rajapalayam — run by alumni volunteers, for every graduate of the institute."
          />
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
            <div>
              <dl className="divide-y divide-line border-y border-line">
                {[
                  { k: "Association", v: RITAA.name },
                  { k: "Short name", v: RITAA.shortName },
                  { k: "Established", v: String(RITAA.established) },
                  { k: "Institute", v: RITAA.institute },
                ].map((row) => (
                  <div
                    key={row.k}
                    className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6"
                  >
                    <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                      {row.k}
                    </dt>
                    <dd className="text-[0.95rem] leading-relaxed text-ink">
                      {row.v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <Card className="hover:border-line">
              <Eyebrow>Vision</Eyebrow>
              <p className="font-display mt-3 text-2xl leading-snug text-ink">
                {RITAA.vision}
              </p>
              <p className="mt-4 text-[0.9rem] leading-relaxed text-slate-ink">
                Four verbs, and the portal is organised around them: connect
                through the directory, collaborate through mentorship and RACE,
                contribute through giving and referrals, and grow through the
                career hub and events.
              </p>
              <div className="mt-6">
                <Button href="/join">Join the association</Button>
              </div>
            </Card>
          </div>
        </section>
      </Shell>

      {/* ---- Office bearers ---------------------------------------------- */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Office bearers"
            title="Who to write to"
            lede="These are the association's real contacts. Anything the portal cannot yet do — password resets, verification, venture approval — is done by one of these three people."
          />
          <ul className="grid gap-px bg-line lg:grid-cols-3">
            {OFFICE_BEARERS.map((person) => (
              <li key={person.email} className="bg-white p-7">
                <div className="flex items-start gap-4">
                  <Monogram name={person.name} size="lg" />
                  <div className="min-w-0">
                    <h3 className="font-display text-xl leading-snug text-ink">
                      {person.name}
                    </h3>
                    <p className="font-mono mt-1 text-[0.7rem] uppercase tracking-[0.12em] text-brass">
                      {person.designation}
                    </p>
                  </div>
                </div>
                <dl className="mt-5 space-y-3 border-t border-line pt-5">
                  <div>
                    <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
                      Email
                    </dt>
                    <dd className="mt-0.5 break-words text-[0.9rem]">
                      <a
                        href={`mailto:${person.email}`}
                        className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                      >
                        {person.email}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
                      Phone
                    </dt>
                    <dd className="mt-0.5 text-[0.9rem]">
                      <a
                        href={`tel:+91${person.phone}`}
                        className="font-mono tabular-nums text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                      >
                        +91 {person.phone}
                      </a>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </Shell>
      </section>

      {/* ---- Contact ----------------------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Contact"
            title="Reach the association"
            lede="One office, one mailbox. Calls are answered during institute working hours."
          />
          <div className="grid gap-px bg-line lg:grid-cols-[1.2fr_1fr]">
            <div className="bg-white p-7">
              <Eyebrow>Postal address</Eyebrow>
              <address className="mt-3 not-italic text-[1rem] leading-relaxed text-ink">
                {RITAA.name}
                <br />
                {RITAA.institute}
                <br />
                {RITAA.address}
              </address>
              <p className="mt-5 text-[0.875rem] leading-relaxed text-slate-ink">
                Verification documents, cheques and formal correspondence go to
                this address, addressed to the Secretary, {RITAA.shortName}.
              </p>
            </div>

            <div className="bg-white p-7">
              <Eyebrow>Direct lines</Eyebrow>
              <dl className="mt-3 divide-y divide-line">
                <div className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                  <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                    Phone
                  </dt>
                  <dd>
                    <a
                      href="tel:+914563233400"
                      className="font-mono text-[0.9rem] tabular-nums text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                    >
                      {RITAA.phone}
                    </a>
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                  <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                    Email
                  </dt>
                  <dd>
                    <a
                      href={`mailto:${RITAA.email}`}
                      className="break-all text-[0.9rem] text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                    >
                      {RITAA.email}
                    </a>
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                  <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                    Website
                  </dt>
                  <dd>
                    <a
                      href={`https://${RITAA.website}`}
                      className="break-all text-[0.9rem] text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                    >
                      {RITAA.website}
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </Shell>

      {/* ---- Departments ------------------------------------------------- */}
      <section className="border-y border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Departments"
            title="Seven departments, one association"
            lede="Membership is by graduation from the institute, not by department — but the directory, the batch rail and every report break down this way."
          />
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {departments.map(([code, name]) => (
              <li key={code} className="bg-bone-deep p-6">
                <span className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-brass">
                  {code}
                </span>
                <p className="mt-2 text-[0.95rem] leading-snug text-ink">{name}</p>
              </li>
            ))}
          </ul>
        </Shell>
      </section>

      {/* ---- The twelve modules ------------------------------------------ */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Scope"
            title="What the portal covers"
            lede="Twelve modules, as set out in the association's requirement brief. Each line below says what the module does today — including where it is unfinished."
          />
          <ol className="grid gap-px bg-line sm:grid-cols-2">
            {MODULES.map((module) => (
              <li key={module.n} className="bg-white p-7">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[0.72rem] tabular-nums tracking-[0.16em] text-brass">
                    {module.n}
                  </span>
                  <h3 className="font-display text-xl leading-snug text-ink">
                    {module.name}
                  </h3>
                </div>
                <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                  {module.line}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </Shell>

      {/* ---- Security & compliance --------------------------------------- */}
      <section className="border-t border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Module 12 · Security & compliance"
            title="What is protected, and by what"
            lede="Split deliberately into two columns. The left is enforced by code in this repository. The right is association policy that still has to be configured — reading it as a guarantee would be wrong."
          />
          <div className="grid gap-px bg-line lg:grid-cols-2">
            <div className="bg-white p-7">
              <div className="flex items-center justify-between gap-4">
                <Eyebrow>In place today</Eyebrow>
                <Pill tone="jade">Enforced in code</Pill>
              </div>
              <ul className="mt-5 divide-y divide-line">
                {IN_PLACE.map((item) => (
                  <li key={item.t} className="py-4 first:pt-0 last:pb-0">
                    <h3 className="text-[0.95rem] font-semibold leading-snug text-ink">
                      {item.t}
                    </h3>
                    <p className="mt-1.5 text-[0.875rem] leading-relaxed text-slate-ink">
                      {item.c}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-7">
              <div className="flex items-center justify-between gap-4">
                <Eyebrow>Association commitments</Eyebrow>
                <Pill tone="maroon">Not yet configured</Pill>
              </div>
              <ul className="mt-5 divide-y divide-line">
                {COMMITMENTS.map((item) => (
                  <li key={item.t} className="py-4 first:pt-0 last:pb-0">
                    <h3 className="text-[0.95rem] font-semibold leading-snug text-ink">
                      {item.t}
                    </h3>
                    <p className="mt-1.5 text-[0.875rem] leading-relaxed text-slate-ink">
                      {item.c}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-8 max-w-3xl text-[0.9rem] leading-relaxed text-slate-ink">
            If you believe a field of yours is visible when it should not be, write
            to{" "}
            <a
              href={`mailto:${RITAA.email}`}
              className="text-maroon underline decoration-brass/50 underline-offset-4"
            >
              {RITAA.email}
            </a>{" "}
            and it will be corrected before anything else on the backlog.
          </p>
        </Shell>
      </section>

      {/* ---- Close ------------------------------------------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 text-center sm:py-20">
          <Eyebrow>{RITAA.shortName}</Eyebrow>
          <p className="font-display mx-auto mt-4 max-w-3xl text-2xl leading-snug text-ink sm:text-[1.75rem]">
            An association is only as strong as the number of graduates who can be
            found in it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/join">Create your profile</Button>
            <Button href="/directory" variant="outline">
              Browse the directory
            </Button>
          </div>
          <p className="font-mono mt-10 text-[0.72rem] uppercase tracking-[0.14em] text-slate-ink">
            {RITAA.institute} · {RITAA.address}
          </p>
        </Shell>
      </section>
    </>
  );
}
