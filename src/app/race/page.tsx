"use client";

import { api } from "@convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";

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
import { BATCH_YEARS, formatDate, OFFICE_BEARERS, REGIONS } from "@/lib/site";

/**
 * Module 9 — Entrepreneur Zone, powered by RACE.
 *
 * The brief's two user types drive this whole page. Established founders publish
 * a business profile; upcoming founders publish an idea and an ask. They share
 * one feed so the second group can find the first, but they never share a card
 * treatment — a shopfront and a request for help should not look alike.
 */

type Venture = FunctionReturnType<typeof api.race.listVentures>[number];
type Stage = "established" | "upcoming";
type StageFilter = "all" | Stage;
type RoleResult = FunctionReturnType<typeof api.access.roleFor>;

/** The RACE coordinator, taken from the brief's contact table — never hardcoded. */
const COORDINATOR =
  OFFICE_BEARERS.find((person) => person.designation === "Coordinator - RACE") ??
  OFFICE_BEARERS[2];

/** Category suggestions for the submit form. The brief's own examples, plus
 *  whatever industries the community has already registered. */
const SUGGESTED_CATEGORIES = ["SaaS", "Food", "Fashion"];

const STAGE_FILTERS: Array<{ value: StageFilter; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "established", label: "Established" },
  { value: "upcoming", label: "Upcoming" },
];

const STAGE_CHOICES: Array<{ value: Stage; label: string; blurb: string }> = [
  {
    value: "established",
    label: "Established entrepreneur",
    blurb:
      "You are already trading. Publish the full business profile so alumni can buy from you, partner with you, or send you a vendor.",
  },
  {
    value: "upcoming",
    label: "Upcoming entrepreneur",
    blurb:
      "You have an idea or a prototype. Describe it, mark yourself Upcoming, and name the guidance you need.",
  },
];

const INPUT =
  "w-full border border-line bg-white px-3 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-ink/55 focus:border-maroon";

/** Mirrors kit.tsx's outline Button, as an anchor — mailto and tel are not routes. */
const ACTION =
  "font-mono inline-flex items-center justify-center gap-2 border border-ink/25 px-4 py-2 text-[0.7rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-maroon hover:text-maroon";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Comma-separated input → a clean, deduplicated, capped array. */
function parseList(raw: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === 8) break;
  }
  return out;
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Pre-filled outreach. The brief asks that founders be reachable for
 * collaboration, mentoring, vendor information and startup help — so the
 * message says which of those it is instead of making the sender start cold.
 */
function mailtoFor(venture: Venture) {
  const who = firstNameOf(venture.founderName);
  const isIdea = venture.stage === "upcoming";

  const subject = isIdea
    ? `RACE — help with "${venture.businessName}"`
    : `RACE — reaching out about ${venture.businessName}`;

  const body = isIdea
    ? [
        `Hi ${who},`,
        "",
        `I found your idea on the RITAA Entrepreneur Zone (RACE). I think I can help with:`,
        ...(venture.lookingFor.length > 0
          ? venture.lookingFor.map((item) => `  - ${item}`)
          : ["  - "]),
        "",
        "Here is what I would do first:",
        "",
        "",
        "— sent from the RITAA Entrepreneur Zone",
      ].join("\n")
    : [
        `Hi ${who},`,
        "",
        `I found ${venture.businessName} on the RITAA Entrepreneur Zone (RACE). I am writing about:`,
        "  [ ] collaboration or a partnership",
        "  [ ] mentoring and advice",
        "  [ ] vendor / supplier information",
        "  [ ] help with something I am starting",
        "",
        "A little about me:",
        "",
        "",
        "— sent from the RITAA Entrepreneur Zone",
      ].join("\n");

  return `mailto:${venture.founderEmail}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/**
 * True only for an absolute http(s) address.
 *
 * `productImageUrls` is a plain string array, so it can hold anything typed
 * into it — a slug, a filename, a note. Nothing reaches an `<img>` until it
 * parses as a real web address, which is what stops a slug-like value from
 * rendering as a broken image. When genuine URLs are added to the field the
 * thumbnails below start appearing on their own, with no code change.
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
  return values.map((value) => value.trim()).filter(isHttpUrl);
}

/**
 * Outreach to a founder listed on the community help board.
 *
 * The board carries a summary row, not a whole venture, so this is separate
 * from `mailtoFor` — and it can be sharper for it: the topic they offered is
 * named in the subject line.
 */
function helpMailto(
  founder: { founderName: string; founderEmail: string; businessName: string },
  topic: string,
) {
  const subject = `RACE — ${topic}`;
  const body = [
    `Hi ${firstNameOf(founder.founderName)},`,
    "",
    `You listed "${topic}" as something you can help other RIT founders with on the RITAA Entrepreneur Zone. I am stuck on exactly that.`,
    "",
    "Where I am:",
    "",
    "",
    "— sent from the RITAA Entrepreneur Zone",
  ].join("\n");
  return `mailto:${founder.founderEmail}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/* ------------------------------------------------------------------------- */
/* Feed                                                                       */
/* ------------------------------------------------------------------------- */

function LabelledPills({
  label,
  items,
  tone = "quiet",
}: {
  label: string;
  items: string[];
  tone?: "quiet" | "jade";
}) {
  return (
    <div className="mt-5">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-slate-ink">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Pill key={item} tone={tone}>
            {item}
          </Pill>
        ))}
      </div>
    </div>
  );
}

/**
 * The product gallery on a feed card.
 *
 * Real http(s) URLs render as thumbnails. Anything else in `productImageUrls`
 * is ignored, and the founder gets the labelled CSS-only slot plus the address
 * photographs are emailed to — there is no upload on the submit form yet, and
 * an empty box with no explanation reads as a broken page rather than as a step
 * the association has not built.
 *
 * A plain `<img>` is deliberate: next/image would need every founder's image
 * host listed in `next.config.ts` before it would render anything, which is
 * exactly the code change this path exists to avoid.
 */
