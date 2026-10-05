"use client";

import { api, useQuery, type FunctionReturnType } from "@/lib/standalone";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import {
  Button,
  Card,
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
import { formatDate, OFFICE_BEARERS, RITAA } from "@/lib/site";

/**
 * Module 9 — "Profile Viewing & Contacting": the full venture profile.
 *
 * The feed at /race gives a card. This page gives the whole record the brief
 * asks for — every field an established founder publishes (name, age, contact,
 * business category, website, description, product images) or every field an
 * upcoming founder publishes, with the "Upcoming" status stated rather than
 * implied — plus the four reasons the brief says a visitor should be able to
 * write about, each as its own pre-filled message.
 *
 * `raceProfiles.byId` returns null unless the venture is approved, so an
 * unapproved submission is not viewable here even by someone holding its id.
 */

type Venture = NonNullable<FunctionReturnType<typeof api.raceProfiles.byId>>;
type Related = FunctionReturnType<typeof api.raceProfiles.related>[number];

/** The RACE coordinator, from the brief's contact table — never hardcoded. */
const COORDINATOR =
  OFFICE_BEARERS.find((person) => person.designation === "Coordinator - RACE") ??
  OFFICE_BEARERS[2];

/**
 * The brief's four reasons to make contact. Each one writes its own subject and
 * its own opening line, so the founder can tell what a message is for before
 * reading it, and the sender is not starting from a blank page.
 */
const OUTREACH = [
  {
    id: "collaboration",
    label: "Collaboration",
    blurb: "A partnership, a joint bid, a shared supplier, a co-marketing idea.",
    line: "I am writing about a possible collaboration or partnership.",
  },
  {
    id: "mentoring",
    label: "Mentoring",
    blurb: "Time on one decision you are stuck on — not an open-ended chat.",
    line: "I would like to ask for mentoring on one specific decision I am stuck on.",
  },
  {
    id: "vendor",
    label: "Vendor information",
    blurb: "Who they buy from, what it cost, and what went wrong the first time.",
    line: "I am looking for vendor and supplier information in this category.",
  },
  {
    id: "startup-help",
    label: "Startup help",
    blurb: "You are starting something in this space and need the operational detail.",
    line: "I am starting something in this space and need help with the operational detail.",
  },
] as const;

type Purpose = (typeof OUTREACH)[number];

/** Mirrors kit.tsx's outline Button, as an anchor — mailto, tel and external
 *  links are not routes and must not go through next/link. */
const ACTION =
  "font-mono inline-flex items-center justify-center gap-2 border border-ink/25 px-4 py-2 text-[0.7rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-maroon hover:text-maroon";

const LINK =
  "text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function telHref(contact: string) {
  return `tel:${contact.replace(/\s+/g, "")}`;
}

/**
 * True only for an absolute http(s) address.
 *
 * `productImageUrls` is a plain string array, so it can hold anything a
 * coordinator types — a slug, a filename, a note. Nothing is put in an `<img>`
 * or an `href` until it parses as a real web address, which is what stops the
 * page from rendering broken images or `href="product-1"` links. When genuine
 * URLs are added to the field the gallery below starts using them with no code
 * change.
 */
function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function usableImages(values: readonly string[]) {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  const usable = cleaned.filter(isHttpUrl);
  return { usable, rejected: cleaned.length - usable.length };
}

