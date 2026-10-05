"use client";

import { api, useMutation, useQuery, type FunctionReturnType } from "@/lib/standalone";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  Button,
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
import { formatDate, formatEventDate, inr, RITAA } from "@/lib/site";

/**
 * Module 7 — one event in full.
 *
 * `events.bySlug` returns the raw row, without the `attending`/`seatsLeft` that
 * `events.list` computes, so the headcount here comes from
 * `eventAdmin.rsvpSummary` instead — which also carries the maybe/withdrawn
 * split and the guest count the card has no room for.
 *
 * The register below names confirmed attendees only. It never shows an email
 * address: `eventAdmin.attendeesFor` does not return one.
 */

type EventDoc = NonNullable<FunctionReturnType<typeof api.events.bySlug>>;
type ReminderResult = FunctionReturnType<typeof api.eventAdmin.scheduleReminder>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const KIND_LABEL: Record<EventDoc["kind"], string> = {
  reunion: "Reunion",
  webinar: "Webinar",
  sports: "Sports",
  networking: "Networking",
  convocation: "Convocation",
};

const MODE_NOTE: Record<EventDoc["mode"], string> = {
  onsite: "On campus — attend in person.",
  online: "Online — the joining link is emailed to the register.",
  hybrid: "Hybrid — attend on campus or join online.",
};

const STATUS_LABEL = {
  going: "Going",
  maybe: "Maybe",
  cancelled: "Not coming",
} as const;

const inputClass =
  "w-full border border-line bg-bone px-3 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-ink focus:border-maroon";

/** Convex wraps server errors with request ids; surface the sentence that was thrown. */
function thrownMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/Uncaught Error:\s*([\s\S]*?)(?:\n\s*at\s|$)/);
  return (match ? match[1] : raw).trim();
}

/** Date with the clock time — the card only has room for the day. */
function formatWhen(ts: number) {
  return new Date(ts).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono flex items-baseline justify-between gap-2 text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink"
      >
        <span>{label}</span>
        {optional ? <span className="text-brass">Optional</span> : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="font-mono mt-1.5 text-[0.7rem] text-maroon">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[0.75rem] leading-snug text-slate-ink">{hint}</p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="font-mono shrink-0 text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
        {label}
      </dt>
      <dd className="text-right text-[0.88rem] leading-snug text-ink">{value}</dd>
    </div>
  );
}

/**
 * Registration for this event.
 *
 * Deliberately a copy of the panel on /events rather than a shared import: a
 * Next page module should only export its page, so lifting this out would mean
 * a third file, and this route owns only its own page.
 */
