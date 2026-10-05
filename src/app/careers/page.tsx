"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { FormEvent, ReactNode } from "react";
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
  VerifiedMark,
} from "@/components/kit";
import { BATCH_YEARS, formatDate, RITAA } from "@/lib/site";

/**
 * Module 4 — Career Hub.
 *
 * The brief asks for three things here, and each one has a section:
 *   1. job and internship posting by alumni/entrepreneurs → the board + the
 *      posting desk, wired to `careers.postJob`;
 *   2. resume upload and referral system → `referrals.requestReferral`, which
 *      validates a request against the live job row and composes the whole
 *      request for the poster;
 *   3. career mentoring module → real mentors, drawn from
 *      `careers.listMentors` on the career-shaped topics, bookable on /mentorship.
 *
 * Two limitations are stated on the page rather than papered over. Referral
 * requests travel by email because `schema.ts` has no table to keep them in.
 * Resumes are collected by email because the storage id of an uploaded file has
 * nowhere to be recorded either — an uploader would put a member's personal
 * document somewhere nobody could ever list, replace or delete.
 */

type Job = FunctionReturnType<typeof api.careers.listJobs>[number];
type Mentor = FunctionReturnType<typeof api.careers.listMentors>[number];
type ReferralDraft = FunctionReturnType<typeof api.referrals.requestReferral>;
type JobType = "full-time" | "internship" | "contract";

const JOB_TYPES: { id: JobType; label: string }[] = [
  { id: "full-time", label: "Full-time" },
  { id: "internship", label: "Internship" },
  { id: "contract", label: "Contract" },
];

/**
 * Mentor topics that belong to a career conversation rather than to study
 * plans or founding a company. Only the ones an alumnus has actually claimed
 * are shown, so this list is a filter, not a promise.
 */
const CAREER_TOPICS = new Set([
  "Interview preparation",
  "Resume review",
  "Moving into product",
  "Switching to analytics",
  "Growing into a lead role",
  "Relocating for work",
  "Working abroad",
  "Building a portfolio",
  "Core engineering careers",
  "Product engineering",
  "Data science careers",
  "VLSI careers",
  "Site roles vs design roles",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFERRAL_NOTE_MAX = 1200;

const inputCx =
  "w-full border border-line bg-white px-3 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-ink/55 focus:border-maroon";

const chipCx =
  "font-mono inline-flex items-center gap-2 border px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] transition-colors";

/** Convex wraps server errors with request ids; surface the sentence thrown. */
function thrownMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/Uncaught Error:\s*([\s\S]*?)(?:\n\s*at\s|$)/);
  return (match ? match[1] : raw).trim();
}

