"use client";

import { api, Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery, type FunctionReturnType, ConvexError } from "@/lib/standalone";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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
import { DEPARTMENT_NAMES, formatDate } from "@/lib/site";

/**
 * Module 5 — Mentorship Network.
 *
 * Mentors are not a separate profile type: they are alumni who ticked
 * "open to mentor" on their directory record, which is why the card here
 * carries the same batch/department/verification furniture as the directory.
 *
 * Matching is by topic rather than by algorithm. The topics are the ones
 * mentors actually declared, with counts, so a seeker can see where the depth
 * is before they pick. A request always targets one named mentor — there is no
 * broadcast, because a request that goes to everyone gets answered by nobody.
 *
 * A booking is not finished when it is sent, so the page carries the rest of the
 * lifecycle too. Where the line falls:
 *
 *  - Open to anyone: the roster, the topic filter, the lifecycle counters, and
 *    sending a request. A student weighing a first internship has no account yet,
 *    and requiring one would cost exactly the people the brief wants reached.
 *  - Signed in only: reading a request back. Tracking your own bookings, a
 *    mentor's inbox and leaving feedback each sit inside <Authenticated>, and the
 *    server derives whose records to return from the session rather than from
 *    anything this page sends it.
 */

type Mentor = FunctionReturnType<typeof api.careers.listMentors>[number];
type TrackedRequest = FunctionReturnType<
  typeof api.mentoring.requestsForSeeker
>[number];
type RequestStatus = TrackedRequest["status"];
type SeekerKind = "student" | "alumnus";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOTE_LIMIT = 800;

const inputCx =
  "w-full border border-line bg-white px-3 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-ink/55 focus:border-maroon";

const chipCx =
  "font-mono inline-flex items-center gap-2 border px-3 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] transition-colors";

const labelCx =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";

const metaCx = "font-mono text-[0.72rem] tabular-nums text-slate-ink";

const DIRECTIONS = [
  {
    label: "Alumni → Alumni",
    title: "Peers a few steps ahead",
    copy: "A 2019 graduate deciding whether to leave a service company for a product team can ask a 2015 graduate who already did it. Domain switches, offers abroad, the first management role, going independent.",
  },
  {
    label: "Alumni → Students",
    title: "Campus to first job",
    copy: "Students still at Rajapalayam get the alumnus who sat the same interview. Internships, GATE and GRE decisions, which electives actually matter, and how a first-round technical round really runs.",
  },
];

/** The booking lifecycle, written out. These are the moves the server allows. */
const LIFECYCLE = [
  {
    n: "01",
    t: "Requested",
    c: "Logged against one mentor and one topic. It stays here, visibly waiting, until that mentor answers.",
  },
  {
    n: "02",
    t: "Accepted or declined",
    c: "Only the mentor it was sent to can answer it, and only a new request can be accepted or declined. Declined is final — the seeker books again rather than reopening it.",
  },
  {
    n: "03",
    t: "Completed",
    c: "Only an accepted request can be completed, and only by that same mentor. They close it after the call actually happened.",
  },
  {
    n: "04",
    t: "Feedback",
    c: "Opens on completion and is submitted once, by the person who booked it: a rating out of five and an optional note that stays with the request.",
  },
];

const STATUS_META: Record<
  RequestStatus,
  { label: string; tone: "quiet" | "brass" | "jade" | "maroon" }
> = {
  requested: { label: "Awaiting mentor", tone: "brass" },
  accepted: { label: "Accepted", tone: "jade" },
  completed: { label: "Completed", tone: "quiet" },
  declined: { label: "Declined", tone: "maroon" },
};

const RATINGS = [
  { value: 1, label: "Not useful" },
  { value: 2, label: "Fair" },
  { value: 3, label: "Useful" },
  { value: 4, label: "Very useful" },
  { value: 5, label: "Decisive" },
];

/**
 * Follow-up tracking is mostly "how long has this been sitting there", so the
 * elapsed figure is deliberately coarse — nobody needs seconds on a request that
 * a working alumnus will answer next weekend.
 */