function ProductGallery({ venture }: { venture: Venture }) {
  const images = usableImages(venture.productImageUrls);

  return (
    <div className="mt-5">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-slate-ink">
        Product gallery
      </p>
      {images.length > 0 ? (
        <>
          <ul className="mt-2 grid grid-cols-3 gap-px bg-line">
            {images.slice(0, 3).map((url, index) => (
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
          <p className="font-mono mt-2 text-[0.65rem] uppercase tracking-[0.12em] text-slate-ink">
            <span className="tabular-nums">{images.length}</span> image
            {images.length === 1 ? "" : "s"} published
            {images.length > 3 ? " · first three shown" : ""}
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-px bg-line" aria-hidden>
            {[0, 1, 2].map((slot) => (
              <div
                key={slot}
                className="flex aspect-[4/3] items-center justify-center bg-bone-deep"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, var(--color-line) 0 1px, transparent 1px 8px)",
                }}
              >
                <span className="font-mono text-[0.6rem] tabular-nums text-slate-ink">
                  0{slot + 1}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.78rem] leading-snug text-slate-ink">
            No photographs on file. The submit form has no upload step yet, so
            founders email theirs to {COORDINATOR.email} and the coordinator
            attaches them — these slots then fill in on their own.
          </p>
        </>
      )}
    </div>
  );
}

function VentureCard({ venture }: { venture: Venture }) {
  const isIdea = venture.stage === "upcoming";

  return (
    <article
      className={cx(
        "flex flex-col p-6 sm:p-7",
        isIdea ? "bg-bone" : "bg-white",
      )}
    >
      <div className="flex items-start gap-4">
        <Monogram
          name={venture.founderName}
          size="md"
          tone={isIdea ? "ink" : "maroon"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isIdea ? (
              <Pill tone="brass">Upcoming</Pill>
            ) : (
              <Pill tone="maroon">Established</Pill>
            )}
            <Pill>{venture.category}</Pill>
          </div>
          <h3 className="font-display mt-3 text-xl leading-snug text-ink">
            {/* Link's href generic cannot express a dynamic segment; the
                URL-object form can. Same idiom as the directory listing. */}
            <Link
              href={{ pathname: `/race/${venture._id}` }}
              className="transition-colors hover:text-maroon"
            >
              {venture.businessName}
            </Link>
          </h3>
          <p className="mt-1.5 text-[0.875rem] text-ink">{venture.founderName}</p>
          <p className="font-mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.67rem] uppercase tracking-[0.1em]">
            <span className="tabular-nums text-brass">
              {venture.founderBatch ? `Batch ${venture.founderBatch}` : "Batch not stated"}
            </span>
            {venture.age ? (
              <span className="tabular-nums text-brass">Age {venture.age}</span>
            ) : null}
            <span className="text-slate-ink">{venture.location}</span>
          </p>
        </div>
      </div>

      <p className="mt-4 text-[0.9rem] leading-relaxed text-slate-ink">
        {venture.description}
      </p>

      {isIdea ? (
        <div className="mt-5 border border-dashed border-brass/45 bg-white p-4">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-brass">
            Guidance needed
          </p>
          {venture.lookingFor.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {venture.lookingFor.map((item) => (
                <Pill key={item}>{item}</Pill>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[0.82rem] text-slate-ink">
              No specific ask listed yet. Start by asking what stage the idea is at.
            </p>
          )}
          <p className="mt-3 border-t border-dashed border-line pt-3 text-[0.8rem] leading-snug text-slate-ink">
            Idea stage — not trading yet. The most useful reply is one specific contact,
            document or number, not a general offer to chat.
          </p>
        </div>
      ) : (
        <>
          <ProductGallery venture={venture} />
          {venture.lookingFor.length > 0 ? (
            <LabelledPills label="Looking for" items={venture.lookingFor} />
          ) : null}
        </>
      )}

      {venture.offersHelp.length > 0 ? (
        <LabelledPills
          label="Offers help with"
          items={venture.offersHelp}
          tone="jade"
        />
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-5 sm:pt-6">
        <Button href={{ pathname: `/race/${venture._id}` }} variant="outline">
          View full profile
        </Button>
        <a
          href={mailtoFor(venture)}
          className={ACTION}
          aria-label={`Email ${venture.founderName} at ${venture.founderEmail} about ${venture.businessName}`}
        >
          {isIdea ? "Offer guidance" : "Contact founder"}
        </a>
        {venture.website ? (
          <a
            href={venture.website}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
          >
            {hostOf(venture.website)} ↗
          </a>
        ) : null}
        {venture.contact ? (
          <a
            href={`tel:${venture.contact.replace(/\s+/g, "")}`}
            className="font-mono text-[0.7rem] tabular-nums text-slate-ink transition-colors hover:text-ink"
          >
            {venture.contact}
          </a>
        ) : null}
        <span className="font-mono ml-auto text-[0.65rem] uppercase tracking-[0.1em] text-slate-ink">
          {isIdea ? "Posted" : "Listed"} {formatDate(venture.createdAt)}
        </span>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------------- */
/* Entrepreneur entrance — the brief's "custom login/signup"                   */
/* ------------------------------------------------------------------------- */

/**
 * RACE gets its own marked doorway, not its own account system.
 *
 * A second set of credentials for entrepreneurs would mean a second password to
 * lose, a second verification queue for the office, and a founder who is also
 * an alumnus holding two identities. So the entrance below is a RACE-branded
 * route into the association account at /join, plus an honest read-out of what
 * that account currently resolves to — which is what `access.roleFor` answers.
 */

const ROLE_LABEL: Record<string, string> = {
  alumni: "Alumni",
  entrepreneur: "Entrepreneur",
  admin: "Admin",
  guest: "Guest",
};

/**
 * Why `access.roleFor` returned what it returned, written out so the answer is
 * checkable instead of magic. These strings track the `source` values that
 * query actually emits — including the important one: the Entrepreneur role is
 * granted by the existence of a venture row, and that query does not check
 * whether the row was approved.
 */
const ROLE_SOURCE: Record<string, string> = {
  "no-session":
    "No address was supplied, so the portal falls back to the least privileged role.",
  assigned:
    "An administrator set this role directly in the memberRoles table. An assigned role overrides everything below it — including a venture.",
  venture:
    "A venture registered from this address exists in the RACE table, so the address resolves to Entrepreneur on its own. Note that this happens as soon as the form is submitted: the role does not wait for the coordinator's approval, even though the profile does.",
  verified:
    "The association approved this address for alumni verification, which grants the Alumni role.",
  unverified:
    "Nothing is on file for this address yet, so the portal defaults to Guest.",
};

/** The resolved role, with the reason. */
function RoleReadout({
  email,
  result,
}: {
  email: string;
  result: RoleResult | undefined;
}) {
  if (result === undefined) {
    return (
      <p
        className="font-mono mt-4 text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink"
        aria-live="polite"
      >
        Checking {email}…
      </p>
    );
  }

  const isEntrepreneur = result.role === "entrepreneur";

  return (
    <div
      className={cx(
        "mt-4 border p-4",
        isEntrepreneur ? "border-jade/30 bg-jade/10" : "border-line bg-bone",
      )}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={isEntrepreneur ? "jade" : "quiet"}>
          {ROLE_LABEL[result.role] ?? result.role}
        </Pill>
        <span className="font-mono min-w-0 truncate text-[0.65rem] tracking-[0.06em] text-slate-ink">
          {email}
        </span>
      </div>
      <p className="mt-2.5 text-[0.85rem] leading-relaxed text-slate-ink">
        {ROLE_SOURCE[result.source] ??
          "Resolved by the association's access rules."}
      </p>
      {!isEntrepreneur ? (
        <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ink">
          Register a venture below and this address becomes an Entrepreneur.
        </p>
      ) : null}
    </div>
  );
}

/** Signed in: read the address off the session and resolve it automatically. */
function SignedInEntrance() {
  const user = useQuery(api.auth.getCurrentUser);
  const email = typeof user?.email === "string" ? user.email : null;
  const role = useQuery(api.access.roleFor, email ? { email } : "skip");

  return (
    <div className="bg-white p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Step 01 · Your account</Eyebrow>
        <Pill tone="jade">Signed in</Pill>
      </div>
      <h3 className="font-display mt-3 text-lg leading-snug text-ink">
        You are already signed in to RITAA
      </h3>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
        RACE uses your association account — there is no separate entrepreneur
        password to keep. Here is what this address resolves to today.
      </p>
      {email ? (
        <RoleReadout email={email} result={role} />
      ) : (
        <p className="font-mono mt-4 text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
          Reading your session…
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button href="/race#submit">Register your venture</Button>
        <Button href="/race#feed" variant="outline">
          Open the dashboard
        </Button>
      </div>
    </div>
  );
}

/** Signed out: the RACE-marked way in, pointing at the one real account flow. */
function SignedOutEntrance() {
  return (
    <div className="bg-white p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Step 01 · Your account</Eyebrow>
        <Pill tone="brass">Not signed in</Pill>
      </div>
      <h3 className="font-display mt-3 text-lg leading-snug text-ink">
        Sign up or sign in as an entrepreneur
      </h3>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
        One association account covers the whole portal, RACE included. Create it
        with an email and a password — that part works today. Google, LinkedIn
        and one-time codes are on the same page but are not configured on this
        deployment yet, and are shown there as disabled rather than as buttons
        that fail.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button href="/join">Create an entrepreneur account</Button>
        <Button href="/join" variant="outline">
          Sign in
        </Button>
      </div>
      <p className="font-mono mt-5 border-t border-line pt-4 text-[0.65rem] uppercase tracking-[0.12em] text-slate-ink">
        Both buttons open Module 01 · /join
      </p>
    </div>
  );
}

/**
 * Resolve any address without signing in.
 *
 * Deliberately not live-typed: the query fires on submit, so the page is not
 * probing the role table on every keystroke.
 */
function AccessCheck() {
  const [draft, setDraft] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const result = useQuery(
    api.access.roleFor,
    checked ? { email: checked } : "skip",
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = draft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setChecked(null);
      setError("Enter a full email address, for example you@example.in.");
      return;
    }
    setError(null);
    setChecked(email);
  }

  return (
    <div className="bg-white p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Step 02 · Your access</Eyebrow>
        <Pill>Role check</Pill>
      </div>
      <h3 className="font-display mt-3 text-lg leading-snug text-ink">
        Does this address already count as an entrepreneur?
      </h3>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
        The association does not hand out the Entrepreneur role by request. An
        address earns it by having a venture on file — so if you have registered
        one before, you already have it.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-5">
        <label
          htmlFor="race-access-email"
          className="font-mono block text-[0.68rem] uppercase tracking-[0.12em] text-ink"
        >
          Email address
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="race-access-email"
            name="accessEmail"
            type="email"
            autoComplete="email"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "race-access-email-error" : undefined}
            className={cx(INPUT, "min-w-0 flex-1", error && "border-maroon")}
            placeholder="you@example.in"
          />
          <Button type="submit">Check</Button>
        </div>
        {error ? (
          <p
            id="race-access-email-error"
            className="font-mono mt-2 text-[0.7rem] leading-snug text-maroon"
          >
            {error}
          </p>
        ) : null}
      </form>

      {checked ? <RoleReadout email={checked} result={result} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Submit form                                                                */
/* ------------------------------------------------------------------------- */

type FormState = {
  stage: Stage;
  founderName: string;
  founderEmail: string;
  founderBatch: string;
  age: string;
  contact: string;
  businessName: string;
  category: string;
  website: string;
  description: string;
  location: string;
  lookingFor: string;
  offersHelp: string;
};

const EMPTY_FORM: FormState = {
  stage: "established",
  founderName: "",
  founderEmail: "",
  founderBatch: "",
  age: "",
  contact: "",
  businessName: "",
  category: "",
  website: "",
  description: "",
  location: "",
  lookingFor: "",
  offersHelp: "",
};

const MIN_DESCRIPTION = 60;

function validate(form: FormState) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  const established = form.stage === "established";

  if (!form.founderName.trim()) {
    errors.founderName = "Enter your name as you want it published.";
  }

  const email = form.founderEmail.trim();
  if (!email) {
    errors.founderEmail = "An email is required — it is how the community reaches you.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.founderEmail = "That email does not look right. Check for a typo.";
  }

  if (!form.businessName.trim()) {
    errors.businessName = established
      ? "Enter the name you trade under."
      : "Give the idea a short working title.";
  }

  if (!form.category.trim()) {
    errors.category =
      "Name the industry or domain — SaaS, Food, Fashion, Textiles, Agritech and so on.";
  }

  const description = form.description.trim();
  if (!description) {
    errors.description = established
      ? "Describe what the business sells, to whom, and from where."
      : "Describe the idea and how far along it is.";
  } else if (description.length < MIN_DESCRIPTION) {
    errors.description = `Add ${MIN_DESCRIPTION - description.length} more characters. A one-line entry gives no one enough to act on.`;
  }

  if (!form.location.trim()) {
    errors.location = "Choose the city or region you operate from.";
  }

  if (established) {
    if (form.age.trim()) {
      const age = Number(form.age);
      if (!Number.isFinite(age) || age < 16 || age > 100) {
        errors.age = "Age should be a number between 16 and 100, or left blank.";
      }
    }
    if (form.contact.trim() && form.contact.replace(/\D/g, "").length < 10) {
      errors.contact = "Enter a 10-digit phone number, or leave it blank.";
    }
    if (form.website.trim() && !/^https?:\/\/[^\s.]+\.\S+$/.test(form.website.trim())) {
      errors.website = "Start the website with https:// — or leave it blank.";
    }
    if (parseList(form.offersHelp).length === 0) {
      errors.offersHelp =
        "Name at least one thing you can help an upcoming founder with. This is what makes RACE worth joining.";
    }
  } else if (parseList(form.lookingFor).length === 0) {
    errors.lookingFor =
      "Name at least one thing you need help with, separated by commas.";
  }

  return errors;
}

function Field({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono flex flex-wrap items-baseline gap-2 text-[0.68rem] uppercase tracking-[0.12em] text-ink"
      >
        {label}
        <span className={required ? "text-maroon" : "text-slate-ink"}>
          {required ? "required" : "optional"}
        </span>
      </label>
      {hint ? (
        <p className="mt-1.5 text-[0.78rem] leading-snug text-slate-ink">{hint}</p>
      ) : null}
      <div className="mt-2">{children}</div>
      {error ? (
        <p
          id={`${id}-error`}
          className="font-mono mt-2 text-[0.7rem] leading-snug text-maroon"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Page                                                                       */
/* ------------------------------------------------------------------------- */

export default function RacePage() {
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const stats = useQuery(api.race.raceStats);
  const facets = useQuery(api.race.categories);
  const ventures = useQuery(api.race.listVentures, {
    stage: stageFilter === "all" ? undefined : stageFilter,
    category: categoryFilter ?? undefined,
  });
  /**
   * The community boards are inverted on the server, so they stay complete
   * while the feed above is filtered and the page never has to subscribe to
   * every venture document just to turn two string arrays inside out.
   */
  const helpBoard = useQuery(api.raceProfiles.helpDirectory, {});
  const askBoard = useQuery(api.raceProfiles.openAsks, {});
  const submitVenture = useMutation(api.race.submitVenture);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of [
      ...SUGGESTED_CATEGORIES,
      ...(facets ?? []).map((f) => f.category),
    ]) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [facets]);

  const filtersActive = stageFilter !== "all" || categoryFilter !== null;
  const established = form.stage === "established";

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function chooseStage(stage: Stage) {
    setForm((prev) => ({ ...prev, stage }));
    setErrors({});
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    setSubmitted(null);

    const found = validate(form);
    setErrors(found);
    const firstKey = Object.keys(found)[0];
    if (firstKey) {
      document.getElementById(`race-${firstKey}`)?.focus();
      return;
    }

    setPending(true);
    try {
      const name = form.businessName.trim();
      await submitVenture({
        founderName: form.founderName.trim(),
        founderEmail: form.founderEmail.trim(),
        founderBatch: form.founderBatch ? Number(form.founderBatch) : undefined,
        age: established && form.age.trim() ? Number(form.age) : undefined,
        contact: established && form.contact.trim() ? form.contact.trim() : undefined,
        businessName: name,
        category: form.category.trim(),
        website: established && form.website.trim() ? form.website.trim() : undefined,
        description: form.description.trim(),
        productImageUrls: [],
        stage: form.stage,
        lookingFor: parseList(form.lookingFor),
        offersHelp: established ? parseList(form.offersHelp) : [],
        location: form.location.trim(),
      });
      setForm({ ...EMPTY_FORM, stage: form.stage });
      setErrors({});
      setSubmitted(name);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {/* ---- Onboarding: the brief's greeting, verbatim ------------------- */}
      <PageHeader
      image="/campus-2.jpg"
        module="Module 09 · Entrepreneur Zone · Powered by RACE"
        title="Hi Entrepreneur!"
        lede="Welcome to RACE — the Ramco Alumni Centre for Entrepreneurship. This is the corner of RITAA built for people who started something, or are about to. Collaborate with founders a few years ahead of you, learn from what they got wrong, and ask for the one specific thing that will unblock you. Nobody here expects you to have it figured out."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {STAGE_CHOICES.map((choice, index) => (
            <div
              key={choice.value}
              className={cx(
                "p-6",
                choice.value === "upcoming"
                  ? "border border-dashed border-brass/45"
                  : "border border-white/15",
              )}
            >
              <div className="flex items-center gap-2">
                <Pill tone={choice.value === "upcoming" ? "brass" : "dark"}>
                  User type 0{index + 1}
                </Pill>
                {choice.value === "upcoming" ? <Pill tone="dark">Upcoming</Pill> : null}
              </div>
              <h2 className="font-display mt-4 text-xl leading-snug text-bone">
                {choice.label}
              </h2>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-bone/65">
                {choice.blurb}
              </p>
              <p className="font-mono mt-4 text-[0.65rem] uppercase tracking-[0.12em] text-brass-soft">
                {choice.value === "established"
                  ? "Name · Age · Contact · Category · Website · Description · Product images"
                  : "Idea title · Category · Description · Location · Guidance needed"}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/race#submit" variant="onDark">
            Register your venture
          </Button>
          <Button
            href="/race#feed"
            variant="ghost"
            className="!text-brass-soft hover:!text-bone"
          >
            Browse the community feed →
          </Button>
        </div>

        <p className="font-mono mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-6 text-[0.68rem] uppercase tracking-[0.12em] text-bone/55">
          <span>Coordinated by {COORDINATOR.name}</span>
          <span className="text-brass-soft">{COORDINATOR.designation}</span>
          <a
            href={`mailto:${COORDINATOR.email}`}
            className="normal-case tracking-normal text-bone/70 transition-colors hover:text-brass-soft"
          >
            {COORDINATOR.email}
          </a>
          <a
            href={`tel:+91${COORDINATOR.phone}`}
            className="tabular-nums text-bone/70 transition-colors hover:text-brass-soft"
          >
            {COORDINATOR.phone}
          </a>
        </p>
      </PageHeader>

      {/* ---- Headline numbers -------------------------------------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-3 lg:grid-cols-5">
            <Stat value={stats?.total ?? "—"} label="Ventures registered" />
            <Stat value={stats?.established ?? "—"} label="Established businesses" />
            <Stat value={stats?.upcoming ?? "—"} label="Ideas seeking guidance" />
            <Stat value={stats?.categories ?? "—"} label="Industries represented" />
            <Stat value={stats?.mentoringOffered ?? "—"} label="Founders offering help" />
          </div>
        </Shell>
      </section>

      {/* ---- Entrance: custom login/signup for entrepreneurs -------------- */}
      <section className="border-b border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Entrepreneur entrance"
            title="Signing in to RACE"
            lede="The brief asks for a custom login for entrepreneurs. This is it — a RACE-marked door onto the association's one account system, rather than a second set of credentials to lose. What makes you an entrepreneur here is a venture on file, not a different password."
          />

          <div className="grid gap-px bg-line lg:grid-cols-3">
            <AuthLoading>
              <div aria-busy className="h-72 animate-pulse bg-white/70" />
            </AuthLoading>
            <Unauthenticated>
              <SignedOutEntrance />
            </Unauthenticated>
            <Authenticated>
              <SignedInEntrance />
            </Authenticated>

            <AccessCheck />

            <div className="bg-white p-6 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Eyebrow>What this door does</Eyebrow>
                <Pill tone="brass">Read this</Pill>
              </div>
              <h3 className="font-display mt-3 text-lg leading-snug text-ink">
                Nothing on this page is locked yet
              </h3>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-slate-ink">
                Being straight about it: the community feed, the venture profiles
                and the submission form below are all public today. Route-level
                role gating is Module 01&rsquo;s job and is not enforced in code
                yet, so this entrance is a signpost and a role read-out — not a
                wall.
              </p>
              <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-[0.85rem] leading-relaxed text-slate-ink">
                {[
                  "Submissions are gated by moderation, not by login — anyone can submit, nothing appears until the coordinator approves it.",
                  "An unapproved venture is not readable at its own URL either. The profile query returns nothing until it is approved.",
                  "Founder email addresses on this page are published by the founders themselves, for exactly this purpose.",
                ].map((line, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="font-mono shrink-0 text-[0.7rem] tabular-nums text-brass">
                      0{index + 1}
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Shell>
      </section>

      {/* ---- Dashboard: the community feed ------------------------------- */}
      <Shell>
        <section id="feed" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Entrepreneur dashboard"
            title="Every venture in the community"
            lede="Established businesses and upcoming ideas in one feed, newest first. Filter by stage and by industry, then write to the founder directly — no introduction needed."
            action={
              <Button href="/race#submit" variant="outline">
                Add your venture
              </Button>
            }
          />

          <Card className="!p-0">
            <div className="p-6">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-slate-ink">
                  Stage
                </span>
                <div className="flex flex-wrap gap-px bg-line">
                  {STAGE_FILTERS.map((option) => {
                    const active = stageFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setStageFilter(option.value)}
                        className={cx(
                          "font-mono px-4 py-2 text-[0.7rem] uppercase tracking-[0.12em] transition-colors",
                          active
                            ? "bg-maroon text-bone"
                            : "bg-white text-slate-ink hover:bg-bone hover:text-ink",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 border-t border-line pt-5">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-slate-ink">
                  Industry / domain
                </span>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={categoryFilter === null}
                    onClick={() => setCategoryFilter(null)}
                    className={cx(
                      "font-mono border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.1em] transition-colors",
                      categoryFilter === null
                        ? "border-maroon bg-maroon text-bone"
                        : "border-line bg-bone text-slate-ink hover:border-brass hover:text-ink",
                    )}
                  >
                    All industries
                    <span className="ml-2 tabular-nums opacity-70">
                      {stats?.total ?? (facets ?? []).reduce((n, f) => n + f.count, 0)}
                    </span>
                  </button>
                  {(facets ?? []).map((facet) => {
                    const active = categoryFilter === facet.category;
                    return (
                      <button
                        key={facet.category}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setCategoryFilter(active ? null : facet.category)
                        }
                        className={cx(
                          "font-mono border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.1em] transition-colors",
                          active
                            ? "border-maroon bg-maroon text-bone"
                            : "border-line bg-bone text-slate-ink hover:border-brass hover:text-ink",
                        )}
                      >
                        {facet.category}
                        <span className="ml-2 tabular-nums opacity-70">
                          {facet.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
                aria-live="polite"
              >
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
                  Showing{" "}
                  <span className="tabular-nums text-ink">
                    {ventures?.length ?? "—"}
                  </span>{" "}
                  of{" "}
                  <span className="tabular-nums text-ink">{stats?.total ?? "—"}</span>{" "}
                  ventures
                </p>
                {filtersActive ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStageFilter("all");
                      setCategoryFilter(null);
                    }}
                    className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          </Card>

          <div className="mt-8">
            {ventures === undefined ? (
              <LoadingRows rows={4} />
            ) : ventures.length === 0 ? (
              <Empty
                title="No ventures match that combination yet"
                hint="Widen the stage filter or pick another industry. If the gap is yours to fill, register the venture and it will show up here once the coordinator approves it."
                action={
                  <Button href="/race#submit" variant="outline">
                    Register a venture
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-px bg-line md:grid-cols-2">
                {ventures.map((venture) => (
                  <VentureCard key={venture._id} venture={venture} />
                ))}
              </div>
            )}
          </div>
        </section>
      </Shell>

      {/* ---- Supportive community: who can help with what ----------------- */}
      <section id="community" className="border-y border-line bg-ink-soft">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            onDark
            eyebrow="Supportive community · Peer learning"
            title="Who can help you with what"
            lede="Built from the offers every established founder listed on their own profile. No forum, no thread to read — the topic, the founders who have done it, and a mail link."
          />

          {helpBoard === undefined ? (
            <LoadingRows rows={3} />
          ) : helpBoard.length === 0 ? (
            <p className="text-[0.9rem] leading-relaxed text-bone/60">
              No founder has listed an offer of help yet. If you have shipped something,
              add yours when you register — it is the fastest way to make this page
              worth visiting.
            </p>
          ) : (
            <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
              {helpBoard.map((topic) => (
                <div key={topic.topic} className="bg-ink-soft p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-display text-lg leading-snug text-bone">
                      {topic.topic}
                    </h3>
                    <span className="font-mono text-[0.7rem] tabular-nums text-brass-soft">
                      {String(topic.founders.length).padStart(2, "0")}
                    </span>
                  </div>
                  <ul className="mt-4 space-y-3 border-t border-white/10 pt-4">
                    {topic.founders.map((founder) => (
                      <li key={founder.ventureId} className="flex items-start gap-3">
                        <Monogram name={founder.founderName} size="sm" tone="brass" />
                        <span className="min-w-0">
                          <Link
                            href={{ pathname: `/race/${founder.ventureId}` }}
                            className="block text-[0.85rem] leading-snug text-bone transition-colors hover:text-brass-soft"
                          >
                            {founder.founderName}
                          </Link>
                          <span className="font-mono mt-0.5 block truncate text-[0.65rem] uppercase tracking-[0.1em] text-bone/50">
                            {founder.businessName} · {founder.location}
                          </span>
                          <a
                            href={helpMailto(founder, topic.topic)}
                            className="font-mono mt-1 inline-block text-[0.62rem] uppercase tracking-[0.12em] text-brass-soft underline decoration-brass/40 underline-offset-4 transition-colors hover:text-bone"
                            aria-label={`Email ${founder.founderName} about ${topic.topic}`}
                          >
                            Ask about {topic.topic.toLowerCase()}
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {askBoard !== undefined && askBoard.length > 0 ? (
            <div className="mt-12 border-t border-white/10 pt-8">
              <Eyebrow tone="bone">Open asks · pulled from every profile</Eyebrow>
              <p className="mt-3 max-w-2xl text-[0.9rem] leading-relaxed text-bone/60">
                What the community is currently stuck on. If one of these is a Tuesday
                afternoon for you, it is a blocked month for them — open the profile
                and write to the founder.
              </p>
              <ul className="mt-5 grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
                {askBoard.map((ask) => (
                  <li key={ask.topic} className="bg-ink-soft px-5 py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[0.9rem] leading-snug text-bone">
                        {ask.topic}
                      </span>
                      <span className="font-mono shrink-0 text-[0.7rem] tabular-nums text-brass-soft">
                        {String(ask.count).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {ask.askers.map((asker) => (
                        <Link
                          key={asker.ventureId}
                          href={{ pathname: `/race/${asker.ventureId}` }}
                          className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-bone/55 transition-colors hover:text-brass-soft"
                        >
                          {asker.businessName}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Shell>
      </section>

      {/* ---- Submit ------------------------------------------------------- */}
      <Shell>
        <section id="submit" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Register with RACE"
            title="Put your venture in front of the association"
            lede="One form for both user types. Established founders publish a business profile; upcoming founders publish an idea and an ask. Every submission is read by the RACE coordinator before it appears in the feed."
          />

          <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-12">
            <form onSubmit={handleSubmit} noValidate className="space-y-8">
              <fieldset className="border border-line bg-bone p-5">
                <legend className="font-mono px-2 text-[0.68rem] uppercase tracking-[0.12em] text-brass">
                  Which are you?
                </legend>
                <div className="grid gap-px bg-line sm:grid-cols-2">
                  {STAGE_CHOICES.map((choice) => {
                    const active = form.stage === choice.value;
                    return (
                      <label
                        key={choice.value}
                        className={cx(
                          "flex cursor-pointer items-start gap-3 p-5 transition-colors",
                          active
                            ? "bg-white ring-1 ring-inset ring-maroon"
                            : "bg-white/60 hover:bg-white",
                        )}
                      >
                        <input
                          type="radio"
                          name="race-stage"
                          value={choice.value}
                          checked={active}
                          onChange={() => chooseStage(choice.value)}
                          className="mt-0.5 size-4 shrink-0 accent-maroon"
                        />
                        <span className="min-w-0">
                          <span className="font-mono block text-[0.68rem] uppercase tracking-[0.12em] text-ink">
                            {choice.label}
                          </span>
                          <span className="mt-1.5 block text-[0.82rem] leading-snug text-slate-ink">
                            {choice.blurb}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-6 sm:grid-cols-2">
                <Field
                  id="race-founderName"
                  label="Your name"
                  required
                  error={errors.founderName}
                >
                  <input
                    id="race-founderName"
                    name="founderName"
                    type="text"
                    autoComplete="name"
                    value={form.founderName}
                    onChange={(e) => set("founderName", e.target.value)}
                    aria-invalid={Boolean(errors.founderName)}
                    aria-describedby={
                      errors.founderName ? "race-founderName-error" : undefined
                    }
                    className={cx(INPUT, errors.founderName && "border-maroon")}
                    placeholder="Mohammed Irfan K"
                  />
                </Field>

                <Field
                  id="race-founderEmail"
                  label="Email"
                  hint="Published on your card so alumni can reach you."
                  required
                  error={errors.founderEmail}
                >
                  <input
                    id="race-founderEmail"
                    name="founderEmail"
                    type="email"
                    autoComplete="email"
                    value={form.founderEmail}
                    onChange={(e) => set("founderEmail", e.target.value)}
                    aria-invalid={Boolean(errors.founderEmail)}
                    aria-describedby={
                      errors.founderEmail ? "race-founderEmail-error" : undefined
                    }
                    className={cx(INPUT, errors.founderEmail && "border-maroon")}
                    placeholder="you@example.in"
                  />
                </Field>

                <Field id="race-founderBatch" label="Graduating batch">
                  <select
                    id="race-founderBatch"
                    name="founderBatch"
                    value={form.founderBatch}
                    onChange={(e) => set("founderBatch", e.target.value)}
                    className={cx(INPUT, "font-mono tabular-nums")}
                  >
                    <option value="">Not stated</option>
                    {[...BATCH_YEARS].reverse().map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  id="race-location"
                  label="Where you operate from"
                  required
                  error={errors.location}
                >
                  <select
                    id="race-location"
                    name="location"
                    value={form.location}
                    onChange={(e) => set("location", e.target.value)}
                    aria-invalid={Boolean(errors.location)}
                    aria-describedby={
                      errors.location ? "race-location-error" : undefined
                    }
                    className={cx(INPUT, errors.location && "border-maroon")}
                  >
                    <option value="">Choose a region</option>
                    {REGIONS.map((region) => (
                      <option key={region} value={region}>
                        {region}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  id="race-businessName"
                  label={established ? "Business name" : "Idea title"}
                  hint={
                    established
                      ? undefined
                      : "A working title is fine — “Millet ready-mix for hostels”."
                  }
                  required
                  error={errors.businessName}
                >
                  <input
                    id="race-businessName"
                    name="businessName"
                    type="text"
                    value={form.businessName}
                    onChange={(e) => set("businessName", e.target.value)}
                    aria-invalid={Boolean(errors.businessName)}
                    aria-describedby={
                      errors.businessName ? "race-businessName-error" : undefined
                    }
                    className={cx(INPUT, errors.businessName && "border-maroon")}
                    placeholder={
                      established ? "Thread & Loom Exports" : "Idea: EV retrofit kits"
                    }
                  />
                </Field>

                <Field
                  id="race-category"
                  label="Industry / domain"
                  hint="Pick a listed industry or type a new one."
                  required
                  error={errors.category}
                >
                  <input
                    id="race-category"
                    name="category"
                    type="text"
                    list="race-category-options"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    aria-invalid={Boolean(errors.category)}
                    aria-describedby={
                      errors.category ? "race-category-error" : undefined
                    }
                    className={cx(INPUT, errors.category && "border-maroon")}
                    placeholder="SaaS, Food, Fashion…"
                  />
                  <datalist id="race-category-options">
                    {categoryOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </Field>

                {established ? (
                  <>
                    <Field id="race-age" label="Your age" error={errors.age}>
                      <input
                        id="race-age"
                        name="age"
                        type="number"
                        inputMode="numeric"
                        min={16}
                        max={100}
                        value={form.age}
                        onChange={(e) => set("age", e.target.value)}
                        aria-invalid={Boolean(errors.age)}
                        aria-describedby={errors.age ? "race-age-error" : undefined}
                        className={cx(
                          INPUT,
                          "font-mono tabular-nums",
                          errors.age && "border-maroon",
                        )}
                        placeholder="28"
                      />
                    </Field>

                    <Field
                      id="race-contact"
                      label="Phone"
                      hint="Shown on your card next to the mail link."
                      error={errors.contact}
                    >
                      <input
                        id="race-contact"
                        name="contact"
                        type="tel"
                        autoComplete="tel"
                        value={form.contact}
                        onChange={(e) => set("contact", e.target.value)}
                        aria-invalid={Boolean(errors.contact)}
                        aria-describedby={
                          errors.contact ? "race-contact-error" : undefined
                        }
                        className={cx(
                          INPUT,
                          "font-mono tabular-nums",
                          errors.contact && "border-maroon",
                        )}
                        placeholder="9876543210"
                      />
                    </Field>

                    <div className="sm:col-span-2">
                      <Field
                        id="race-website"
                        label="Website"
                        hint="Opens in a new tab from your card."
                        error={errors.website}
                      >
                        <input
                          id="race-website"
                          name="website"
                          type="url"
                          value={form.website}
                          onChange={(e) => set("website", e.target.value)}
                          aria-invalid={Boolean(errors.website)}
                          aria-describedby={
                            errors.website ? "race-website-error" : undefined
                          }
                          className={cx(INPUT, errors.website && "border-maroon")}
                          placeholder="https://yourbusiness.in"
                        />
                      </Field>
                    </div>
                  </>
                ) : null}
              </div>

              <Field
                id="race-description"
                label={established ? "Business description" : "Describe the idea"}
                hint={
                  established
                    ? "What you sell, who buys it, and where you are today. Numbers help."
                    : "What the idea is, how far you have taken it, and what is blocking you."
                }
                required
                error={errors.description}
              >
                <textarea
                  id="race-description"
                  name="description"
                  rows={5}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby={
                    errors.description ? "race-description-error" : undefined
                  }
                  className={cx(INPUT, "resize-y", errors.description && "border-maroon")}
                  placeholder={
                    established
                      ? "Cotton yarn and home-textile exports out of Rajapalayam, shipping to buyers in the UAE and Sri Lanka…"
                      : "Millet breakfast mixes priced for hostel kitchens. Recipes tested with 200 students; I need help on shelf life and FSSAI licensing…"
                  }
                />
                <p className="font-mono mt-2 text-[0.65rem] tabular-nums uppercase tracking-[0.12em] text-slate-ink">
                  {form.description.trim().length} / {MIN_DESCRIPTION} minimum
                </p>
              </Field>

              <Field
                id="race-lookingFor"
                label={established ? "What you are looking for" : "Guidance you need"}
                hint="Comma separated, up to eight. Be specific — “FSSAI licensing”, not “advice”."
                required={!established}
                error={errors.lookingFor}
              >
                <input
                  id="race-lookingFor"
                  name="lookingFor"
                  type="text"
                  value={form.lookingFor}
                  onChange={(e) => set("lookingFor", e.target.value)}
                  aria-invalid={Boolean(errors.lookingFor)}
                  aria-describedby={
                    errors.lookingFor ? "race-lookingFor-error" : undefined
                  }
                  className={cx(INPUT, errors.lookingFor && "border-maroon")}
                  placeholder="Regulatory guidance, Automotive mentor, Workshop space"
                />
              </Field>

              {established ? (
                <>
                  <Field
                    id="race-offersHelp"
                    label="What help can you offer"
                    hint="This is what puts you on the community help board. Comma separated."
                    required
                    error={errors.offersHelp}
                  >
                    <input
                      id="race-offersHelp"
                      name="offersHelp"
                      type="text"
                      value={form.offersHelp}
                      onChange={(e) => set("offersHelp", e.target.value)}
                      aria-invalid={Boolean(errors.offersHelp)}
                      aria-describedby={
                        errors.offersHelp ? "race-offersHelp-error" : undefined
                      }
                      className={cx(INPUT, errors.offersHelp && "border-maroon")}
                      placeholder="Export documentation, Mill sourcing, First-order pricing"
                    />
                  </Field>

                  <div className="border border-dashed border-line bg-bone p-5">
                    <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-brass">
                      Product images
                    </p>
                    <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
                      There is no upload on this form yet, and we would rather say so
                      than quietly drop your file. Email up to six product photographs
                      to{" "}
                      <a
                        href={`mailto:${COORDINATOR.email}?subject=${encodeURIComponent(
                          "RACE — product images for my venture profile",
                        )}`}
                        className="text-maroon underline decoration-brass/50 underline-offset-4 hover:text-maroon-deep"
                      >
                        {COORDINATOR.email}
                      </a>{" "}
                      with your business name in the subject. The coordinator attaches
                      them to your profile at approval, and the gallery slots on your
                      card fill in.
                    </p>
                  </div>
                </>
              ) : null}

              <div className="border-t border-line pt-6" aria-live="polite">
                {submitted ? (
                  <div className="mb-6 border border-jade/30 bg-jade/10 p-5">
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-jade">
                      Submitted for review
                    </p>
                    <p className="mt-2 text-[0.9rem] leading-relaxed text-ink">
                      Thank you — <strong>{submitted}</strong> is in the queue.{" "}
                      {COORDINATOR.name}, {COORDINATOR.designation}, reviews every
                      submission, and your venture goes live in the community feed once
                      it is approved. Nothing is published before that.
                    </p>
                  </div>
                ) : null}

                {failed ? (
                  <div className="mb-6 border border-maroon/30 bg-maroon/8 p-5">
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-maroon">
                      Not saved
                    </p>
                    <p className="mt-2 text-[0.9rem] leading-relaxed text-ink">
                      The submission did not reach the association. Try once more, and if
                      it fails again email the details to {COORDINATOR.email}.
                    </p>
                  </div>
                ) : null}

                {Object.keys(errors).length > 0 ? (
                  <p className="font-mono mb-6 text-[0.7rem] uppercase tracking-[0.12em] text-maroon">
                    {Object.keys(errors).length} field
                    {Object.keys(errors).length === 1 ? "" : "s"} need attention below
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" disabled={pending}>
                    {pending
                      ? "Submitting…"
                      : established
                        ? "Submit business profile"
                        : "Submit idea for guidance"}
                  </Button>
                  <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-slate-ink">
                    Reviewed by the RACE coordinator before publication
                  </p>
                </div>
              </div>
            </form>

            <aside className="flex flex-col gap-4">
              <Card>
                <Eyebrow>How moderation works</Eyebrow>
                <h3 className="font-display mt-2 text-lg leading-snug text-ink">
                  Submissions are reviewed, not auto-published
                </h3>
                <ol className="mt-4 space-y-3 text-[0.85rem] leading-relaxed text-slate-ink">
                  {[
                    "You submit. The venture is stored unapproved and stays invisible to the public feed.",
                    "The RACE coordinator checks that the founder is an RIT alumnus and that the description is specific enough to act on.",
                    "On approval it appears in the community feed, in the industry filter counts, and — if you offered help — on the community help board.",
                  ].map((step, index) => (
                    <li key={index} className="flex gap-3">
                      <span className="font-mono shrink-0 text-[0.7rem] tabular-nums text-brass">
                        0{index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>

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
                  Write to the coordinator for founder-clinic slots, an introduction to a
                  founder who has not listed a contact, corrections to a published
                  profile, or product images.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
                  <a href={`mailto:${COORDINATOR.email}`} className={ACTION}>
                    Email the coordinator
                  </a>
                  <a
                    href={`tel:+91${COORDINATOR.phone}`}
                    className="font-mono text-[0.7rem] tabular-nums text-slate-ink transition-colors hover:text-ink"
                  >
                    {COORDINATOR.phone}
                  </a>
                </div>
              </Card>

              <Card>
                <Eyebrow>What RACE is not</Eyebrow>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
                  It is not a funding portal and the association does not invest. Most
                  requests here are for one piece of operational knowledge — which body
                  certifies a retrofit kit, how an FSSAI licence is actually issued, what
                  a first export invoice looks like. Answering one of those is a bigger
                  favour than it sounds.
                </p>
              </Card>
            </aside>
          </div>
        </section>
      </Shell>
    </>
  );
}