function RegisterPanel({ event }: { event: EventDoc }) {
  const rsvp = useMutation(api.events.rsvp);
  const scheduleReminder = useMutation(api.eventAdmin.scheduleReminder);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [batch, setBatch] = useState("");
  const [guests, setGuests] = useState("0");
  const [status, setStatus] = useState<"going" | "maybe" | "cancelled">("going");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{
    status: "going" | "maybe" | "cancelled";
    email: string;
    reminder: ReminderResult | null;
    reminderError: string | null;
  } | null>(null);

  const maxBatch = new Date().getFullYear() + 4;

  const cleanEmail = email.trim().toLowerCase();
  const lookupEmail = EMAIL_RE.test(cleanEmail) ? cleanEmail : null;
  const mine = useQuery(
    api.eventAdmin.myRsvp,
    lookupEmail ? { eventId: event._id, email: lookupEmail } : "skip",
  );

  // Prefill once per address so a returning member is not asked twice.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lookupEmail || !mine) return;
    if (prefilledFor.current === lookupEmail) return;
    prefilledFor.current = lookupEmail;
    setName(mine.name);
    setBatch(mine.batch === null ? "" : String(mine.batch));
    setGuests(String(mine.guests));
    setStatus(mine.status);
  }, [lookupEmail, mine]);

  function validate() {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) {
      next.name = "Enter the name the association should print on the register.";
    }
    if (!EMAIL_RE.test(email.trim())) {
      next.email = "Enter a valid email address — your registration is filed against it.";
    }
    if (batch.trim() !== "") {
      const year = Number(batch);
      if (!Number.isInteger(year) || year < RITAA.established || year > maxBatch) {
        next.batch = `Graduating batch must be a year between ${RITAA.established} and ${maxBatch}.`;
      }
    }
    if (guests.trim() !== "") {
      const count = Number(guests);
      if (!Number.isInteger(count) || count < 0 || count > 6) {
        next.guests = "Guests must be a whole number between 0 and 6.";
      }
    }
    return next;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const submitEmail = email.trim().toLowerCase();
    setPending(true);
    try {
      await rsvp({
        eventId: event._id,
        name: name.trim(),
        email: submitEmail,
        batch: batch.trim() === "" ? undefined : Number(batch),
        guests: guests.trim() === "" ? 0 : Number(guests),
        status,
      });
    } catch (err) {
      setFormError(thrownMessage(err));
      setPending(false);
      return;
    }

    // Separate write, separately reported — a reminder that could not be queued
    // must never read as a registration that failed.
    let reminder: ReminderResult | null = null;
    let reminderError: string | null = null;
    try {
      reminder = await scheduleReminder({ eventId: event._id, email: submitEmail });
    } catch (err) {
      reminderError = thrownMessage(err);
    }

    prefilledFor.current = submitEmail;
    setPending(false);
    setDone({ status, email: submitEmail, reminder, reminderError });
  }

  if (done) {
    return (
      <div
        className={`border-l-2 pl-4 ${
          done.status === "cancelled" ? "border-line" : "border-jade"
        }`}
      >
        <Eyebrow tone="slate">
          {done.status === "cancelled"
            ? "Registration withdrawn"
            : "Registration recorded"}
        </Eyebrow>
        <p className="font-display mt-2 text-xl leading-snug text-ink">
          {done.status === "going"
            ? "You are on the register."
            : done.status === "maybe"
              ? "Marked down as a maybe."
              : "You are off the register."}
        </p>
        <p className="mt-3 text-[0.88rem] leading-relaxed text-slate-ink">
          Filed against <span className="font-mono text-ink">{done.email}</span>. The
          register above updates as soon as it refreshes.
        </p>

        <div className="mt-4 border-t border-line pt-4">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-ink">
            Reminder
          </p>
          {done.reminderError ? (
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-maroon">
              {done.reminderError}
            </p>
          ) : done.reminder ? (
            <>
              <p className="mt-1.5 text-[0.85rem] leading-relaxed text-slate-ink">
                {done.reminder.reason}
              </p>
              {done.reminder.scheduledFor !== null ? (
                <p className="font-mono mt-1.5 text-[0.72rem] tabular-nums text-ink">
                  Due {formatEventDate(done.reminder.scheduledFor)}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="mt-5">
          <Button variant="outline" onClick={() => setDone(null)}>
            Update my response
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <Eyebrow>Register</Eyebrow>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          One registration per email address. Submitting again with the same address
          updates your response — including withdrawing it — rather than duplicating it.
        </p>
      </div>

      <Field id="reg-name" label="Full name" error={errors.name}>
        <input
          id="reg-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "reg-name-error" : undefined}
          className={inputClass}
          placeholder="Arunprasanth S"
        />
      </Field>

      <Field
        id="reg-email"
        label="Email"
        error={errors.email}
        hint="Your registration and its reminder are filed against this address."
      >
        <input
          id="reg-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "reg-email-error" : undefined}
          className={inputClass}
          placeholder="you@example.com"
        />
      </Field>

      {mine ? (
        <div className="border-l-2 border-jade pl-3" aria-live="polite">
          <p className="text-[0.85rem] leading-relaxed text-ink">
            {mine.status === "going"
              ? "You are already on the register as going"
              : mine.status === "maybe"
                ? "You are already down as a maybe"
                : "Your registration for this event is withdrawn"}
            {mine.guests > 0
              ? ` with ${mine.guests} guest${mine.guests === 1 ? "" : "s"}`
              : ""}
            , filed {formatDate(mine.createdAt)}. The form is prefilled with that
            response.
          </p>
          <p className="font-mono mt-1.5 text-[0.7rem] leading-relaxed text-slate-ink">
            {mine.reminder
              ? mine.mailerConfigured
                ? `Reminder queued for ${formatEventDate(mine.reminder.scheduledFor)} and will be emailed automatically.`
                : `Reminder queued on the server for ${formatEventDate(mine.reminder.scheduledFor)} — it is not emailed until the association sets its mail key.`
              : "No reminder is queued yet. Submit the form to queue one."}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reg-batch" label="Batch" optional error={errors.batch}>
          <input
            id="reg-batch"
            name="batch"
            type="number"
            inputMode="numeric"
            min={RITAA.established}
            max={maxBatch}
            step={1}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            aria-invalid={errors.batch ? true : undefined}
            aria-describedby={errors.batch ? "reg-batch-error" : undefined}
            className={`${inputClass} font-mono tabular-nums`}
            placeholder="2019"
          />
        </Field>

        <Field id="reg-guests" label="Guests" optional error={errors.guests}>
          <input
            id="reg-guests"
            name="guests"
            type="number"
            inputMode="numeric"
            min={0}
            max={6}
            step={1}
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            aria-invalid={errors.guests ? true : undefined}
            aria-describedby={errors.guests ? "reg-guests-error" : undefined}
            className={`${inputClass} font-mono tabular-nums`}
            placeholder="0"
          />
        </Field>
      </div>

      <fieldset>
        <legend className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
          Response
        </legend>
        <div className="mt-1.5 grid grid-cols-3 gap-px bg-line">
          {(["going", "maybe", "cancelled"] as const).map((value) => {
            const active = status === value;
            return (
              <label key={value} className="block">
                <input
                  type="radio"
                  name="reg-status"
                  value={value}
                  checked={active}
                  onChange={() => setStatus(value)}
                  className="peer sr-only"
                />
                <span
                  className={`font-mono block cursor-pointer px-2 py-2.5 text-center text-[0.7rem] uppercase tracking-[0.12em] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-maroon ${
                    active ? "bg-ink text-bone" : "bg-white text-slate-ink"
                  }`}
                >
                  {STATUS_LABEL[value]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {formError ? (
        <p
          role="alert"
          className="border-l-2 border-maroon pl-3 text-[0.85rem] leading-relaxed text-maroon"
        >
          {formError}
        </p>
      ) : null}

      <div className="pt-1">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Confirm registration"}
        </Button>
      </div>

      <p className="font-mono text-[0.68rem] leading-relaxed tracking-[0.04em] text-slate-ink">
        {event.ticketPriceInr > 0
          ? `Registering reserves your seat. ${inr(event.ticketPriceInr)} is collected at the desk — nothing is charged here.`
          : "Registering reserves your seat. Entry is free."}{" "}
        A reminder is queued a day before the event.
      </p>
    </form>
  );
}

/** Past events: the feedback route the brief asks for. */
function FeedbackPanel({ event }: { event: EventDoc }) {
  const subject = `Event feedback — ${event.title}`;
  const body = `Event: ${event.title}\nHeld on: ${formatEventDate(event.startsAt)}\nVenue: ${event.venue}\n\nWhat worked:\n\nWhat should change next time:\n\nWould you help organise the next one?\n`;
  const mailto = `mailto:${RITAA.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  return (
    <div>
      <Eyebrow>Feedback</Eyebrow>
      <p className="font-display mt-2 text-xl leading-snug text-ink">
        Tell the committee how it went.
      </p>
      <p className="mt-3 text-[0.88rem] leading-relaxed text-slate-ink">
        The form opens an email to {RITAA.email} with this event in the subject line and
        three prompts already in the body: what worked, what should change, and whether
        you would help organise the next one.
      </p>
      <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
        Feedback goes to the committee's inbox rather than into the portal — there is no
        feedback table on this deployment, and a form that quietly discarded your answer
        would be worse than one that hands it to a person.
      </p>
      <div className="mt-5">
        <a
          href={mailto}
          className="font-mono inline-flex items-center gap-2 border border-ink/25 px-5 py-2.5 text-[0.75rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-maroon hover:text-maroon"
        >
          Open the feedback form →
        </a>
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams();
  const raw = params?.slug;
  const slug = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  const event = useQuery(api.events.bySlug, { slug });
  // Hooks run unconditionally; the arguments are skipped until the event lands.
  const summary = useQuery(
    api.eventAdmin.rsvpSummary,
    event ? { eventId: event._id } : "skip",
  );
  const attendees = useQuery(
    api.eventAdmin.attendeesFor,
    event ? { eventId: event._id } : "skip",
  );

  // undefined = the query is still in flight; null = no such event. Never let
  // the in-flight state render as "not found".
  if (event === undefined) {
    return (
      <Shell>
        <div className="py-16 sm:py-20">
          <Eyebrow>Loading event</Eyebrow>
          <div className="mt-6">
            <LoadingRows rows={4} />
          </div>
        </div>
      </Shell>
    );
  }

  if (event === null) {
    return (
      <Shell>
        <div className="py-16 sm:py-20">
          <Link
            href="/events"
            className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-maroon hover:text-maroon-deep"
          >
            ← Back to events
          </Link>
          <div className="mt-8">
            <Empty
              title="That event was not found"
              hint={`Nothing is published at /events/${slug}. The event may have been renamed or unpublished, or the link may have been cut short in an email.`}
              action={
                <Button href="/events" variant="outline">
                  Back to events
                </Button>
              }
            />
          </div>
        </div>
      </Shell>
    );
  }

  const past = event.startsAt < Date.now();
  const going = (attendees ?? []).filter((a) => a.status === "going");
  const maybes = (attendees ?? []).filter((a) => a.status === "maybe");
  const withdrawn = (attendees ?? []).filter((a) => a.status === "cancelled").length;
  const full = summary?.seatsLeft === 0;

  const paragraphs = event.description
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <PageHeader
        module={`Module 07 · ${KIND_LABEL[event.kind]}`}
        title={event.title}
        lede={event.summary}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="dark">{event.mode}</Pill>
          <Pill tone="dark">
            {event.ticketPriceInr === 0 ? "Free entry" : `Ticketed · ${inr(event.ticketPriceInr)}`}
          </Pill>
          <Pill tone="dark">{past ? "Held" : full ? "Full" : "Open for registration"}</Pill>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat
            value={summary ? summary.headcount : "—"}
            label={past ? "Attended, guests included" : "Attending, guests included"}
            onDark
          />
          <Stat
            value={summary ? (summary.seatsLeft === null ? "Open" : summary.seatsLeft) : "—"}
            label={event.capacity ? "Seats left" : "No seat limit"}
            onDark
          />
          <Stat value={summary ? summary.maybe : "—"} label="Maybe" onDark />
          <Stat
            value={event.ticketPriceInr === 0 ? "Free" : inr(event.ticketPriceInr)}
            label="Entry, paid at the desk"
            onDark
          />
        </div>
      </PageHeader>

      <Shell>
        <div className="py-16 sm:py-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
            <Link
              href="/events"
              className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-maroon hover:text-maroon-deep"
            >
              ← Back to events
            </Link>
            <a
              href="#register"
              className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink transition-colors hover:text-maroon"
            >
              {past ? "Leave feedback ↓" : "Register ↓"}
            </a>
          </div>

          <div className="mt-10 grid gap-px bg-line lg:grid-cols-[1.3fr_1fr]">
            {/* ---- What it is, and every logistic ------------------------- */}
            <div className="bg-white p-7 sm:p-8">
              <Eyebrow>About this event</Eyebrow>
              <div className="mt-4 max-w-prose space-y-4 text-[0.975rem] leading-[1.75] text-ink">
                {paragraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>

              <dl className="mt-8 border-t border-line">
                <Row label="Type" value={KIND_LABEL[event.kind]} />
                <Row
                  label="Starts"
                  value={<span className="font-mono tabular-nums">{formatWhen(event.startsAt)}</span>}
                />
                {event.endsAt ? (
                  <Row
                    label="Ends"
                    value={<span className="font-mono tabular-nums">{formatWhen(event.endsAt)}</span>}
                  />
                ) : null}
                <Row label="Mode" value={MODE_NOTE[event.mode]} />
                <Row label="Venue" value={event.venue} />
                <Row
                  label="Capacity"
                  value={
                    <span className="font-mono tabular-nums">
                      {event.capacity ? `${event.capacity} seats` : "No fixed limit"}
                    </span>
                  }
                />
                <Row
                  label="Entry"
                  value={
                    <span className="font-mono tabular-nums">
                      {event.ticketPriceInr === 0
                        ? "Free"
                        : `${inr(event.ticketPriceInr)} per head`}
                    </span>
                  }
                />
                <Row
                  label="Registration"
                  value={past ? "Closed — the event has been held" : "Open"}
                />
                <Row
                  label="Organiser"
                  value={
                    <span className="font-mono">
                      {RITAA.shortName} · {RITAA.email}
                    </span>
                  }
                />
              </dl>

              {event.ticketPriceInr > 0 ? (
                <p className="mt-6 border-l-2 border-brass pl-3 text-[0.85rem] leading-relaxed text-slate-ink">
                  Ticketing: {inr(event.ticketPriceInr)} per head, collected at the
                  registration desk on the day. There is no online payment step on this
                  page — registering holds the seat, nothing more.
                </p>
              ) : null}
            </div>

            {/* ---- Register, or leave feedback ---------------------------- */}
            <div id="register" className="scroll-mt-24 bg-white p-7 sm:p-8">
              {past ? <FeedbackPanel event={event} /> : <RegisterPanel event={event} />}
            </div>
          </div>
        </div>
      </Shell>

      {/* ---- The register ------------------------------------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="The register"
            title={past ? "Who attended" : "Who is coming"}
            lede="Names and batches as entered at registration. Email addresses are collected for the reminder and are never published here — withdrawn responses are counted, not listed."
            action={
              <Button href="/events" variant="outline">
                All events
              </Button>
            }
          />

          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white p-5">
              <Stat value={summary ? summary.going : "—"} label="Confirmed responses" />
            </div>
            <div className="bg-white p-5">
              <Stat value={summary ? summary.guests : "—"} label="Guests booked" />
            </div>
            <div className="bg-white p-5">
              <Stat value={summary ? summary.headcount : "—"} label="Confirmed headcount" />
            </div>
            <div className="bg-white p-5">
              <Stat
                value={summary ? summary.headcountIfMaybes : "—"}
                label="Headcount if every maybe attends"
              />
            </div>
          </div>

          <div className="mt-10">
            {attendees === undefined ? (
              <LoadingRows rows={3} />
            ) : going.length === 0 ? (
              <Empty
                title={past ? "No attendance was recorded" : "Nobody has registered yet"}
                hint={
                  past
                    ? "The register for this event was not filled in on the portal."
                    : "Yours would be the first name on the sheet."
                }
              />
            ) : (
              <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                {going.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 bg-white p-4">
                    <Monogram name={a.name} size="sm" tone="ink" />
                    <div className="min-w-0">
                      <p className="truncate text-[0.9rem] leading-snug text-ink">
                        {a.name}
                      </p>
                      <p className="font-mono text-[0.7rem] tabular-nums text-slate-ink">
                        {a.batch !== null ? `Batch of ${a.batch}` : "Batch not given"}
                        {a.guests > 0
                          ? ` · +${a.guests} guest${a.guests === 1 ? "" : "s"}`
                          : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {maybes.length > 0 ? (
            <div className="mt-8 border-t border-line pt-6">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-ink">
                Maybe ({maybes.length})
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {maybes.map((a) => (
                  <li key={a.id} className="font-mono text-[0.75rem] text-ink">
                    {a.name}
                    {a.batch !== null ? (
                      <span className="tabular-nums text-slate-ink"> · {a.batch}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {withdrawn > 0 ? (
            <p className="font-mono mt-6 text-[0.72rem] tabular-nums text-slate-ink">
              {withdrawn} response{withdrawn === 1 ? " has" : "s have"} been withdrawn.
              Withdrawn responses are not named.
            </p>
          ) : null}

          <p className="font-mono mt-10 text-[0.72rem] leading-relaxed uppercase tracking-[0.12em] text-slate-ink">
            Questions about this event? {RITAA.email} · {RITAA.phone}
          </p>
        </Shell>
      </section>
    </>
  );
}
