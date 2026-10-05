"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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
import { formatDate, formatEventDate, inr, RITAA } from "@/lib/site";

/**
 * Module 7 — Event Management.
 *
 * Two windows (upcoming / past) served by the same query, filtered by the event
 * types the brief names — webinars, reunions, sports, networking. Upcoming
 * events carry a live registration form and the register of who is coming; past
 * events carry a feedback route back to the organising committee.
 *
 * Ticketing is stated, never simulated — the brief lists payment as conditional,
 * so the amount is shown and collected at the desk. Reminders are queued on the
 * server by eventAdmin.scheduleReminder; the copy below says exactly that, and
 * never claims an email was sent.
 */

type EventRow = FunctionReturnType<typeof api.events.list>[number];
type EventKind = EventRow["kind"];
type ReminderResult = FunctionReturnType<typeof api.eventAdmin.scheduleReminder>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How many names the card shows before deferring to the full register. */
const REGISTER_PREVIEW = 8;

const KIND_LABEL: Record<EventKind, string> = {
  reunion: "Reunions",
  webinar: "Webinars",
  sports: "Sports",
  networking: "Networking",
  convocation: "Convocation",
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

/**
 * Registration for one event. Idempotent per email address, per the backend, so
 * this doubles as the "change my response" and "withdraw" form.
 */
function RsvpForm({ event }: { event: EventRow }) {
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

  const uid = `rsvp-${event.slug}`;
  const maxBatch = new Date().getFullYear() + 4;

  // Only ask the server once the address is well formed — otherwise every
  // keystroke would be a lookup for an address that cannot exist.
  const cleanEmail = email.trim().toLowerCase();
  const lookupEmail = EMAIL_RE.test(cleanEmail) ? cleanEmail : null;
  const mine = useQuery(
    api.eventAdmin.myRsvp,
    lookupEmail ? { eventId: event._id, email: lookupEmail } : "skip",
  );

  // Prefill from an existing response, once per address, so a returning member
  // is not asked for details the association already holds. Typing a different
  // address re-arms the prefill; it never overwrites edits in progress.
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
      // The backend throws human-readable messages (capacity, deleted event).
      setFormError(thrownMessage(err));
      setPending(false);
      return;
    }

    // The registration is already committed. Queuing the reminder is a second,
    // separate write, so its outcome is reported separately and honestly rather
    // than being allowed to look like a failed registration.
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
          {done.status === "cancelled" ? "Registration withdrawn" : "Registration recorded"}
        </Eyebrow>
        <p className="font-display mt-2 text-xl leading-snug text-ink">
          {done.status === "going"
            ? "You are on the register."
            : done.status === "maybe"
              ? "Marked down as a maybe."
              : "You are off the register."}
        </p>
        <p className="mt-3 text-[0.88rem] leading-relaxed text-slate-ink">
          Your response is filed against{" "}
          <span className="font-mono text-ink">{done.email}</span>.
        </p>

        {/* Verbatim from the server: what was actually queued, and whether it
            can actually be delivered. */}
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

        <p className="mt-4 text-[0.85rem] leading-relaxed text-slate-ink">
          Changed your plans? Submit the form again with the same email address — the
          association updates your existing response instead of adding a second one.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setDone(null)}>
            Update my response
          </Button>
          {/* kit's Href alias is Link's non-generic href, which cannot express a
              dynamic segment; the URL-object form can. */}
          <Button href={{ pathname: `/events/${event.slug}` }} variant="ghost">
            Event page
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
          updates your existing response — including withdrawing it — rather than
          duplicating it.
        </p>
      </div>

      <Field id={`${uid}-name`} label="Full name" error={errors.name}>
        <input
          id={`${uid}-name`}
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${uid}-name-error` : undefined}
          className={inputClass}
          placeholder="Arunprasanth S"
        />
      </Field>

      <Field
        id={`${uid}-email`}
        label="Email"
        error={errors.email}
        hint="Your registration and its reminder are filed against this address."
      >
        <input
          id={`${uid}-email`}
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? `${uid}-email-error` : undefined}
          className={inputClass}
          placeholder="you@example.com"
        />
      </Field>

      {/* Recognised member: say what is already on file instead of asking again. */}
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
            , filed {formatDate(mine.createdAt)}. The form below is prefilled with that
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
        <Field id={`${uid}-batch`} label="Batch" optional error={errors.batch}>
          <input
            id={`${uid}-batch`}
            name="batch"
            type="number"
            inputMode="numeric"
            min={RITAA.established}
            max={maxBatch}
            step={1}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            aria-invalid={errors.batch ? true : undefined}
            aria-describedby={errors.batch ? `${uid}-batch-error` : undefined}
            className={`${inputClass} font-mono tabular-nums`}
            placeholder="2019"
          />
        </Field>

        <Field id={`${uid}-guests`} label="Guests" optional error={errors.guests}>
          <input
            id={`${uid}-guests`}
            name="guests"
            type="number"
            inputMode="numeric"
            min={0}
            max={6}
            step={1}
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            aria-invalid={errors.guests ? true : undefined}
            aria-describedby={errors.guests ? `${uid}-guests-error` : undefined}
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
                  name={`${uid}-status`}
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
          ? `Registering reserves your seat. ${inr(event.ticketPriceInr)} is collected at the desk.`
          : "Registering reserves your seat. Entry is free."}{" "}
        A reminder is queued a day before the event.
      </p>
    </form>
  );
}

function DetailCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="bg-white p-3">
      <dt className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-ink">
        {label}
      </dt>
      <dd
        className={`mt-1 text-[0.85rem] leading-snug text-ink ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function UpcomingEvent({ event }: { event: EventRow }) {
  const summary = useQuery(api.eventAdmin.rsvpSummary, { eventId: event._id });
  const attendees = useQuery(api.eventAdmin.attendeesFor, { eventId: event._id });

  const full = event.seatsLeft === 0;
  // Only confirmed attendees are named. Withdrawn responses are counted, never
  // listed, and no email address is returned by the query at all.
  const going = (attendees ?? []).filter((a) => a.status === "going");
  const shown = going.slice(0, REGISTER_PREVIEW);
  const rest = going.length - shown.length;

  return (
    <article id={event.slug} className="scroll-mt-24 bg-white">
      <div className="grid gap-px bg-line lg:grid-cols-[1.3fr_1fr]">
        <div className="bg-white p-7 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="brass">{event.kind}</Pill>
            <Pill>{event.mode}</Pill>
            {event.ticketPriceInr > 0 ? (
              <Pill tone="maroon">Ticketed</Pill>
            ) : (
              <Pill tone="jade">Free entry</Pill>
            )}
            {full ? <Pill tone="maroon">Full</Pill> : null}
          </div>

          <p className="font-mono mt-4 text-[0.75rem] tabular-nums text-maroon">
            {formatEventDate(event.startsAt)}
            {event.endsAt ? ` — ${formatDate(event.endsAt)}` : ""}
          </p>
          <h3 className="font-display mt-2 text-2xl leading-snug text-ink sm:text-[1.75rem]">
            <Link
              href={{ pathname: `/events/${event.slug}` }}
              className="transition-colors hover:text-maroon"
            >
              {event.title}
            </Link>
          </h3>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ink">{event.summary}</p>
          <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
            {event.description}
          </p>

          <dl className="mt-6 grid gap-px bg-line sm:grid-cols-2">
            <DetailCell label="Venue" value={event.venue} />
            <DetailCell
              label="Entry"
              value={event.ticketPriceInr === 0 ? "Free" : inr(event.ticketPriceInr)}
              mono
            />
            <DetailCell label="Attending" value={event.attending} mono />
            {event.seatsLeft !== null ? (
              <DetailCell label="Seats left" value={event.seatsLeft} mono />
            ) : null}
            <DetailCell
              label="Responses"
              value={
                summary === undefined
                  ? "—"
                  : `${summary.going} going · ${summary.maybe} maybe`
              }
              mono
            />
            <DetailCell
              label="Guests booked"
              value={summary === undefined ? "—" : summary.guests}
              mono
            />
          </dl>

          {/* The register, previewed. The full list lives on the event page. */}
          <div className="mt-6 border-t border-line pt-4">
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-ink">
              Who is coming
            </p>
            {attendees === undefined ? (
              <p className="font-mono mt-2 text-[0.72rem] text-slate-ink">
                Reading the register…
              </p>
            ) : going.length === 0 ? (
              <p className="mt-2 text-[0.82rem] leading-relaxed text-slate-ink">
                Nobody has registered yet. Yours would be the first name on the sheet.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {shown.map((a) => (
                  <li key={a.id} className="font-mono text-[0.72rem] text-ink">
                    {a.name}
                    {a.batch !== null ? (
                      <span className="tabular-nums text-slate-ink"> · {a.batch}</span>
                    ) : null}
                    {a.guests > 0 ? (
                      <span className="tabular-nums text-slate-ink"> +{a.guests}</span>
                    ) : null}
                  </li>
                ))}
                {rest > 0 ? (
                  <li className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                    +{rest} more
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          {event.ticketPriceInr > 0 ? (
            <p className="mt-5 border-l-2 border-brass pl-3 text-[0.85rem] leading-relaxed text-slate-ink">
              Ticketed event: {inr(event.ticketPriceInr)} per head, collected at the
              registration desk on the day. Nothing is charged online here — your
              registration only holds the seat.
            </p>
          ) : null}

          {full ? (
            <p className="mt-4 border-l-2 border-maroon pl-3 text-[0.85rem] leading-relaxed text-slate-ink">
              Every seat is taken. You can still register interest; if the hall is full
              the form will tell you how to join the waitlist.
            </p>
          ) : null}

          <div className="mt-6">
            <Button href={{ pathname: `/events/${event.slug}` }} variant="outline">
              Full details & register
            </Button>
          </div>
        </div>

        <div className="bg-white p-7 sm:p-8">
          <RsvpForm event={event} />
        </div>
      </div>
    </article>
  );
}

function PastEvent({ event }: { event: EventRow }) {
  const subject = `Event feedback — ${event.title}`;
  const body = `Event: ${event.title}\nHeld on: ${formatEventDate(event.startsAt)}\nVenue: ${event.venue}\n\nWhat worked:\n\nWhat should change next time:\n\nWould you help organise the next one?\n`;
  const mailto = `mailto:${RITAA.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  return (
    <article id={event.slug} className="scroll-mt-24 bg-bone p-7">
      <div className="flex flex-wrap items-center gap-2">
        <Pill>{event.kind}</Pill>
        <Pill>{event.mode}</Pill>
        <Pill>Held</Pill>
      </div>

      <p className="font-mono mt-4 text-[0.72rem] tabular-nums text-slate-ink">
        {formatEventDate(event.startsAt)}
        {event.endsAt ? ` — ${formatDate(event.endsAt)}` : ""}
      </p>
      <h3 className="font-display mt-2 text-xl leading-snug text-ink">
        <Link
          href={{ pathname: `/events/${event.slug}` }}
          className="transition-colors hover:text-maroon"
        >
          {event.title}
        </Link>
      </h3>
      <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
        {event.summary}
      </p>
      <p className="mt-2.5 text-[0.85rem] leading-relaxed text-slate-ink">
        {event.description}
      </p>

      <dl className="font-mono mt-5 space-y-1 border-t border-line pt-4 text-[0.72rem] text-slate-ink">
        <div className="flex justify-between gap-3">
          <dt>Venue</dt>
          <dd className="text-right text-ink">{event.venue}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Entry</dt>
          <dd className="tabular-nums text-ink">
            {event.ticketPriceInr === 0 ? "Free" : inr(event.ticketPriceInr)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Attended</dt>
          <dd className="tabular-nums text-ink">{event.attending}</dd>
        </div>
        {event.seatsLeft !== null ? (
          <div className="flex justify-between gap-3">
            <dt>Unused seats</dt>
            <dd className="tabular-nums text-ink">{event.seatsLeft}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href={mailto}
          className="font-mono inline-flex items-center gap-2 border border-ink/25 px-5 py-2.5 text-[0.75rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-maroon hover:text-maroon"
        >
          Feedback form →
        </a>
        <Button href={{ pathname: `/events/${event.slug}` }} variant="ghost">
          Event page
        </Button>
      </div>
      <p className="mt-2 text-[0.78rem] leading-snug text-slate-ink">
        The feedback form opens an email to {RITAA.email} with this event in the subject
        line and the prompts in the body. The organising committee reads every one.
      </p>
    </article>
  );
}

export default function EventsPage() {
  const upcoming = useQuery(api.events.list, { window: "upcoming" });
  const past = useQuery(api.events.list, { window: "past" });
  const [kind, setKind] = useState<EventKind | "all">("all");

  const upcomingList = upcoming ?? [];
  const pastList = past ?? [];
  const attending = upcomingList.reduce((sum, e) => sum + e.attending, 0);
  const ticketed = upcomingList.filter((e) => e.ticketPriceInr > 0).length;

  // Only offer the types actually on the calendar, so no filter leads nowhere.
  const kinds = Array.from(new Set(upcomingList.map((e) => e.kind)));
  const shown = kind === "all" ? upcomingList : upcomingList.filter((e) => e.kind === kind);

  return (
    <>
      <PageHeader
      image="/campus-6.jpg"
        module="Module 07 · Event Management"
        title="Reunions, clinics, leagues — and a seat held in your name."
        lede="Every RITAA event lives here: what it is, where it is, what it costs and who is already coming. Register once and your response is on the register under your email address."
      >
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={upcoming ? upcomingList.length : "—"} label="Open for registration" onDark />
          <Stat value={upcoming ? attending : "—"} label="Alumni & guests attending" onDark />
          <Stat value={upcoming ? ticketed : "—"} label="Ticketed events" onDark />
          <Stat value={past ? pastList.length : "—"} label="Events in the archive" onDark />
        </div>
      </PageHeader>

      {/* ---- Upcoming: the working part of the module --------------------- */}
      <Shell>
        <section id="upcoming" className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Upcoming"
            title="Open for registration"
            lede="Webinars, reunions, sports and networking. Responses are keyed to your email address, so you can change your mind — or withdraw — later without inflating the headcount. Ticketed events state the amount up front and collect it at the registration desk."
          />

          {/* Event types, straight from the brief's own list. */}
          {kinds.length > 1 ? (
            <fieldset className="mb-8">
              <legend className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-ink">
                Filter by type
              </legend>
              <div className="mt-2 flex flex-wrap gap-px bg-line">
                {(["all", ...kinds] as const).map((value) => {
                  const active = kind === value;
                  return (
                    <label key={value} className="block">
                      <input
                        type="radio"
                        name="event-kind"
                        value={value}
                        checked={active}
                        onChange={() => setKind(value)}
                        className="peer sr-only"
                      />
                      <span
                        className={`font-mono block cursor-pointer px-4 py-2 text-center text-[0.7rem] uppercase tracking-[0.12em] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-maroon ${
                          active ? "bg-ink text-bone" : "bg-white text-slate-ink"
                        }`}
                      >
                        {value === "all" ? "All types" : KIND_LABEL[value]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {upcoming === undefined ? (
            <LoadingRows rows={3} />
          ) : upcomingList.length === 0 ? (
            <Empty
              title="Nothing is open for registration right now"
              hint="The next Sangamam and the RACE founder clinic dates are announced at the general body meeting, then published here first."
              action={
                <Button href="/stories" variant="outline">
                  Read past event recaps
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            <Empty
              title={`No ${KIND_LABEL[kind as EventKind].toLowerCase()} are on the calendar`}
              hint="Other event types are still open for registration."
              action={
                <Button variant="outline" onClick={() => setKind("all")}>
                  Show all types
                </Button>
              }
            />
          ) : (
            <div className="grid gap-px bg-line">
              {shown.map((event) => (
                <UpcomingEvent key={event._id} event={event} />
              ))}
            </div>
          )}
        </section>
      </Shell>

      {/* ---- Past: quieter, plus the feedback route ----------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Archive"
            title="Past events"
            lede="Held and closed. Attendance is kept on record, photographs move to the gallery, and the feedback form still reaches the organising committee."
            action={
              <Button href="/gallery" variant="outline">
                Event gallery
              </Button>
            }
          />

          {past === undefined ? (
            <LoadingRows rows={2} />
          ) : pastList.length === 0 ? (
            <Empty
              title="The archive is still empty"
              hint="Once an event has been held it moves here with its attendance on record."
            />
          ) : (
            <div className="grid gap-px bg-line sm:grid-cols-2">
              {pastList.map((event) => (
                <PastEvent key={event._id} event={event} />
              ))}
            </div>
          )}

          <p className="font-mono mt-10 text-[0.72rem] leading-relaxed uppercase tracking-[0.12em] text-slate-ink">
            Organising something? Write to {RITAA.email} · {RITAA.phone}
          </p>
        </Shell>
      </section>
    </>
  );
}