function since(from: number, now: number) {
  const minutes = Math.max(0, Math.round((now - from) / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days < 21) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} weeks`;
  const months = Math.max(1, Math.floor(days / 30));
  return `${months} month${months === 1 ? "" : "s"}`;
}

/**
 * Elapsed labels are recomputed on a slow tick rather than per render. The lists
 * only ever render after a query resolves on the client, so this never takes part
 * in hydration.
 */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Server refusals are thrown as ConvexError with a plain-language string, so the
 * exact sentence the backend chose is what the person reads — including the
 * authorisation refusals, which have to be legible rather than mysterious.
 */
function readError(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const { data } = error;
    if (typeof data === "string" && data.trim().length > 0) return data;
  }
  return fallback;
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
      <label htmlFor={id} className={labelCx}>
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

/** Inline form-level failure. Same shape wherever a mutation can be refused. */
function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="font-mono border border-maroon/30 bg-maroon/8 px-4 py-3 text-[0.72rem] leading-snug text-maroon"
    >
      {children}
    </p>
  );
}

/** What a visitor without a session sees where their own records would be. */
function SignInWall({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border border-line bg-bone p-7">
      <Eyebrow>Sign in required</Eyebrow>
      <h3 className="font-display mt-2 text-xl leading-snug text-ink">{title}</h3>
      <p className="mt-3 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
        {detail}
      </p>
      <p className="mt-3 max-w-2xl text-[0.85rem] leading-relaxed text-slate-ink">
        Sending a request needs no account — that form stays open, because a student
        weighing a first internship may not have one yet.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/join">Sign in or create an account</Button>
        <Button href="/mentorship#request" variant="outline">
          Book a session instead
        </Button>
      </div>
    </div>
  );
}

/** One booking, from either side of it. `side` only changes whose name leads. */
function RequestRow({
  request,
  now,
  side,
  children,
}: {
  request: TrackedRequest;
  now: number;
  side: "seeker" | "mentor";
  children?: ReactNode;
}) {
  const status = STATUS_META[request.status];
  const age = since(request.createdAt, now);

  return (
    <li className="bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={status.tone}>{status.label}</Pill>
            <Pill>{request.seekerKind === "student" ? "Student" : "Alumnus"}</Pill>
            {request.hasFeedback ? (
              <Pill tone="jade">Rated {request.feedbackRating}/5</Pill>
            ) : null}
          </div>
          <h3 className="font-display mt-3 text-lg leading-snug text-ink">
            {request.topic}
          </h3>
          <p className="font-mono mt-1 text-[0.72rem] tabular-nums text-brass">
            {side === "seeker"
              ? `To ${request.mentorName}`
              : `From ${request.seekerName}`}
            {side === "seeker" && request.mentorBatch
              ? ` · ${request.mentorDepartment} · ’${String(request.mentorBatch).slice(2)}`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[0.72rem] tabular-nums text-ink">{age} ago</p>
          <p className={metaCx}>{formatDate(request.createdAt)}</p>
        </div>
      </div>

      <p className="mt-4 text-[0.88rem] leading-relaxed text-slate-ink">
        {request.message}
      </p>

      <dl className="font-mono mt-4 space-y-1 text-[0.72rem] text-slate-ink">
        <div className="flex justify-between gap-3">
          <dt>Preferred slot</dt>
          <dd className="text-right text-ink">
            {request.preferredSlot ?? "Not stated"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{side === "seeker" ? "Mentor works at" : "Reply to"}</dt>
          <dd className="max-w-[60%] truncate text-right text-ink">
            {side === "seeker"
              ? (request.mentorCompany ?? "Not listed")
              : request.seekerEmail}
          </dd>
        </div>
      </dl>

      {request.awaitingMentor ? (
        <p className="font-mono mt-4 border-l-2 border-brass bg-brass/8 px-3 py-2 text-[0.7rem] leading-snug text-ink">
          No response yet — waiting {age}.
          {side === "mentor"
            ? " Accepting or declining both count as an answer."
            : " Mentors answer on their own schedule; give it a few days."}
        </p>
      ) : null}

      {request.hasFeedback ? (
        <div className="mt-4 border-l-2 border-jade bg-jade/8 px-3 py-2">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-jade">
            Feedback · {request.feedbackRating}/5
          </p>
          {request.feedbackNote ? (
            <p className="mt-1 text-[0.85rem] leading-relaxed text-ink">
              {request.feedbackNote}
            </p>
          ) : (
            <p className="mt-1 text-[0.85rem] text-slate-ink">
              Rating left without a note.
            </p>
          )}
        </div>
      ) : null}

      {children ? (
        <div className="mt-5 border-t border-line pt-5">{children}</div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Seeker side — only ever the caller's own requests                  */
/* ------------------------------------------------------------------ */

/**
 * Rendered inside <Authenticated>, so the query below only runs with a session.
 *
 * `requestsForSeeker` takes no arguments at all: the server reads the address off
 * the session token. There is nothing this component could pass to see somebody
 * else's bookings, which is the point of it having no arguments.
 */
function SeekerTracking() {
  const currentUser = useQuery(api.auth.getCurrentUser);
  const myRequests = useQuery(api.mentoring.requestsForSeeker, {});
  const leaveFeedback = useMutation(api.mentoring.leaveFeedback);
  const now = useNow();

  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const sessionEmail = currentUser?.email ?? "";
  const awaiting = (myRequests ?? []).filter((r) => r.awaitingMentor).length;
  const openForFeedback = (myRequests ?? []).filter((r) => r.feedbackOpen).length;

  function openFeedback(requestId: string) {
    setFeedbackFor(requestId);
    setRating(null);
    setNote("");
    setFeedbackError(null);
  }

  async function onFeedback(
    event: FormEvent<HTMLFormElement>,
    request: TrackedRequest,
  ) {
    event.preventDefault();
    if (rating === null) {
      setFeedbackError("Pick a rating from 1 to 5 before sending.");
      return;
    }
    if (note.trim().length > NOTE_LIMIT) {
      setFeedbackError(
        `Shorten the note to ${NOTE_LIMIT} characters or fewer — it is ${note.trim().length} now.`,
      );
      return;
    }

    setPending(true);
    try {
      await leaveFeedback({
        requestId: request._id,
        rating,
        note: note.trim() ? note.trim() : undefined,
      });
      setFeedbackFor(null);
      setRating(null);
      setNote("");
      setFeedbackError(null);
    } catch (error) {
      setFeedbackError(
        readError(error, "The feedback did not save. Try again in a moment."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem] lg:items-start">
      <div>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border border-line bg-bone p-5">
          <div className="min-w-0">
            <Eyebrow>Signed in as</Eyebrow>
            <p className="font-mono mt-1 truncate text-[0.85rem] text-ink">
              {sessionEmail || "Reading your account…"}
            </p>
          </div>
          <p className="max-w-sm text-[0.8rem] leading-relaxed text-slate-ink">
            A request appears here when it was booked with this address. Book with a
            different one and it belongs to that account, not this one.
          </p>
        </div>

        {myRequests === undefined ? (
          <LoadingRows rows={3} />
        ) : myRequests.length === 0 ? (
          <Empty
            title="No requests booked from your account yet."
            hint="Pick a mentor above and send your first request. Use this address on the form and it appears here with its status."
            action={
              <Button href="/mentorship#request" variant="outline">
                Book a session
              </Button>
            }
          />
        ) : (
          <>
            <p className="font-mono mb-4 border-y border-line py-3 text-[0.72rem] uppercase tracking-[0.12em] text-slate-ink">
              {myRequests.length} request{myRequests.length === 1 ? "" : "s"} ·{" "}
              <span className="text-brass">{awaiting} awaiting a mentor</span> ·{" "}
              <span className="text-jade">
                {openForFeedback} waiting on your feedback
              </span>
            </p>
            <ul className="grid gap-px bg-line">
              {myRequests.map((request) => (
                <RequestRow
                  key={request._id}
                  request={request}
                  now={now}
                  side="seeker"
                >
                  {request.status === "accepted" ? (
                    <p className={metaCx}>
                      Accepted. The rating form opens here once {request.mentorName}{" "}
                      marks the session completed.
                    </p>
                  ) : null}

                  {request.status === "declined" ? (
                    <p className={metaCx}>
                      Declined. Nothing more happens to this request — pick another
                      mentor for the same topic.
                    </p>
                  ) : null}

                  {request.feedbackOpen && feedbackFor !== request._id ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <Button onClick={() => openFeedback(request._id)}>
                        Leave feedback
                      </Button>
                      <p className={metaCx}>
                        {request.mentorName} marked this session completed. One rating
                        and one note, and neither can be edited after.
                      </p>
                    </div>
                  ) : null}

                  {request.feedbackOpen && feedbackFor === request._id ? (
                    <form
                      onSubmit={(event) => onFeedback(event, request)}
                      noValidate
                      className="grid gap-5"
                    >
                      <fieldset
                        aria-describedby={
                          feedbackError ? `fb-${request._id}-error` : undefined
                        }
                      >
                        <legend className={labelCx}>
                          How useful was the session
                          <span className="text-maroon"> *</span>
                        </legend>
                        <div className="mt-2 grid gap-px border border-line bg-line sm:grid-cols-5">
                          {RATINGS.map((option) => (
                            <label
                              key={option.value}
                              className="flex cursor-pointer items-center gap-2 bg-white px-3 py-2.5 text-[0.85rem] text-ink hover:bg-bone"
                            >
                              <input
                                type="radio"
                                name={`rating-${request._id}`}
                                value={option.value}
                                checked={rating === option.value}
                                onChange={() => {
                                  setRating(option.value);
                                  setFeedbackError(null);
                                }}
                                className="accent-maroon"
                              />
                              <span className="font-mono text-[0.72rem] tabular-nums text-brass">
                                {option.value}
                              </span>
                              <span className="leading-snug">{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      <Field
                        id={`fb-note-${request._id}`}
                        label="What was useful, in two lines"
                        optional
                        hint={`${note.trim().length} of ${NOTE_LIMIT} characters. The association reads these.`}
                      >
                        <textarea
                          id={`fb-note-${request._id}`}
                          name="feedbackNote"
                          rows={4}
                          value={note}
                          onChange={(event) => {
                            setNote(event.target.value);
                            setFeedbackError(null);
                          }}
                          placeholder="He walked through his own switch from services to product and told me which two skills to build before applying. I have a plan for the next six months."
                          className={inputCx}
                        />
                      </Field>

                      {feedbackError ? (
                        <div id={`fb-${request._id}-error`}>
                          <Alert>{feedbackError}</Alert>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3">
                        <Button type="submit" disabled={pending}>
                          {pending ? "Sending…" : "Send feedback"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setFeedbackFor(null);
                            setFeedbackError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </RequestRow>
              ))}
            </ul>
          </>
        )}
      </div>

      <aside className="border border-line bg-bone p-6">
        <Eyebrow>Who can see this</Eyebrow>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          Only you. The server works out which requests are yours from your session,
          not from anything typed on this page, so no address can be entered here to
          read somebody else&rsquo;s.
        </p>
        <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
          The mentor sees the same request from their side, because they are the other
          party to it. Nobody else does.
        </p>
        <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
          Feedback can be sent once per session and cannot be edited afterwards, so
          write it after the call rather than during.
        </p>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mentor side — only ever the caller's own inbox                     */
/* ------------------------------------------------------------------ */

/**
 * Rendered inside <Authenticated>. The mentor is not chosen here: it is whichever
 * alumni row carries the caller's email, resolved server-side by
 * `myMentorProfile`. `requestsForMentor` then re-checks that ownership itself, so
 * the id this component passes is a lookup key and never a claim about who is
 * asking.
 */
function MentorInbox() {
  const me = useQuery(api.mentoring.myMentorProfile);
  const inbox = useQuery(
    api.mentoring.requestsForMentor,
    me ? { mentorId: me.alumniId } : "skip",
  );
  const updateStatus = useMutation(api.mentoring.updateStatus);
  const now = useNow();

  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  async function act(
    request: TrackedRequest,
    status: "accepted" | "declined" | "completed",
  ) {
    setActing(request._id);
    setActionError(null);
    try {
      await updateStatus({ requestId: request._id, status });
    } catch (error) {
      setActionError({
        id: request._id,
        message: readError(
          error,
          "That change did not save. Reload the inbox and try again.",
        ),
      });
    } finally {
      setActing(null);
    }
  }

  const awaiting = (inbox ?? []).filter((r) => r.awaitingMentor).length;
  const accepted = (inbox ?? []).filter((r) => r.status === "accepted").length;
  const closed = (inbox ?? []).filter(
    (r) => r.status === "completed" || r.status === "declined",
  ).length;

  if (me === undefined) return <LoadingRows rows={3} />;

  /**
   * Signed in, but no alumni record carries this address — so there is no inbox to
   * show and nothing here to guess at.
   */
  if (me === null) {
    return (
      <div className="border border-line bg-bone p-7">
        <Eyebrow>No alumni record on this address</Eyebrow>
        <h3 className="font-display mt-2 text-xl leading-snug text-ink">
          This account is not on the alumni roster yet.
        </h3>
        <p className="mt-3 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
          An inbox belongs to a directory record, and the association holds no alumni
          profile against the email you signed in with. Get verified as a graduate and
          your profile — and this queue — comes with it.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/join">Get verified</Button>
          <Button href="/directory" variant="outline">
            Alumni directory
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem] lg:items-start">
      <div>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border border-line bg-bone p-5">
          <div className="flex items-start gap-4">
            <Monogram name={me.name} size="md" />
            <div className="min-w-0">
              <p className="font-display text-lg leading-snug text-ink">{me.name}</p>
              <p className={metaCx}>
                {me.designation} · {me.company}
              </p>
              <p className="font-mono mt-1 text-[0.72rem] uppercase tracking-[0.12em] text-brass">
                {awaiting} awaiting · {accepted} accepted · {closed} closed
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {me.verified ? <VerifiedMark /> : null}
            {me.openToMentor ? (
              <Pill tone="jade">Listed as mentoring</Pill>
            ) : (
              <Pill tone="brass">Not currently listed</Pill>
            )}
          </div>
        </div>

        {!me.openToMentor ? (
          <p className="font-mono mb-6 border-l-2 border-brass bg-brass/8 px-3 py-2 text-[0.7rem] leading-snug text-ink">
            Your profile does not have &ldquo;open to mentor&rdquo; ticked, so you are
            not on the roster above. Anything already sent to you still appears here.
          </p>
        ) : null}

        {inbox === undefined ? (
          <LoadingRows rows={3} />
        ) : inbox.length === 0 ? (
          <Empty
            title="Your inbox is empty."
            hint="Nobody has requested time with you yet. Requests appear here the moment they are booked, with the ones still awaiting an answer marked."
          />
        ) : (
          <ul className="grid gap-px bg-line">
            {inbox.map((request) => (
              <RequestRow key={request._id} request={request} now={now} side="mentor">
                <div className="flex flex-wrap items-center gap-3">
                  {request.nextStatuses.includes("accepted") ? (
                    <Button
                      disabled={acting === request._id}
                      onClick={() => act(request, "accepted")}
                    >
                      {acting === request._id ? "Saving…" : "Accept"}
                    </Button>
                  ) : null}
                  {request.nextStatuses.includes("declined") ? (
                    <Button
                      variant="outline"
                      disabled={acting === request._id}
                      onClick={() => act(request, "declined")}
                    >
                      Decline
                    </Button>
                  ) : null}
                  {request.nextStatuses.includes("completed") ? (
                    <Button
                      disabled={acting === request._id}
                      onClick={() => act(request, "completed")}
                    >
                      {acting === request._id ? "Saving…" : "Mark session completed"}
                    </Button>
                  ) : null}
                  {request.nextStatuses.length === 0 ? (
                    <p className={metaCx}>
                      {request.status === "completed"
                        ? request.hasFeedback
                          ? "Completed and rated. Nothing left to do."
                          : "Completed. Waiting on the seeker's rating."
                        : "Declined. This request is closed for good."}
                    </p>
                  ) : null}
                </div>

                {request.status === "accepted" ? (
                  <p className={`${metaCx} mt-3`}>
                    Accepted. Agree a time by email, then come back and mark it
                    completed — that is what unlocks the feedback form.
                  </p>
                ) : null}

                {actionError && actionError.id === String(request._id) ? (
                  <div className="mt-3">
                    <Alert>{actionError.message}</Alert>
                  </div>
                ) : null}
              </RequestRow>
            ))}
          </ul>
        )}
      </div>

      <aside className="border border-line bg-bone p-6">
        <Eyebrow>Read this first</Eyebrow>
        <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
          This queue is yours alone. The server matches your session against the alumni
          record that holds your address and refuses any other mentor&rsquo;s requests,
          so nobody else can read what a student wrote to you.
        </p>
        <ul className="mt-4 space-y-3 border-t border-line pt-4 text-[0.85rem] leading-relaxed text-slate-ink">
          <li>
            <span className="text-ink">Declining is final.</span> The seeker has to
            book again, so decline rather than leaving a request waiting.
          </li>
          <li>
            <span className="text-ink">Completing needs accepting first.</span> A
            request cannot jump straight from awaiting to completed.
          </li>
          <li>
            <span className="text-ink">Completion is the trigger.</span> Until you mark
            it, the seeker cannot rate the session and the association has no record it
            happened.
          </li>
        </ul>
        <div className="mt-5">
          <Button href="/careers" variant="outline">
            Career hub
          </Button>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                              */
/* ------------------------------------------------------------------ */

type RequestErrors = Partial<
  Record<
    "seekerName" | "seekerEmail" | "topic" | "message" | "preferredSlot" | "form",
    string
  >
>;

export default function MentorshipPage() {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const topics = useQuery(api.careers.mentorTopics);
  /**
   * Filtering is server-side. The unfiltered roster runs alongside it for the
   * headline counts and the "All topics" chip — with no topic active both calls
   * carry identical args, so Convex serves them as a single subscription.
   */
  const mentors = useQuery(
    api.careers.listMentors,
    activeTopic ? { topic: activeTopic } : {},
  );
  const roster = useQuery(api.careers.listMentors, {});
  const lifecycleStats = useQuery(api.mentoring.mentorshipStats);

  const all = roster ?? [];
  const verifiedCount = all.filter((m) => m.verified).length;
  const batchCount = new Set(all.map((m) => m.batch)).size;

  const requestMentorship = useMutation(api.careers.requestMentorship);

  // ---- Booking form ------------------------------------------------------
  const [selected, setSelected] = useState<Mentor | null>(null);
  const [seekerName, setSeekerName] = useState("");
  const [seekerEmail, setSeekerEmail] = useState("");
  const [seekerKind, setSeekerKind] = useState<SeekerKind>("student");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [preferredSlot, setPreferredSlot] = useState("");
  const [errors, setErrors] = useState<RequestErrors>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<{
    mentorName: string;
    topic: string;
    email: string;
  } | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  /** Picking a card moves the seeker to the form and puts the cursor in it. */
  useEffect(() => {
    if (!selected) return;
    document
      .getElementById("request")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    nameRef.current?.focus({ preventScroll: true });
  }, [selected]);

  function chooseMentor(mentor: Mentor) {
    setSelected(mentor);
    setSent(null);
    setErrors({});
    // Default the topic to whatever the seeker was already browsing.
    const preset =
      activeTopic && mentor.mentorTopics.includes(activeTopic)
        ? activeTopic
        : (mentor.mentorTopics[0] ?? "");
    setTopic(preset);
  }

  function clearError(key: keyof RequestErrors) {
    setErrors((prev) => {
      if (!prev[key] && !prev.form) return prev;
      const next = { ...prev };
      delete next[key];
      delete next.form;
      return next;
    });
  }

  function validate(): RequestErrors {
    const next: RequestErrors = {};
    if (seekerName.trim().length < 2)
      next.seekerName = "Enter your full name — the mentor sees it before they reply.";
    if (!EMAIL_RE.test(seekerEmail.trim()))
      next.seekerEmail = "Enter the email you actually read, e.g. name@example.com.";
    if (topic.trim().length < 2)
      next.topic = "Choose the topic this conversation is about.";
    if (message.trim().length < 25)
      next.message =
        "Ask one specific question in a couple of sentences. Vague requests go unanswered.";
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setErrors({ form: "Pick a mentor above, then send the request." });
      return;
    }
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    try {
      await requestMentorship({
        mentorId: selected._id,
        seekerName: seekerName.trim(),
        seekerEmail: seekerEmail.trim(),
        seekerKind,
        topic: topic.trim(),
        message: message.trim(),
        preferredSlot: preferredSlot.trim() ? preferredSlot.trim() : undefined,
      });
      setSent({
        mentorName: selected.name,
        topic: topic.trim(),
        email: seekerEmail.trim(),
      });
      setMessage("");
      setPreferredSlot("");
      setSelected(null);
      setErrors({});
    } catch (error) {
      setErrors({
        form: readError(
          error,
          "The request did not send. Check your connection and try again.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
      image="/campus-5.jpg"
        module="Module 05 · Mentorship Network"
        title="One question, one mentor, one half hour."
        lede="RIT alumni mentor each other, and they mentor students still on campus. Pick the topic you are stuck on, read who has done it, send that one person a request — then sign in to follow it through to a rated session."
      >
        <div className="grid max-w-2xl grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat value={roster ? all.length : "—"} label="Alumni mentoring" onDark />
          <Stat value={topics ? topics.length : "—"} label="Topics covered" onDark />
          <Stat value={roster ? batchCount : "—"} label="Batches represented" onDark />
          <Stat value={roster ? verifiedCount : "—"} label="Verified mentors" onDark />
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/mentorship#track" variant="onDark">
            Track your requests
          </Button>
          <Button
            href="/mentorship#inbox"
            variant="ghost"
            className="!text-brass-soft hover:!text-bone"
          >
            Mentor inbox →
          </Button>
        </div>
      </PageHeader>

      {/* ---- Lifecycle numbers, straight off mentorshipStats -------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-3 lg:grid-cols-6">
            <Stat value={lifecycleStats?.total ?? "—"} label="Requests booked" />
            <Stat
              value={lifecycleStats?.byStatus.requested ?? "—"}
              label="Awaiting a mentor"
            />
            <Stat
              value={lifecycleStats?.byStatus.accepted ?? "—"}
              label="Accepted, not yet held"
            />
            <Stat
              value={lifecycleStats?.completedCount ?? "—"}
              label="Sessions completed"
            />
            <Stat
              value={lifecycleStats ? (lifecycleStats.averageRating ?? "—") : "—"}
              label={
                lifecycleStats && lifecycleStats.ratedCount > 0
                  ? `Average rating of ${lifecycleStats.ratedCount}`
                  : "Average rating out of 5"
              }
            />
            <Stat
              value={lifecycleStats?.completedWithFeedback ?? "—"}
              label="Completed with feedback"
            />
          </div>
          {lifecycleStats && lifecycleStats.total > 0 ? (
            <p className="font-mono border-t border-line py-4 text-[0.72rem] uppercase tracking-[0.12em] text-slate-ink">
              {lifecycleStats.fromStudents} from students ·{" "}
              {lifecycleStats.fromAlumni} from alumni ·{" "}
              {lifecycleStats.mentorsEngaged} mentors involved ·{" "}
              {lifecycleStats.byStatus.declined} declined
            </p>
          ) : null}
        </Shell>
      </section>

      {/* ---- Both directions the brief names ------------------------------ */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="How it works"
            title="Mentoring runs in two directions here"
            lede="The association does not treat mentoring as something senior people do to juniors. Most of it happens between alumni who are three or four years apart."
          />
          <div className="grid gap-px bg-line sm:grid-cols-2">
            {DIRECTIONS.map((direction) => (
              <div key={direction.label} className="bg-white p-7">
                <Eyebrow>{direction.label}</Eyebrow>
                <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                  {direction.title}
                </h3>
                <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
                  {direction.copy}
                </p>
              </div>
            ))}
          </div>

          <h3 className="font-display mt-12 text-xl leading-snug text-ink">
            What happens to a booking
          </h3>
          <div className="mt-4 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE.map((step) => (
              <div key={step.n} className="bg-white p-6">
                <span className="font-mono text-[0.7rem] tabular-nums text-brass">
                  {step.n}
                </span>
                <p className="mt-2 text-[0.9rem] leading-snug text-ink">{step.t}</p>
                <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
                  {step.c}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-3xl text-[0.88rem] leading-relaxed text-slate-ink">
            Browsing the roster, filtering by topic and sending a request need no
            account — a student weighing a first internship should not have to sign up
            to ask a question. Reading a request back does. Tracking your own bookings,
            a mentor&rsquo;s inbox and leaving feedback all sit behind sign-in, because
            a request holds someone&rsquo;s question and the address they read, and the
            server will only hand it to the two people it belongs to.
          </p>
        </section>
      </Shell>

      {/* ---- Topic matching + the roster ---------------------------------- */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Profile matching"
            title="Match on the topic, then on the person"
            lede="Topics come from what mentors declared on their own profiles. The count is how many alumni are open to that conversation right now."
          />

          <div className="mb-8 border-y border-line py-4">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Filter mentors by topic"
            >
              <button
                type="button"
                aria-pressed={activeTopic === null}
                onClick={() => setActiveTopic(null)}
                className={`${chipCx} ${
                  activeTopic === null
                    ? "border-maroon bg-maroon text-bone"
                    : "border-line bg-bone text-slate-ink hover:border-brass hover:text-ink"
                }`}
              >
                All topics
                <span className="tabular-nums opacity-70">{all.length}</span>
              </button>
              {(topics ?? []).map((entry) => (
                <button
                  key={entry.topic}
                  type="button"
                  aria-pressed={activeTopic === entry.topic}
                  onClick={() =>
                    setActiveTopic(activeTopic === entry.topic ? null : entry.topic)
                  }
                  className={`${chipCx} ${
                    activeTopic === entry.topic
                      ? "border-maroon bg-maroon text-bone"
                      : "border-line bg-bone text-slate-ink hover:border-brass hover:text-ink"
                  }`}
                >
                  {entry.topic}
                  <span className="tabular-nums opacity-70">{entry.count}</span>
                </button>
              ))}
            </div>
            {activeTopic ? (
              <p className="font-mono mt-4 text-[0.7rem] uppercase tracking-[0.12em] text-brass">
                Showing mentors for {activeTopic}
              </p>
            ) : null}
          </div>

          {mentors === undefined ? (
            <LoadingRows rows={4} />
          ) : mentors.length === 0 ? (
            <Empty
              title="No mentor has claimed this topic yet."
              hint={
                activeTopic
                  ? `Nobody currently lists ${activeTopic}. Clear the filter to see the whole roster, or write to the association and they will ask the batches most likely to know.`
                  : "The roster fills up as alumni tick 'open to mentor' on their profile. Clear the filter and check back."
              }
              action={
                <Button variant="outline" onClick={() => setActiveTopic(null)}>
                  Show all mentors
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {mentors.map((mentor) => (
                <li key={mentor._id} className="flex flex-col bg-white p-6">
                  <div className="flex items-start gap-4">
                    <Monogram name={mentor.name} size="lg" />
                    <div className="min-w-0">
                      <h3 className="font-display text-lg leading-snug text-ink">
                        {mentor.name}
                      </h3>
                      <p className="font-mono mt-1 text-[0.7rem] tabular-nums text-brass">
                        {mentor.department} · &rsquo;{String(mentor.batch).slice(2)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-[0.88rem] leading-snug text-ink">
                    {mentor.designation}
                  </p>
                  <p className="text-[0.88rem] text-slate-ink">{mentor.company}</p>

                  <dl className="font-mono mt-4 space-y-1 text-[0.72rem] text-slate-ink">
                    <div className="flex justify-between gap-3">
                      <dt>Region</dt>
                      <dd className="text-right text-ink">{mentor.region}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Department</dt>
                      <dd className="text-right text-ink">
                        {DEPARTMENT_NAMES[mentor.department] ?? mentor.department}
                      </dd>
                    </div>
                  </dl>

                  {mentor.bio ? (
                    <p className="mt-4 text-[0.85rem] leading-relaxed text-slate-ink">
                      {mentor.bio}
                    </p>
                  ) : null}

                  {mentor.mentorTopics.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {mentor.mentorTopics.map((mentorTopic) => (
                        <Pill
                          key={mentorTopic}
                          tone={mentorTopic === activeTopic ? "brass" : "quiet"}
                        >
                          {mentorTopic}
                        </Pill>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-auto pt-6">
                    <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                      {mentor.verified ? (
                        <VerifiedMark />
                      ) : (
                        <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-slate-ink">
                          Verification pending
                        </span>
                      )}
                      {selected?._id === mentor._id ? (
                        <Pill tone="jade">Selected</Pill>
                      ) : null}
                    </div>
                    <div className="mt-4">
                      <Button onClick={() => chooseMentor(mentor)}>
                        {selected?._id === mentor._id
                          ? "Editing request"
                          : "Request mentorship"}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Shell>
      </section>

      {/* ---- Booking: open to anyone, account or not ---------------------- */}
      <section id="request" className="scroll-mt-24">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Book a session"
            title="Send the request to one person"
            lede="No account needed for this part. The mentor gets your question, your batch status and your preferred slot, and the request sits in their inbox as awaiting until they accept or decline it."
          />

          <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
            <div>
              {sent ? (
                <div className="border border-jade/40 bg-jade/8 p-7">
                  <Eyebrow tone="slate">Request sent</Eyebrow>
                  <h3 className="font-display mt-2 text-2xl leading-snug text-ink">
                    {sent.mentorName} has your request about {sent.topic}.
                  </h3>
                  <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
                    It is logged as <span className="text-ink">awaiting mentor</span>{" "}
                    against{" "}
                    <span className="font-mono text-ink">{sent.email}</span>. Mentors
                    answer on their own schedule, so give it a few days before you
                    follow up.
                  </p>
                  <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
                    To follow it here and rate the session afterwards, sign in with
                    that same address — the tracking list belongs to the account that
                    owns the request, which is what keeps your question private.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button href="/mentorship#track">Go to tracking</Button>
                    <Button variant="outline" onClick={() => setSent(null)}>
                      Request another mentor
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Who this request is going to, and how to change it. */}
                  {selected ? (
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border border-brass/40 bg-brass/8 p-5">
                      <div className="flex items-center gap-4">
                        <Monogram name={selected.name} size="md" />
                        <div>
                          <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-brass">
                            Requesting
                          </p>
                          <p className="font-display text-lg leading-snug text-ink">
                            {selected.name}
                          </p>
                          <p className="font-mono text-[0.7rem] tabular-nums text-slate-ink">
                            {selected.department} · &rsquo;
                            {String(selected.batch).slice(2)} · {selected.company}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline" onClick={() => setSelected(null)}>
                        Change mentor
                      </Button>
                    </div>
                  ) : (
                    <div className="mb-6 border border-dashed border-line bg-white/60 px-6 py-8 text-center">
                      <p className="font-display text-xl text-ink">
                        Pick a mentor to open the form.
                      </p>
                      <p className="mx-auto mt-2 max-w-md text-sm text-slate-ink">
                        Every request goes to one named alumnus. Choose{" "}
                        <span className="font-mono text-[0.8rem] uppercase tracking-[0.1em] text-maroon">
                          Request mentorship
                        </span>{" "}
                        on a card above and the fields appear here, filled with that
                        mentor and your current topic.
                      </p>
                    </div>
                  )}

                  {selected ? (
                    <form
                      onSubmit={onSubmit}
                      noValidate
                      className="grid gap-5 sm:grid-cols-2"
                    >
                      <Field id="req-name" label="Your name" error={errors.seekerName}>
                        <input
                          id="req-name"
                          name="seekerName"
                          ref={nameRef}
                          type="text"
                          autoComplete="name"
                          value={seekerName}
                          onChange={(event) => {
                            setSeekerName(event.target.value);
                            clearError("seekerName");
                          }}
                          aria-invalid={Boolean(errors.seekerName)}
                          aria-describedby={
                            errors.seekerName ? "req-name-error" : undefined
                          }
                          className={inputCx}
                        />
                      </Field>

                      <Field
                        id="req-email"
                        label="Your email"
                        error={errors.seekerEmail}
                        hint="Use the address on your RITAA account to follow this request here afterwards."
                      >
                        <input
                          id="req-email"
                          name="seekerEmail"
                          type="email"
                          autoComplete="email"
                          value={seekerEmail}
                          onChange={(event) => {
                            setSeekerEmail(event.target.value);
                            clearError("seekerEmail");
                          }}
                          aria-invalid={Boolean(errors.seekerEmail)}
                          aria-describedby={
                            errors.seekerEmail ? "req-email-error" : undefined
                          }
                          placeholder="name@example.com"
                          className={inputCx}
                        />
                      </Field>

                      <Field id="req-kind" label="You are">
                        <select
                          id="req-kind"
                          name="seekerKind"
                          value={seekerKind}
                          onChange={(event) =>
                            setSeekerKind(event.target.value as SeekerKind)
                          }
                          className={inputCx}
                        >
                          <option value="student">A student at RIT</option>
                          <option value="alumnus">An RIT alumnus</option>
                        </select>
                      </Field>

                      <Field id="req-topic" label="Topic" error={errors.topic}>
                        {selected.mentorTopics.length > 0 ? (
                          <select
                            id="req-topic"
                            name="topic"
                            value={topic}
                            onChange={(event) => {
                              setTopic(event.target.value);
                              clearError("topic");
                            }}
                            aria-invalid={Boolean(errors.topic)}
                            aria-describedby={
                              errors.topic ? "req-topic-error" : undefined
                            }
                            className={inputCx}
                          >
                            {selected.mentorTopics.map((mentorTopic) => (
                              <option key={mentorTopic} value={mentorTopic}>
                                {mentorTopic}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id="req-topic"
                            name="topic"
                            type="text"
                            value={topic}
                            onChange={(event) => {
                              setTopic(event.target.value);
                              clearError("topic");
                            }}
                            aria-invalid={Boolean(errors.topic)}
                            aria-describedby={
                              errors.topic ? "req-topic-error" : undefined
                            }
                            placeholder="Career switch to product"
                            className={inputCx}
                          />
                        )}
                      </Field>

                      <div className="sm:col-span-2">
                        <Field
                          id="req-message"
                          label="What you want to ask"
                          error={errors.message}
                          hint="Where you are now, what you are deciding, and what a good answer would let you do next. Only the mentor you send it to can read it."
                        >
                          <textarea
                            id="req-message"
                            name="message"
                            rows={5}
                            value={message}
                            onChange={(event) => {
                              setMessage(event.target.value);
                              clearError("message");
                            }}
                            aria-invalid={Boolean(errors.message)}
                            aria-describedby={
                              errors.message ? "req-message-error" : undefined
                            }
                            placeholder="I am in my sixth semester and weighing a product internship against GATE prep. I want to know how the first two years after graduation differ between those paths."
                            className={inputCx}
                          />
                        </Field>
                      </div>

                      <div className="sm:col-span-2">
                        <Field
                          id="req-slot"
                          label="Preferred slot"
                          optional
                          hint="Mentors are working alumni. Naming two or three windows gets a faster reply."
                        >
                          <input
                            id="req-slot"
                            name="preferredSlot"
                            type="text"
                            value={preferredSlot}
                            onChange={(event) => {
                              setPreferredSlot(event.target.value);
                              clearError("preferredSlot");
                            }}
                            placeholder="Weekday evenings after 7 PM IST, or Saturday morning"
                            className={inputCx}
                          />
                        </Field>
                      </div>

                      {errors.form ? (
                        <div className="sm:col-span-2">
                          <Alert>{errors.form}</Alert>
                        </div>
                      ) : null}

                      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
                        <Button type="submit" disabled={pending}>
                          {pending ? "Sending…" : `Send to ${selected.name}`}
                        </Button>
                        <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                          Reply comes by email
                        </p>
                      </div>
                    </form>
                  ) : null}
                </>
              )}
            </div>

            <aside>
              <Card>
                <Eyebrow>Before you send</Eyebrow>
                <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                  What makes a request get answered
                </h3>
                <ul className="mt-4 space-y-4 border-t border-line pt-4">
                  {[
                    {
                      n: "01",
                      t: "One question, not a life plan",
                      c: "Mentors answer decisions, not autobiographies. Bring the fork in the road you are standing at.",
                    },
                    {
                      n: "02",
                      t: "Say what you have already tried",
                      c: "It saves the first ten minutes and tells the mentor where you actually are.",
                    },
                    {
                      n: "03",
                      t: "Turn up",
                      c: "A slot you agreed to and skipped costs the next student a mentor. Cancel by email instead.",
                    },
                    {
                      n: "04",
                      t: "Leave feedback afterwards",
                      c: "A rating and two lines, once the mentor closes the session. The association reads them when it shapes the next placement drive.",
                    },
                  ].map((row) => (
                    <li key={row.n} className="flex gap-4">
                      <span className="font-mono shrink-0 text-[0.7rem] tabular-nums text-brass">
                        {row.n}
                      </span>
                      <div>
                        <p className="text-[0.88rem] leading-snug text-ink">{row.t}</p>
                        <p className="mt-1 text-[0.82rem] leading-relaxed text-slate-ink">
                          {row.c}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="mt-6 border border-line bg-bone-deep p-6">
                <Eyebrow>Give time back</Eyebrow>
                <p className="mt-2 text-[0.88rem] leading-relaxed text-slate-ink">
                  Every mentor on this page is an alumnus who ticked one box on their
                  own profile. Turn it on, list the two or three things you can
                  genuinely speak to, and you appear here for the batches behind you.
                </p>
                <div className="mt-5">
                  <Button href="/directory" variant="outline">
                    Update your profile
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        </Shell>
      </section>

      {/* ---- Seeker side: follow-up tracking + feedback -------------------- */}
      <section id="track" className="scroll-mt-24 border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Follow-up tracking"
            title="Track the requests you sent"
            lede="Your own bookings, newest first, with each status, how long it has been waiting, and the rating form once the mentor closes the session."
          />

          <AuthLoading>
            <LoadingRows rows={3} />
          </AuthLoading>

          <Unauthenticated>
            <SignInWall
              title="Sign in to see your own requests."
              detail="A mentorship request holds the question you wrote and the address you read, so the association shows it to you and to the mentor you sent it to — nobody else, and never to whoever types an address into a box. Signing in is what proves the account is yours."
            />
          </Unauthenticated>

          <Authenticated>
            <SeekerTracking />
          </Authenticated>
        </Shell>
      </section>

      {/* ---- Mentor side: the queue --------------------------------------- */}
      <section id="inbox" className="scroll-mt-24">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Mentor inbox"
            title="If you are the mentor, work your queue"
            lede="Your own incoming requests. Accept or decline a new one, then mark it completed once the call has happened — completing it is what opens the seeker's rating form."
          />

          <AuthLoading>
            <LoadingRows rows={3} />
          </AuthLoading>

          <Unauthenticated>
            <SignInWall
              title="Sign in to open your inbox."
              detail="An inbox is read from your session rather than chosen from a list, so a mentor only ever sees the requests addressed to them. That is what stops the public roster of mentor profiles from doubling as an index of other people's messages."
            />
          </Unauthenticated>

          <Authenticated>
            <MentorInbox />
          </Authenticated>
        </Shell>
      </section>
    </>
  );
}