function mailtoHref(to: string, subject: string, body?: string) {
  const query = [`subject=${encodeURIComponent(subject)}`];
  if (body) query.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to}?${query.join("&")}`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

/** Labelled form row. Every control on this page is a real element. */
function Field({
  id,
  label,
  error,
  hint,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
      >
        {label}
        {optional ? (
          <span className="text-slate-ink/60"> — optional</span>
        ) : (
          <span className="text-maroon"> *</span>
        )}
      </label>
      <div className="mt-2">{children}</div>
      {hint && !error ? (
        <p className="mt-1.5 text-[0.75rem] leading-snug text-slate-ink">{hint}</p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="font-mono mt-1.5 text-[0.7rem] leading-snug text-maroon"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---- Referral system ------------------------------------------------------ */

type ReferralForm = {
  name: string;
  email: string;
  batch: string;
  currentRole: string;
  resumeUrl: string;
  message: string;
};

const EMPTY_REFERRAL: ReferralForm = {
  name: "",
  email: "",
  batch: "",
  currentRole: "",
  resumeUrl: "",
  message: "",
};

type ReferralErrors = Partial<Record<keyof ReferralForm | "form", string>>;

/**
 * The referral request. The mutation checks the role is still open and still
 * offering a referral, then writes the request out in full; this panel hands it
 * to the candidate's mail client and says plainly that the portal keeps no copy.
 */
function ReferralRequest({ job, onDone }: { job: Job; onDone: () => void }) {
  const requestReferral = useMutation(api.referrals.requestReferral);
  const [form, setForm] = useState<ReferralForm>(EMPTY_REFERRAL);
  const [errors, setErrors] = useState<ReferralErrors>({});
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<ReferralDraft | null>(null);
  const [copied, setCopied] = useState(false);

  const fid = (field: string) => `ref-${job._id}-${field}`;

  function set<K extends keyof ReferralForm>(key: K, value: ReferralForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key] && !prev.form) return prev;
      const next = { ...prev };
      delete next[key];
      delete next.form;
      return next;
    });
  }

  function validate(): ReferralErrors {
    const next: ReferralErrors = {};
    if (form.name.trim().length < 2)
      next.name = "Enter your full name — the referral goes forward under it.";
    if (!EMAIL_RE.test(form.email.trim()))
      next.email = "Enter a working email, e.g. you@example.com.";
    if (form.message.trim().length < 40)
      next.message =
        "Write at least a couple of sentences on why you fit this role — one line is not something anyone can forward.";
    if (form.message.trim().length > REFERRAL_NOTE_MAX)
      next.message = `Trim this to ${REFERRAL_NOTE_MAX} characters so it fits in one email.`;
    if (
      form.resumeUrl.trim().length > 0 &&
      !/^https?:\/\//i.test(form.resumeUrl.trim())
    )
      next.resumeUrl =
        "Start the link with https:// — or leave it empty and attach the PDF instead.";
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      const built = await requestReferral({
        jobId: job._id,
        candidateName: form.name.trim(),
        candidateEmail: form.email.trim(),
        candidateBatch: form.batch ? Number(form.batch) : undefined,
        currentRole: form.currentRole.trim() || undefined,
        resumeUrl: form.resumeUrl.trim() || undefined,
        message: form.message.trim(),
      });
      setDraft(built);
      setErrors({});
    } catch (err) {
      setErrors({
        form:
          thrownMessage(err) ||
          "The request could not be prepared. Check your connection and try again.",
      });
    } finally {
      setPending(false);
    }
  }

  async function copyRequest() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setErrors({});
    } catch {
      setCopied(false);
      setErrors({
        form: "This browser blocked copying — select the text below and copy it by hand.",
      });
    }
  }

  if (draft) {
    return (
      <div className="mt-5 border border-jade/40 bg-jade/8 p-5">
        <Eyebrow tone="slate">Request ready</Eyebrow>
        <h4 className="font-display mt-2 text-lg leading-snug text-ink">
          Your referral request to {draft.postedByName} is written.
        </h4>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          Open it in your mail app and send it. {firstName(draft.postedByName)}{" "}
          replies to you directly.
          {draft.storedInPortal ? null : (
            <>
              {" "}
              The portal does not keep a copy — there is no referral table in the
              database yet, so this email is the whole record. Quote the reference
              if you follow up.
            </>
          )}
        </p>
        {draft.needsResumeAttachment ? (
          <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
            You did not give a resume link, so attach your PDF to the email before
            you send it.
          </p>
        ) : null}

        <dl className="font-mono mt-4 space-y-1 text-[0.72rem] text-slate-ink">
          <div className="flex justify-between gap-3">
            <dt>To</dt>
            <dd className="text-right text-ink">{draft.to}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Reference</dt>
            <dd className="text-right tabular-nums text-ink">{draft.reference}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Prepared</dt>
            <dd className="tabular-nums text-ink">{formatDate(draft.requestedAt)}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <label
            htmlFor={fid("preview")}
            className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
          >
            The request, exactly as it will be sent
          </label>
          <textarea
            id={fid("preview")}
            readOnly
            rows={12}
            value={draft.body}
            className={`${inputCx} mt-2 text-[0.78rem] leading-relaxed`}
          />
        </div>

        {errors.form ? (
          <p
            role="alert"
            className="font-mono mt-3 border border-maroon/30 bg-maroon/8 px-4 py-3 text-[0.72rem] leading-snug text-maroon"
          >
            {errors.form}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button href={mailtoHref(draft.to, draft.subject, draft.body)}>
            Open in my mail app
          </Button>
          <Button variant="outline" onClick={copyRequest}>
            {copied ? "Copied" : "Copy the request"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(null);
              setCopied(false);
            }}
          >
            Edit it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-5 grid gap-4 border border-line bg-bone p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <Eyebrow tone="slate">Referral request</Eyebrow>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          {job.postedByName} will refer candidates for this role. Fill this in and
          the hub writes the request — role details, your details, your note — for
          you to send from your own inbox.
        </p>
      </div>

      <Field id={fid("name")} label="Your name" error={errors.name}>
        <input
          id={fid("name")}
          name="candidateName"
          type="text"
          autoComplete="name"
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? `${fid("name")}-error` : undefined}
          className={inputCx}
        />
      </Field>

      <Field id={fid("email")} label="Your email" error={errors.email}>
        <input
          id={fid("email")}
          name="candidateEmail"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(event) => set("email", event.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${fid("email")}-error` : undefined}
          placeholder="you@example.com"
          className={inputCx}
        />
      </Field>

      <Field id={fid("batch")} label="Your batch" optional>
        <select
          id={fid("batch")}
          name="candidateBatch"
          value={form.batch}
          onChange={(event) => set("batch", event.target.value)}
          className={inputCx}
        >
          <option value="">Not an RIT batch year</option>
          {[...BATCH_YEARS].reverse().map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={fid("role")}
        label="Where you are now"
        optional
        hint="Company and title, or college and year."
      >
        <input
          id={fid("role")}
          name="currentRole"
          type="text"
          value={form.currentRole}
          onChange={(event) => set("currentRole", event.target.value)}
          placeholder="QA Engineer, Zoho"
          className={inputCx}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field
          id={fid("resume")}
          label="Resume link"
          optional
          error={errors.resumeUrl}
          hint="A link you control — Drive, LinkedIn, your own site. Leave it empty and attach the PDF to the email instead."
        >
          <input
            id={fid("resume")}
            name="resumeUrl"
            type="url"
            inputMode="url"
            value={form.resumeUrl}
            onChange={(event) => set("resumeUrl", event.target.value)}
            aria-invalid={Boolean(errors.resumeUrl)}
            aria-describedby={errors.resumeUrl ? `${fid("resume")}-error` : undefined}
            placeholder="https://drive.google.com/…"
            className={inputCx}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field
          id={fid("message")}
          label="Why you fit this role"
          error={errors.message}
          hint={`Two or three sentences ${firstName(job.postedByName)} can forward internally without rewriting.`}
        >
          <textarea
            id={fid("message")}
            name="message"
            rows={5}
            maxLength={REFERRAL_NOTE_MAX}
            value={form.message}
            onChange={(event) => set("message", event.target.value)}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? `${fid("message")}-error` : undefined}
            placeholder={`The closest thing you have shipped to ${job.skills[0] ?? "this stack"}, and why this role is the next step.`}
            className={inputCx}
          />
        </Field>
      </div>

      {errors.form ? (
        <p
          role="alert"
          className="font-mono sm:col-span-2 border border-maroon/30 bg-maroon/8 px-4 py-3 text-[0.72rem] leading-snug text-maroon"
        >
          {errors.form}
        </p>
      ) : null}

      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Preparing…" : "Prepare the request"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ---- The board ----------------------------------------------------------- */