/** Pre-filled outreach for one of the brief's four reasons. */
function outreachMailto(venture: Venture, purpose: Purpose) {
  const subject = `RACE — ${purpose.label.toLowerCase()}: ${venture.businessName}`;
  const body = [
    `Hi ${firstNameOf(venture.founderName)},`,
    "",
    `I found ${venture.businessName} on the RITAA Entrepreneur Zone (RACE).`,
    purpose.line,
    "",
    ...(venture.lookingFor.length > 0
      ? [
          `You listed that you are looking for: ${venture.lookingFor.join(", ")}.`,
          "",
        ]
      : []),
    "What I can bring to it:",
    "",
    "",
    `— sent from the RITAA Entrepreneur Zone, ${RITAA.website}`,
  ].join("\n");

  return `mailto:${venture.founderEmail}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/** Asks the coordinator for an introduction, for founders with no phone listed. */
function coordinatorMailto(venture: Venture) {
  const subject = `RACE — introduction to ${venture.founderName} (${venture.businessName})`;
  const body = [
    `Dear ${firstNameOf(COORDINATOR.name)},`,
    "",
    `I would like an introduction to ${venture.founderName} of ${venture.businessName}, listed on the RACE community feed.`,
    "",
    "What I want to discuss:",
    "",
    "",
    "Thank you,",
  ].join("\n");
  return `mailto:${COORDINATOR.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/* ------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* ------------------------------------------------------------------------- */

/** Headed block, matching the profile idiom used across the portal. */
function Block({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display mt-1.5 text-xl leading-snug text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** One labelled field of the published profile. */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3 last:border-b-0">
      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-[0.875rem] text-ink">
        {children}
      </dd>
    </div>
  );
}

/** The standard line for a field the founder chose not to publish. */
function NotGiven({ children }: { children: string }) {
  return (
    <span className="font-mono text-[0.72rem] text-slate-ink">{children}</span>
  );
}

/**
 * Product images.
 *
 * Real http(s) URLs are rendered as images. Anything else in the field is
 * ignored and counted, and the founder gets the labelled placeholder plus the
 * address to email photographs to — there is no upload on the submit form yet,
 * and a silent empty box would read as a broken page rather than as a step the
 * association has not built.
 *
 * A plain `<img>` is deliberate: next/image would need every founder's image
 * host added to `next.config.ts` before it would render, which is exactly the
 * code change this path is meant to avoid.
 */
function ProductImages({ venture }: { venture: Venture }) {
  const { usable, rejected } = usableImages(venture.productImageUrls);

  if (usable.length > 0) {
    return (
      <div>
        <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
          {usable.map((url, index) => (
            <li key={url} className="bg-white">
              <img
                src={url}
                alt={`${venture.businessName} — product photograph ${index + 1}`}
                loading="lazy"
                decoding="async"
                className="aspect-[4/3] w-full object-cover"
              />
            </li>
          ))}
        </ul>
        <p className="font-mono mt-3 text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
          <span className="tabular-nums">{usable.length}</span> image
          {usable.length === 1 ? "" : "s"} published by the founder
          {rejected > 0 ? (
            <>
              {" · "}
              <span className="tabular-nums">{rejected}</span> entr
              {rejected === 1 ? "y" : "ies"} on file{" "}
              {rejected === 1 ? "is" : "are"} not a web address and{" "}
              {rejected === 1 ? "is" : "are"} not shown
            </>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-px bg-line" aria-hidden>
        {[0, 1, 2].map((slot) => (
          <div
            key={slot}
            className="flex aspect-[4/3] items-center justify-center bg-bone-deep"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, var(--color-line) 0 1px, transparent 1px 8px)",
            }}
          >
            <span className="font-mono text-[0.62rem] tabular-nums text-slate-ink">
              0{slot + 1}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
        No product photographs are on file for this venture yet
        {rejected > 0 ? (
          <>
            {" — "}
            <span className="tabular-nums">{rejected}</span> entr
            {rejected === 1 ? "y" : "ies"} in the field{" "}
            {rejected === 1 ? "is" : "are"} not a web address, so{" "}
            {rejected === 1 ? "it is" : "they are"} not shown
          </>
        ) : null}
        . The submit form has no upload step, so until one is wired the founder
        emails up to six photographs to{" "}
        <a
          href={`mailto:${COORDINATOR.email}?subject=${encodeURIComponent(
            `RACE — product images for ${venture.businessName}`,
          )}`}
          className={LINK}
        >
          {COORDINATOR.email}
        </a>{" "}
        and the coordinator attaches them to this profile. These slots then fill
        in on their own.
      </p>
    </div>
  );
}

/** A peer venture in the same category. */
function RelatedCard({ venture }: { venture: Related }) {
  const isIdea = venture.stage === "upcoming";
  return (
    <li className={cx("p-6", isIdea ? "bg-bone" : "bg-white")}>
      <div className="flex flex-wrap items-center gap-2">
        {isIdea ? (
          <Pill tone="brass">Upcoming</Pill>
        ) : (
          <Pill tone="maroon">Established</Pill>
        )}
        <Pill>{venture.location}</Pill>
      </div>
      <h3 className="font-display mt-3 text-lg leading-snug text-ink">
        {/* Link's href generic cannot express a dynamic segment; the URL-object
            form can. Same idiom as the directory listing. */}
        <Link
          href={{ pathname: `/race/${venture.ventureId}` }}
          className="transition-colors hover:text-maroon"
        >
          {venture.businessName}
        </Link>
      </h3>
      <p className="mt-1 text-[0.85rem] text-ink">{venture.founderName}</p>
      <p className="mt-2.5 line-clamp-4 text-[0.85rem] leading-relaxed text-slate-ink">
        {venture.description}
      </p>
      {venture.offersHelp.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {venture.offersHelp.slice(0, 3).map((topic) => (
            <Pill key={topic} tone="jade">
              {topic}
            </Pill>
          ))}
        </div>
      ) : null}
      <div className="mt-5 border-t border-line pt-4">
        <Button
          href={{ pathname: `/race/${venture.ventureId}` }}
          variant="outline"
        >
          View full profile
        </Button>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------- */
/* Page                                                                       */
/* ------------------------------------------------------------------------- */

export default function VentureProfilePage() {
  const params = useParams<{ id: string }>();
  const ventureId = typeof params?.id === "string" ? params.id : "";

  const venture = useQuery(api.raceProfiles.byId, { ventureId });
  const related = useQuery(api.raceProfiles.related, { ventureId });

  /* ---- Loading. undefined and null are kept strictly apart so the
          not-found state never flashes over a query still in flight. ------ */
  if (venture === undefined) {
    return (
      <>
        <PageHeader
          module="Module 09 · Entrepreneur Zone · Venture profile"
          title="Loading the venture"
          lede="Fetching the founder's published profile from the RACE register."
        />
        <Shell>
          <section className="py-16 sm:py-20" aria-busy>
            <LoadingRows rows={5} />
          </section>
        </Shell>
      </>
    );
  }

  /* ---- Not approved, not found, or a malformed id. All one state: the
          page cannot distinguish them, and neither can anyone probing. --- */
  if (venture === null) {
    return (
      <>
        <PageHeader
          module="Module 09 · Entrepreneur Zone · Venture profile"
          title="That profile is not published"
          lede="Either no venture is registered at this address, or the submission is still with the RACE coordinator for review."
        />
        <Shell>
          <section className="py-16 sm:py-20">
            <Empty
              title="No published venture at this address"
              hint="Submissions stay invisible until the coordinator approves them, so a venture that was registered a moment ago will not open yet. The community feed lists every approved venture."
              action={<Button href="/race">Back to the community feed</Button>}
            />
            <p className="mt-8 text-center text-[0.85rem] leading-relaxed text-slate-ink">
              If this is your own submission and you think it should be live,
              write to {COORDINATOR.name} at{" "}
              <a href={`mailto:${COORDINATOR.email}`} className={LINK}>
                {COORDINATOR.email}
              </a>
              .
            </p>
          </section>
        </Shell>
      </>
    );
  }

  return <VentureProfile venture={venture} related={related} />;
}

function VentureProfile({
  venture,
  related,
}: {
  venture: Venture;
  related: Related[] | undefined;
}) {
  const isIdea = venture.stage === "upcoming";
  const websiteIsUsable = Boolean(venture.website && isHttpUrl(venture.website));
  const peers = related ?? [];

  return (
    <>
      {/* ---- Masthead ---------------------------------------------------- */}
      <PageHeader
        module="Module 09 · Entrepreneur Zone · Venture profile"
        title={venture.businessName}
        lede={
          isIdea
            ? `An idea at Upcoming status from ${venture.founderName}, in ${venture.category}, based in ${venture.location}. This founder is not trading yet and is asking the association for guidance.`
            : `${venture.founderName} runs this ${venture.category.toLowerCase()} business from ${venture.location}. The full profile is below, along with four ways to write to the founder.`
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <Monogram name={venture.founderName} size="lg" tone="brass" />
          <div className="flex flex-wrap items-center gap-2">
            {isIdea ? (
              <Pill tone="brass">Status · Upcoming</Pill>
            ) : (
              <Pill tone="brass">Status · Established</Pill>
            )}
            <Pill tone="dark">{venture.category}</Pill>
            <Pill tone="dark">{venture.location}</Pill>
            {venture.founderBatch ? (
              <Pill tone="dark">
                <span className="tabular-nums">Batch {venture.founderBatch}</span>
              </Pill>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button href="#contact" variant="onDark">
            {isIdea ? "Offer this founder guidance" : "Contact the founder"}
          </Button>
          {websiteIsUsable && venture.website ? (
            <a
              href={venture.website}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono inline-flex items-center gap-2 border border-white/25 px-4 py-2 text-[0.7rem] uppercase tracking-[0.12em] text-bone transition-colors hover:border-brass-soft hover:text-brass-soft"
            >
              {hostOf(venture.website)} ↗
            </a>
          ) : null}
          <Button
            href="/race#feed"
            variant="ghost"
            className="!text-brass-soft hover:!text-bone"
          >
            ← Back to the community feed
          </Button>
        </div>
      </PageHeader>

      {/* ---- The four facts, in mono ------------------------------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-4">
            <Stat
              value={isIdea ? "Upcoming" : "Established"}
              label={
                isIdea
                  ? "Status the founder registered"
                  : "Status — trading today"
              }
            />
            <Stat value={venture.category} label="Business category" />
            <Stat
              value={venture.age ?? "—"}
              label={venture.age ? "Age of the founder" : "Age not stated"}
            />
            <Stat
              value={formatDate(venture.createdAt)}
              label={isIdea ? "Idea posted" : "Listed on RACE"}
            />
          </div>
        </Shell>
      </section>

      <Shell>
        <section className="py-12 sm:py-16">
          <Link
            href="/race"
            className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-brass transition-colors hover:text-maroon"
          >
            ← Entrepreneur Zone
          </Link>

          {/* ---- Status, stated rather than implied -------------------- */}
          <div
            className={cx(
              "mt-6 border p-5",
              isIdea
                ? "border-dashed border-brass/45 bg-bone"
                : "border-line bg-white",
            )}
          >
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-brass">
              {isIdea ? "Status · Upcoming" : "Status · Established"}
            </p>
            <p className="mt-2 text-[0.9rem] leading-relaxed text-ink">
              {isIdea
                ? "This founder registered as an Upcoming Entrepreneur: the venture is an idea or a prototype, not a trading business. The most useful reply is one specific contact, document or number."
                : "This founder registered as an Established Entrepreneur, so the business profile below is the one they publish to the association: buy from them, partner with them, or send them a vendor."}
            </p>
          </div>

          <div className="mt-12 grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
            {/* ---- The published record ------------------------------- */}
            <div className="space-y-10">
              <Block
                eyebrow={isIdea ? "Upcoming entrepreneur" : "Established entrepreneur"}
                title={isIdea ? "The founder and the idea" : "Business profile"}
              >
                <dl className="border-t border-line">
                  <FieldRow label="Name">{venture.founderName}</FieldRow>
                  <FieldRow label="Age">
                    {venture.age ? (
                      <span className="tabular-nums">{venture.age}</span>
                    ) : (
                      <NotGiven>Not stated by the founder</NotGiven>
                    )}
                  </FieldRow>
                  <FieldRow label="Contact">
                    {venture.contact ? (
                      <a
                        href={telHref(venture.contact)}
                        className={cx(LINK, "tabular-nums")}
                      >
                        {venture.contact}
                      </a>
                    ) : (
                      <NotGiven>No phone published — email instead</NotGiven>
                    )}
                  </FieldRow>
                  <FieldRow label="Email">
                    <a href={`mailto:${venture.founderEmail}`} className={LINK}>
                      {venture.founderEmail}
                    </a>
                  </FieldRow>
                  <FieldRow label="Business category">{venture.category}</FieldRow>
                  <FieldRow label="Website">
                    {websiteIsUsable && venture.website ? (
                      <a
                        href={venture.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK}
                      >
                        {hostOf(venture.website)} ↗
                      </a>
                    ) : venture.website ? (
                      <NotGiven>
                        On file, but not a usable web address
                      </NotGiven>
                    ) : (
                      <NotGiven>No website listed</NotGiven>
                    )}
                  </FieldRow>
                  <FieldRow label="Operates from">{venture.location}</FieldRow>
                  <FieldRow label="Graduating batch">
                    {venture.founderBatch ? (
                      <span className="tabular-nums">{venture.founderBatch}</span>
                    ) : (
                      <NotGiven>Not stated</NotGiven>
                    )}
                  </FieldRow>
                  <FieldRow label="Status">
                    {isIdea ? "Upcoming" : "Established"}
                  </FieldRow>
                </dl>
              </Block>

              <Block
                eyebrow={isIdea ? "In the founder's words" : "Business description"}
                title={isIdea ? "What the idea is" : "What the business does"}
              >
                <p className="max-w-2xl text-[0.975rem] leading-relaxed text-slate-ink">
                  {venture.description}
                </p>
              </Block>

              {/* Product images are a field the brief asks of established
                  founders, so the slot is always shown for them. For an
                  upcoming founder there is nothing to photograph yet, and the
                  block appears only if images do exist. */}
              {!isIdea || usableImages(venture.productImageUrls).usable.length > 0 ? (
                <Block eyebrow="Product images" title="What they make">
                  <ProductImages venture={venture} />
                </Block>
              ) : null}

              <Block
                eyebrow={isIdea ? "Guidance needed" : "Looking for"}
                title={
                  isIdea
                    ? "What this founder is asking for"
                    : "What this business is looking for"
                }
              >
                {venture.lookingFor.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {venture.lookingFor.map((item) => (
                      <Pill key={item} tone="brass">
                        {item}
                      </Pill>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.9rem] leading-relaxed text-slate-ink">
                    Nothing listed yet. Ask what stage the venture is at before
                    offering anything specific.
                  </p>
                )}
              </Block>

              {venture.offersHelp.length > 0 ? (
                <Block
                  eyebrow="Supportive community"
                  title="What this founder will help others with"
                >
                  <div className="flex flex-wrap gap-1.5">
                    {venture.offersHelp.map((item) => (
                      <Pill key={item} tone="jade">
                        {item}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-4 text-[0.875rem] leading-relaxed text-slate-ink">
                    These are the topics {firstNameOf(venture.founderName)} listed
                    on their own profile, which is what puts them on the community
                    help board in the{" "}
                    <Link href="/race#community" className={LINK}>
                      Entrepreneur Zone
                    </Link>
                    . Mentioning one of them in your first message gets a faster
                    reply than a general introduction.
                  </p>
                </Block>
              ) : null}
            </div>

            {/* ---- Contacting ---------------------------------------- */}
            <div className="space-y-4">
              {/* kit's Card takes no id, so the anchor sits on the wrapper. */}
              <div id="contact">
                <Card>
                  <Eyebrow>Reach out</Eyebrow>
                  <h2 className="font-display mt-1.5 text-xl leading-snug text-ink">
                    Write to {firstNameOf(venture.founderName)}
                  </h2>
                  <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
                    Pick the reason. Each opens an email to the founder with the
                    subject and the first line already written, so they can tell
                    what it is about before opening it. RITAA does not relay
                    messages on a founder&rsquo;s behalf.
                  </p>

                  <ul className="mt-5 space-y-px bg-line">
                    {OUTREACH.map((purpose) => (
                      <li key={purpose.id} className="bg-white py-4 first:pt-0">
                        <a
                          href={outreachMailto(venture, purpose)}
                          className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
                        >
                          {purpose.label} →
                        </a>
                        <p className="mt-1.5 text-[0.82rem] leading-snug text-slate-ink">
                          {purpose.blurb}
                        </p>
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-6 border-t border-line">
                    <FieldRow label="Email">
                      <a href={`mailto:${venture.founderEmail}`} className={LINK}>
                        {venture.founderEmail}
                      </a>
                    </FieldRow>
                    <FieldRow label="Phone">
                      {venture.contact ? (
                        <a
                          href={telHref(venture.contact)}
                          className={cx(LINK, "tabular-nums")}
                        >
                          {venture.contact}
                        </a>
                      ) : (
                        <NotGiven>Not published</NotGiven>
                      )}
                    </FieldRow>
                    <FieldRow label="Website">
                      {websiteIsUsable && venture.website ? (
                        <a
                          href={venture.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={LINK}
                        >
                          {hostOf(venture.website)} ↗
                        </a>
                      ) : (
                        <NotGiven>Not published</NotGiven>
                      )}
                    </FieldRow>
                  </dl>
                </Card>
              </div>

              <Card>
                <div className="flex items-start gap-4">
                  <Monogram name={COORDINATOR.name} size="md" tone="brass" />
                  <div className="min-w-0">
                    <Eyebrow>RACE is coordinated by</Eyebrow>
                    <p className="font-display mt-1 text-lg leading-snug text-ink">
                      {COORDINATOR.name}
                    </p>
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-brass">
                      {COORDINATOR.designation}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-[0.85rem] leading-relaxed text-slate-ink">
                  Write to the coordinator for an introduction if the founder has
                  not published a phone number, for a correction to this profile,
                  or to send product photographs for the gallery.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
                  <a href={coordinatorMailto(venture)} className={ACTION}>
                    Ask for an introduction
                  </a>
                  <a
                    href={telHref(COORDINATOR.phone)}
                    className="font-mono text-[0.7rem] tabular-nums text-slate-ink transition-colors hover:text-ink"
                  >
                    {COORDINATOR.phone}
                  </a>
                </div>
              </Card>

              <Card>
                <Eyebrow>Before you write</Eyebrow>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
                  RACE is not a funding portal and the association does not
                  invest. Most useful exchanges here are one piece of operational
                  knowledge — which body certifies a part, how a licence is
                  actually issued, what a first export invoice looks like.
                  Answering one of those is a bigger favour than it sounds.
                </p>
              </Card>
            </div>
          </div>
        </section>
      </Shell>

      {/* ---- Discovery: peers in the same category ---------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow={`More in ${venture.category}`}
            title="Others working in the same category"
            lede="Established businesses first, then ideas. The point of a category is to find the person who has already solved what you are about to hit."
            action={
              <Button href="/race#feed" variant="outline">
                Whole community feed
              </Button>
            }
          />

          {related === undefined ? (
            <LoadingRows rows={2} />
          ) : peers.length === 0 ? (
            <Empty
              title={`This is the only venture registered in ${venture.category}`}
              hint="Nobody else has registered under this category yet, so there is no rail to show. The two places that do have depth are the feed, which you can filter by any industry the community has registered, and the community help board, which is organised by topic rather than by industry."
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Button href="/race#feed">Browse every venture</Button>
                  <Button href="/race#community" variant="outline">
                    Community help board
                  </Button>
                </div>
              }
            />
          ) : (
            <ul className="grid gap-px bg-line md:grid-cols-2 lg:grid-cols-3">
              {peers.map((peer) => (
                <RelatedCard key={peer.ventureId} venture={peer} />
              ))}
            </ul>
          )}
        </Shell>
      </section>

      {/* ---- Back out --------------------------------------------------- */}
      <section className="border-t border-line bg-white">
        <Shell className="py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-[0.9rem] text-slate-ink">
              Every approved venture in the association, established businesses
              and upcoming ideas together.
            </p>
            <Link
              href="/race#feed"
              className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-maroon transition-colors hover:text-maroon-deep"
            >
              ← Entrepreneur Zone
            </Link>
          </div>
        </Shell>
      </section>
    </>
  );
}