function JobCard({ job }: { job: Job }) {
  const [askOpen, setAskOpen] = useState(false);
  const hasLink = Boolean(job.applyUrl && job.applyUrl.trim().length > 0);
  const applyHref = hasLink
    ? job.applyUrl!
    : mailtoHref(
        job.postedByEmail,
        `Application — ${job.title} at ${job.company}`,
      );
  const panelId = `referral-${job._id}`;

  return (
    <article className="flex flex-col bg-white p-7">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brass">{job.type}</Pill>
        {job.referralOffered ? (
          <Pill tone="jade">Referral offered</Pill>
        ) : (
          <Pill>Direct application</Pill>
        )}
      </div>

      <h3 className="font-display mt-4 text-xl leading-snug text-ink">{job.title}</h3>
      <p className="mt-1 text-[0.95rem] leading-snug text-ink">{job.company}</p>

      <dl className="font-mono mt-4 space-y-1 text-[0.72rem] text-slate-ink">
        <div className="flex justify-between gap-3">
          <dt>Location</dt>
          <dd className="text-right text-ink">{job.location}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Commitment</dt>
          <dd className="text-right text-ink">{job.type}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Experience</dt>
          <dd className="text-right text-ink">{job.experience}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Posted</dt>
          <dd className="tabular-nums text-ink">{formatDate(job.createdAt)}</dd>
        </div>
      </dl>

      <p className="mt-4 text-[0.9rem] leading-relaxed text-slate-ink">
        {job.description}
      </p>

      {job.skills.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {job.skills.map((skill) => (
            <Pill key={skill}>{skill}</Pill>
          ))}
        </div>
      ) : null}

      <div className="mt-auto pt-6">
        <div className="flex items-center gap-3 border-t border-line pt-5">
          <Monogram name={job.postedByName} size="sm" tone="ink" />
          <div className="min-w-0">
            <p className="text-[0.85rem] leading-snug text-ink">
              Posted by {job.postedByName}
            </p>
            <p className="font-mono text-[0.7rem] tabular-nums text-brass">
              {job.postedByBatch ? (
                <>Batch &rsquo;{String(job.postedByBatch).slice(2)} · </>
              ) : null}
              {job.referralOffered ? "Will refer" : "Alumni post"}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button href={applyHref}>{hasLink ? "Apply" : "Apply by email"}</Button>
          {job.referralOffered ? (
            <button
              type="button"
              aria-expanded={askOpen}
              aria-controls={panelId}
              onClick={() => setAskOpen((open) => !open)}
              className="font-mono inline-flex items-center justify-center gap-2 border border-ink/25 px-5 py-2.5 text-[0.75rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-maroon hover:text-maroon"
            >
              {askOpen
                ? "Hide the referral request"
                : `Ask ${firstName(job.postedByName)} for a referral`}
            </button>
          ) : null}
        </div>
        {!hasLink ? (
          <p className="mt-3 text-[0.78rem] leading-snug text-slate-ink">
            No application link was given, so Apply writes to{" "}
            {firstName(job.postedByName)} at {job.postedByEmail}.
          </p>
        ) : null}

        {job.referralOffered ? (
          <div id={panelId}>
            {askOpen ? (
              <ReferralRequest job={job} onDone={() => setAskOpen(false)} />
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/* ---- Career mentoring ---------------------------------------------------- */

function MentorCard({ mentor, topic }: { mentor: Mentor; topic: string }) {
  return (
    <article className="bg-white p-6">
      <div className="flex items-start gap-3">
        <Monogram name={mentor.name} size="md" />
        <div className="min-w-0">
          <h3 className="font-display text-lg leading-snug text-ink">{mentor.name}</h3>
          <p className="font-mono mt-0.5 text-[0.7rem] tabular-nums text-brass">
            {mentor.department} · &rsquo;{String(mentor.batch).slice(2)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[0.88rem] leading-snug text-ink">{mentor.designation}</p>
      <p className="text-[0.88rem] leading-snug text-slate-ink">
        {mentor.company} · {mentor.region}
      </p>
      {mentor.bio ? (
        <p className="mt-3 text-[0.82rem] leading-relaxed text-slate-ink">
          {mentor.bio}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {mentor.verified ? <VerifiedMark /> : null}
        {mentor.mentorTopics
          .filter((entry) => CAREER_TOPICS.has(entry))
          .slice(0, 3)
          .map((entry) => (
            <Pill key={entry} tone={entry === topic ? "jade" : "quiet"}>
              {entry}
            </Pill>
          ))}
      </div>
      <div className="mt-5">
        <Button href="/mentorship#request" variant="outline">
          Book with {firstName(mentor.name)}
        </Button>
      </div>
    </article>
  );
}

/* ---- Posting desk -------------------------------------------------------- */

type JobForm = {
  title: string;
  company: string;
  location: string;
  type: JobType;
  experience: string;
  description: string;
  skills: string;
  applyUrl: string;
  postedByName: string;
  postedByEmail: string;
  postedByBatch: string;
  referralOffered: boolean;
};

const EMPTY_FORM: JobForm = {
  title: "",
  company: "",
  location: "",
  type: "full-time",
  experience: "",
  description: "",
  skills: "",
  applyUrl: "",
  postedByName: "",
  postedByEmail: "",
  postedByBatch: "",
  referralOffered: false,
};

type JobErrors = Partial<Record<keyof JobForm | "form", string>>;

export default function CareersPage() {
  const [type, setType] = useState<JobType | "all">("all");
  const [referralOnly, setReferralOnly] = useState(false);

  /**
   * Filtering happens on the server. The unfiltered query runs alongside it
   * purely to label the tabs with real counts — when no filter is active both
   * calls carry identical args, so Convex serves them as one subscription.
   */
  const jobs = useQuery(api.careers.listJobs, {
    type: type === "all" ? undefined : type,
    referralOnly: referralOnly ? true : undefined,
  });
  const board = useQuery(api.careers.listJobs, {});

  const all = board ?? [];
  const countOf = (t: JobType) => all.filter((j) => j.type === t).length;
  const referralCount = all.filter((j) => j.referralOffered).length;
  const companyCount = new Set(all.map((j) => j.company)).size;

  /* Career mentoring — module 4's third clause, on real mentor rows. */
  const topicRows = useQuery(api.careers.mentorTopics);
  const careerTopics = useMemo(
    () => (topicRows ?? []).filter((t) => CAREER_TOPICS.has(t.topic)).slice(0, 5),
    [topicRows],
  );
  const [chosenTopic, setChosenTopic] = useState<string | null>(null);
  const activeTopic =
    (chosenTopic && careerTopics.some((t) => t.topic === chosenTopic)
      ? chosenTopic
      : careerTopics[0]?.topic) ?? null;
  const mentors = useQuery(
    api.careers.listMentors,
    activeTopic ? { topic: activeTopic } : "skip",
  );
  const mentorList = (mentors ?? []).slice(0, 3);

  const postJob = useMutation(api.careers.postJob);
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<JobErrors>({});
  const [pending, setPending] = useState(false);
  const [posted, setPosted] = useState<{ title: string; company: string } | null>(
    null,
  );

  function set<K extends keyof JobForm>(key: K, value: JobForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key] && !prev.form) return prev;
      const next = { ...prev };
      delete next[key];
      delete next.form;
      return next;
    });
  }

  function parseSkills(raw: string) {
    const seen = new Set<string>();
    for (const part of raw.split(",")) {
      const skill = part.trim();
      if (skill.length > 0) seen.add(skill);
    }
    return [...seen];
  }

  function validate(): JobErrors {
    const next: JobErrors = {};
    if (form.title.trim().length < 3)
      next.title = "Name the role as the candidate will see it, e.g. Backend Engineer II.";
    if (form.company.trim().length < 2)
      next.company = "Enter the company or institution hiring.";
    if (form.location.trim().length < 2)
      next.location = "Enter a city, or Remote.";
    if (form.experience.trim().length < 1)
      next.experience = "State the experience expected, e.g. 0–2 years.";
    if (form.description.trim().length < 30)
      next.description =
        "Describe the role in at least a sentence — a title alone gets no applications.";
    if (parseSkills(form.skills).length === 0)
      next.skills = "List at least one skill, separated by commas.";
    if (form.applyUrl.trim().length > 0 && !/^https?:\/\//i.test(form.applyUrl.trim()))
      next.applyUrl =
        "Start the link with https:// — or leave it empty to take applications by email.";
    if (form.postedByName.trim().length < 2)
      next.postedByName = "Enter your name so candidates know who posted this.";
    if (!EMAIL_RE.test(form.postedByEmail.trim()))
      next.postedByEmail = "Enter a working email, e.g. name@company.com.";
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      await postJob({
        title: form.title.trim(),
        company: form.company.trim(),
        location: form.location.trim(),
        type: form.type,
        experience: form.experience.trim(),
        description: form.description.trim(),
        skills: parseSkills(form.skills),
        applyUrl: form.applyUrl.trim() ? form.applyUrl.trim() : undefined,
        postedByName: form.postedByName.trim(),
        postedByEmail: form.postedByEmail.trim(),
        postedByBatch: form.postedByBatch ? Number(form.postedByBatch) : undefined,
        referralOffered: form.referralOffered,
      });
      setPosted({ title: form.title.trim(), company: form.company.trim() });
      setForm(EMPTY_FORM);
      setErrors({});
    } catch (err) {
      setErrors({
        form:
          thrownMessage(err) ||
          "The post did not save. Check your connection and submit it again.",
      });
    } finally {
      setPending(false);
    }
  }

  const resumeMailto = mailtoHref(
    RITAA.email,
    "Resume for the RITAA career hub",
  );

  /** Empty-state hint that names the filters actually holding the list back. */
  const typeLabel = JOB_TYPES.find((t) => t.id === type)?.label;
  const relaxHints = [
    typeLabel ? `clear the ${typeLabel} filter` : null,
    referralOnly ? "switch off “Referrals offered only”" : null,
  ].filter(Boolean) as string[];
  const emptyHint =
    relaxHints.length > 0
      ? `Try again once you ${relaxHints.join(" and ")} — the board carries ${all.length} ${
          all.length === 1 ? "role" : "roles"
        } in total.`
      : "There is nothing on the board at all yet. Post the role you are hiring for — the hub is only as good as what alumni put on it.";

  return (
    <>
      <PageHeader
      image="/campus-3.jpg"
        module="Module 04 · Career Hub"
        title="Roles posted by alumni who will put their name on you."
        lede="Openings and internships shared by RIT graduates and the entrepreneurs among them. Where a referral is offered, you fill in one request and the hub writes it out for the alumnus who posted the role."
      >
        <div className="grid max-w-2xl grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={board ? all.length : "—"} label="Open roles" onDark />
          <Stat
            value={board ? countOf("internship") : "—"}
            label="Internships"
            onDark
          />
          <Stat value={board ? referralCount : "—"} label="With a referral" onDark />
          <Stat value={board ? companyCount : "—"} label="Companies hiring" onDark />
        </div>
      </PageHeader>

      {/* ---- The board ---------------------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Openings"
            title="What alumni are hiring for"
            lede="Filter by commitment, or narrow to the roles where an alumnus has offered to refer you personally."
            action={
              <Button href="#post" variant="outline">
                Post a role
              </Button>
            }
          />

          <div className="mb-8 flex flex-col gap-4 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Filter roles by type"
            >
              <button
                type="button"
                aria-pressed={type === "all"}
                onClick={() => setType("all")}
                className={`${chipCx} ${
                  type === "all"
                    ? "border-maroon bg-maroon text-bone"
                    : "border-line bg-white text-slate-ink hover:border-brass hover:text-ink"
                }`}
              >
                All
                <span className="tabular-nums opacity-70">{all.length}</span>
              </button>
              {JOB_TYPES.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={type === tab.id}
                  onClick={() => setType(tab.id)}
                  className={`${chipCx} ${
                    type === tab.id
                      ? "border-maroon bg-maroon text-bone"
                      : "border-line bg-white text-slate-ink hover:border-brass hover:text-ink"
                  }`}
                >
                  {tab.label}
                  <span className="tabular-nums opacity-70">{countOf(tab.id)}</span>
                </button>
              ))}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={referralOnly}
                onChange={(event) => setReferralOnly(event.target.checked)}
                className="size-4 shrink-0 accent-maroon"
              />
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                Referrals offered only
                <span className="tabular-nums text-brass"> ({referralCount})</span>
              </span>
            </label>
          </div>

          {jobs === undefined ? (
            <LoadingRows rows={4} />
          ) : jobs.length === 0 ? (
            <Empty
              title={
                relaxHints.length > 0
                  ? "No role matches these filters."
                  : "The board is empty."
              }
              hint={emptyHint}
              action={
                relaxHints.length > 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setType("all");
                      setReferralOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button href="#post" variant="outline">
                    Post a role
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-px bg-line lg:grid-cols-2">
              {jobs.map((job) => (
                <JobCard key={job._id} job={job} />
              ))}
            </div>
          )}
        </section>
      </Shell>

      {/* ---- Posting desk + the honest resume answer ---------------------- */}
      <section id="post" className="scroll-mt-24 border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Post a role"
            title="Hiring? Put it in front of every batch."
            lede="Open to alumni and to the entrepreneurs on RACE. Posts go live immediately and stay on the board until the association archives them."
          />

          <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
            <div>
              {posted ? (
                <div className="border border-jade/40 bg-jade/8 p-7">
                  <Eyebrow tone="slate">Live on the board</Eyebrow>
                  <h3 className="font-display mt-2 text-2xl leading-snug text-ink">
                    {posted.title} at {posted.company} is posted.
                  </h3>
                  <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
                    It is visible in the list above to every member right now, under
                    its type tab. Applications reach you at the email you gave — if
                    you offered a referral, candidates send you a written request
                    from the card, so watch that inbox.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button onClick={() => setPosted(null)}>Post another role</Button>
                    <Button href="/careers" variant="outline">
                      Back to the board
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field id="job-title" label="Role title" error={errors.title}>
                      <input
                        id="job-title"
                        name="title"
                        type="text"
                        value={form.title}
                        onChange={(event) => set("title", event.target.value)}
                        aria-invalid={Boolean(errors.title)}
                        aria-describedby={errors.title ? "job-title-error" : undefined}
                        placeholder="Backend Engineer II"
                        className={inputCx}
                      />
                    </Field>
                  </div>

                  <Field id="job-company" label="Company" error={errors.company}>
                    <input
                      id="job-company"
                      name="company"
                      type="text"
                      value={form.company}
                      onChange={(event) => set("company", event.target.value)}
                      aria-invalid={Boolean(errors.company)}
                      aria-describedby={errors.company ? "job-company-error" : undefined}
                      placeholder="Zoho"
                      className={inputCx}
                    />
                  </Field>

                  <Field id="job-location" label="Location" error={errors.location}>
                    <input
                      id="job-location"
                      name="location"
                      type="text"
                      value={form.location}
                      onChange={(event) => set("location", event.target.value)}
                      aria-invalid={Boolean(errors.location)}
                      aria-describedby={
                        errors.location ? "job-location-error" : undefined
                      }
                      placeholder="Chennai / Remote"
                      className={inputCx}
                    />
                  </Field>

                  <Field
                    id="job-type"
                    label="Commitment"
                    hint="Internships sit under their own tab on the board."
                  >
                    <select
                      id="job-type"
                      name="type"
                      value={form.type}
                      onChange={(event) => set("type", event.target.value as JobType)}
                      className={inputCx}
                    >
                      {JOB_TYPES.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    id="job-experience"
                    label="Experience"
                    error={errors.experience}
                  >
                    <input
                      id="job-experience"
                      name="experience"
                      type="text"
                      value={form.experience}
                      onChange={(event) => set("experience", event.target.value)}
                      aria-invalid={Boolean(errors.experience)}
                      aria-describedby={
                        errors.experience ? "job-experience-error" : undefined
                      }
                      placeholder="0–2 years"
                      className={inputCx}
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field
                      id="job-description"
                      label="What the work is"
                      error={errors.description}
                    >
                      <textarea
                        id="job-description"
                        name="description"
                        rows={5}
                        value={form.description}
                        onChange={(event) => set("description", event.target.value)}
                        aria-invalid={Boolean(errors.description)}
                        aria-describedby={
                          errors.description ? "job-description-error" : undefined
                        }
                        placeholder="The team, the stack, what the first six months look like, and how the interview runs."
                        className={inputCx}
                      />
                    </Field>
                  </div>

                  <div className="sm:col-span-2">
                    <Field
                      id="job-skills"
                      label="Skills"
                      error={errors.skills}
                      hint="Comma separated. These become the tags on the card."
                    >
                      <input
                        id="job-skills"
                        name="skills"
                        type="text"
                        value={form.skills}
                        onChange={(event) => set("skills", event.target.value)}
                        aria-invalid={Boolean(errors.skills)}
                        aria-describedby={errors.skills ? "job-skills-error" : undefined}
                        placeholder="Java, PostgreSQL, REST"
                        className={inputCx}
                      />
                    </Field>
                  </div>

                  <div className="sm:col-span-2">
                    <Field
                      id="job-apply"
                      label="Application link"
                      optional
                      error={errors.applyUrl}
                      hint="Leave it empty and the Apply button emails you instead."
                    >
                      <input
                        id="job-apply"
                        name="applyUrl"
                        type="url"
                        inputMode="url"
                        value={form.applyUrl}
                        onChange={(event) => set("applyUrl", event.target.value)}
                        aria-invalid={Boolean(errors.applyUrl)}
                        aria-describedby={errors.applyUrl ? "job-apply-error" : undefined}
                        placeholder="https://careers.example.com/be-2"
                        className={inputCx}
                      />
                    </Field>
                  </div>

                  <div className="sm:col-span-2 mt-1 h-px w-full bg-line" />

                  <Field
                    id="job-poster"
                    label="Your name"
                    error={errors.postedByName}
                  >
                    <input
                      id="job-poster"
                      name="postedByName"
                      type="text"
                      autoComplete="name"
                      value={form.postedByName}
                      onChange={(event) => set("postedByName", event.target.value)}
                      aria-invalid={Boolean(errors.postedByName)}
                      aria-describedby={
                        errors.postedByName ? "job-poster-error" : undefined
                      }
                      className={inputCx}
                    />
                  </Field>

                  <Field
                    id="job-email"
                    label="Your email"
                    error={errors.postedByEmail}
                  >
                    <input
                      id="job-email"
                      name="postedByEmail"
                      type="email"
                      autoComplete="email"
                      value={form.postedByEmail}
                      onChange={(event) => set("postedByEmail", event.target.value)}
                      aria-invalid={Boolean(errors.postedByEmail)}
                      aria-describedby={
                        errors.postedByEmail ? "job-email-error" : undefined
                      }
                      placeholder="name@company.com"
                      className={inputCx}
                    />
                  </Field>

                  <Field id="job-batch" label="Your batch" optional>
                    <select
                      id="job-batch"
                      name="postedByBatch"
                      value={form.postedByBatch}
                      onChange={(event) => set("postedByBatch", event.target.value)}
                      className={inputCx}
                    >
                      <option value="">Do not show my batch</option>
                      {[...BATCH_YEARS].reverse().map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div className="sm:col-span-2">
                    <label className="flex cursor-pointer items-start gap-3 border border-line bg-bone p-4">
                      <input
                        type="checkbox"
                        name="referralOffered"
                        checked={form.referralOffered}
                        onChange={(event) =>
                          set("referralOffered", event.target.checked)
                        }
                        className="mt-0.5 size-4 shrink-0 accent-maroon"
                      />
                      <span>
                        <span className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-ink">
                          I will refer candidates for this role
                        </span>
                        <span className="mt-1 block text-[0.8rem] leading-snug text-slate-ink">
                          The card gets a referral badge and a request form that
                          arrives in your inbox complete — role, candidate, resume
                          link and their note. Only tick this if you can actually put
                          a name forward internally.
                        </span>
                      </span>
                    </label>
                  </div>

                  {errors.form ? (
                    <p
                      role="alert"
                      className="font-mono sm:col-span-2 border border-maroon/30 bg-maroon/8 px-4 py-3 text-[0.72rem] leading-snug text-maroon"
                    >
                      {errors.form}
                    </p>
                  ) : null}

                  <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
                    <Button type="submit" disabled={pending}>
                      {pending ? "Posting…" : "Post this role"}
                    </Button>
                    <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                      Goes live immediately
                    </p>
                  </div>
                </form>
              )}
            </div>

            {/* Resume: module 4 asks for upload. This is what is actually true. */}
            <aside>
              <Card>
                <Eyebrow>Resume</Eyebrow>
                <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                  One resume, kept on file by the association
                </h3>
                <p className="mt-3 text-[0.88rem] leading-relaxed text-slate-ink">
                  In-app resume storage is not switched on in this portal yet. There
                  is nowhere in the database to record which file belongs to which
                  member, so an uploader here would leave your document somewhere
                  nobody could list, replace or delete. Until that is fixed, the
                  placement team holds resumes by email and attaches yours when an
                  alumnus asks for candidates.
                </p>

                <div className="mt-5 border border-dashed border-line bg-bone p-5">
                  <span className="font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-brass">
                    Resume (PDF) — send by email
                  </span>
                  <p className="mt-2 text-[0.82rem] leading-relaxed text-slate-ink">
                    Subject line: your name, batch and department. One PDF, under
                    2 MB. You only need to send it once — write again when it
                    changes.
                  </p>
                  <div className="mt-4">
                    <Button href={resumeMailto} variant="outline">
                      Email your resume
                    </Button>
                  </div>
                  <p className="font-mono mt-3 text-[0.7rem] tracking-[0.06em] text-slate-ink">
                    {RITAA.email}
                  </p>
                </div>

                <p className="mt-5 text-[0.82rem] leading-relaxed text-slate-ink">
                  Applying for a role in the meantime? A referral request takes a
                  resume link — Drive, LinkedIn, your own site — and carries it
                  straight to the alumnus, so nothing waits on the office.
                </p>

                <dl className="font-mono mt-6 space-y-1 border-t border-line pt-4 text-[0.72rem] text-slate-ink">
                  <div className="flex justify-between gap-3">
                    <dt>Association office</dt>
                    <dd className="tabular-nums text-ink">{RITAA.phone}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Who can post</dt>
                    <dd className="text-right text-ink">Alumni &amp; RACE founders</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Referral requests</dt>
                    <dd className="text-right text-ink">Delivered by email</dd>
                  </div>
                </dl>
              </Card>
            </aside>
          </div>
        </Shell>
      </section>

      {/* ---- Career mentoring, module 4's third clause -------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Career mentoring"
            title="Ask before you apply."
            lede="Alumni who have already made the move you are weighing up — interviews, a resume that is not landing, service company to product. Pick the question, read who has answered it before, and book half an hour."
            action={
              <Button href="/mentorship" variant="outline">
                All mentors &amp; topics
              </Button>
            }
          />

          {careerTopics.length > 0 ? (
            <div
              className="mb-8 flex flex-wrap gap-2"
              role="group"
              aria-label="Choose a career mentoring topic"
            >
              {careerTopics.map((entry) => (
                <button
                  key={entry.topic}
                  type="button"
                  aria-pressed={activeTopic === entry.topic}
                  onClick={() => setChosenTopic(entry.topic)}
                  className={`${chipCx} ${
                    activeTopic === entry.topic
                      ? "border-maroon bg-maroon text-bone"
                      : "border-line bg-white text-slate-ink hover:border-brass hover:text-ink"
                  }`}
                >
                  {entry.topic}
                  <span className="tabular-nums opacity-70">{entry.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {topicRows === undefined || (activeTopic && mentors === undefined) ? (
            <LoadingRows rows={3} />
          ) : careerTopics.length === 0 ? (
            <Empty
              title="No alumnus has claimed a career topic yet."
              hint="Career mentoring runs off the mentor topics on member profiles. Tick “open to mentor” on your profile and add a topic such as Interview preparation or Resume review."
              action={
                <Button href="/mentorship" variant="outline">
                  Open the mentorship network
                </Button>
              }
            />
          ) : mentorList.length === 0 ? (
            <Empty
              title={`No mentor is listed under ${activeTopic} right now.`}
              hint="Pick another topic above, or open the mentorship network where every topic is listed with the alumni behind it."
              action={
                <Button
                  variant="outline"
                  onClick={() => setChosenTopic(careerTopics[0]?.topic ?? null)}
                >
                  Back to {careerTopics[0]?.topic}
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid gap-px bg-line lg:grid-cols-3">
                {mentorList.map((mentor) => (
                  <MentorCard key={mentor._id} mentor={mentor} topic={activeTopic!} />
                ))}
              </div>
              <p className="mt-6 text-[0.85rem] leading-relaxed text-slate-ink">
                {mentors && mentors.length > mentorList.length
                  ? `${mentors.length - mentorList.length} more ${
                      mentors.length - mentorList.length === 1 ? "alumnus is" : "alumni are"
                    } listed under ${activeTopic}. `
                  : null}
                Booking, preferred slots and the follow-up after the session all live
                on the mentorship page — this is the shortlist for the question the
                board just raised.
              </p>
            </>
          )}
        </Shell>
      </section>
    </>
  );
}
