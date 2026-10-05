"use client";

import { api, type Id, Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery, type FunctionReturnType } from "@/lib/standalone";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Avatar,
  Button,
  Card,
  Empty,
  Eyebrow,
  inputClass,
  labelClass,
  LoadingRows,
  PageHeader,
  Pill,
  Shell,
  Stat,
  TabBar,
  VerifiedMark,
} from "@/components/kit";
import { Composer, PostList } from "@/components/post-feed";
import { DEPARTMENT_NAMES, formatDate } from "@/lib/site";

/**
 * One community: its feed, its members, its join queue, and its questions.
 *
 * The tab that opens is chosen by what is waiting: an admin with requests in the
 * queue lands on the queue, everyone else lands on the feed. A moderator should not
 * have to remember to go and look.
 *
 * Read access is decided by the server per surface, not by this page. The feed query
 * returns `allowed: false` for a non-member rather than throwing, the member list
 * refuses, and the queue returns empty for anyone who cannot moderate — so a
 * non-member sees the description and a join form, and nothing leaks through a
 * component that forgot to check.
 */

type Community = NonNullable<
  FunctionReturnType<typeof api.communities.communityBySlug>
>;
type Tab = "feed" | "members" | "requests" | "questions";

function shortBatch(batch: number | null) {
  if (batch === null || batch === 0) return null;
  return `’${String(batch).slice(2)}`;
}

/* ------------------------------------------------------------------ */
/* Join form — including the admin-authored screening questions        */
/* ------------------------------------------------------------------ */

function JoinPanel({ community }: { community: Community }) {
  const requestToJoin = useMutation(api.communities.requestToJoin);
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const questions = community.joinQuestions;
  const missing = questions.filter(
    (question) => question.required && !(answers[question._id] ?? "").trim(),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await requestToJoin({
        communityId: community._id,
        note: note.trim() ? note.trim() : undefined,
        answers: questions
          .map((question) => ({
            questionId: question._id,
            answer: (answers[question._id] ?? "").trim(),
          }))
          .filter((entry) => entry.answer.length > 0),
      });
      toast.success(
        result.status === "active"
          ? `You have joined ${community.name}.`
          : "Request sent. The community's admins will see your answers.",
      );
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (community.standing === "pending") {
    return (
      <Card accent>
        <div className="pt-4">
          <Eyebrow>Request sent</Eyebrow>
          <h3 className="font-display mt-2 text-xl leading-snug text-ink">
            Waiting on the admins
          </h3>
          <p className="mt-2.5 max-w-xl text-[0.9rem] leading-relaxed text-slate-ink">
            {community.createdByName} and any other admin of {community.name} can
            see your request and your answers. The feed opens as soon as one of them
            accepts.
          </p>
        </div>
      </Card>
    );
  }

  if (community.standing === "removed") {
    return (
      <Card>
        <Eyebrow>Not a member</Eyebrow>
        <p className="mt-2.5 max-w-xl text-[0.9rem] leading-relaxed text-slate-ink">
          You were removed from this community, so you cannot rejoin it yourself. An
          admin would have to add you back.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <Eyebrow>
          {community.visibility === "open" ? "Join" : "Request to join"}
        </Eyebrow>
        <h3 className="font-display mt-2 text-xl leading-snug text-ink">
          {community.visibility === "open"
            ? "Anyone verified can join this one"
            : `${community.createdByName} accepts members here`}
        </h3>
        <p className="mt-2.5 max-w-xl text-[0.9rem] leading-relaxed text-slate-ink">
          {community.visibility === "open"
            ? "You are in as soon as you press the button, and the feed opens immediately."
            : "Your request goes to a queue. Answer the questions below and the admins read them beside your profile."}
        </p>

        {questions.length > 0 ? (
          <div className="mt-6 space-y-5 rounded-card border border-line bg-bone p-5">
            {questions.map((question) => (
              <div key={question._id}>
                <label className={labelClass} htmlFor={`q-${question._id}`}>
                  {question.prompt}
                  {question.required ? (
                    <span className="text-maroon"> *</span>
                  ) : (
                    <span className="text-slate-soft"> (optional)</span>
                  )}
                </label>

                {question.kind === "choice" ? (
                  <select
                    id={`q-${question._id}`}
                    value={answers[question._id] ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question._id]: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-2`}
                  >
                    <option value="">Choose one</option>
                    {question.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : question.kind === "longText" ? (
                  <textarea
                    id={`q-${question._id}`}
                    rows={3}
                    value={answers[question._id] ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question._id]: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-2 resize-none`}
                  />
                ) : (
                  <input
                    id={`q-${question._id}`}
                    value={answers[question._id] ?? ""}
                    onChange={(event) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [question._id]: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-2`}
                  />
                )}
              </div>
            ))}
          </div>
        ) : null}

        {community.visibility === "approval" ? (
          <div className="mt-5">
            <label className={labelClass} htmlFor="join-note">
              Anything else (optional)
            </label>
            <textarea
              id="join-note"
              rows={2}
              maxLength={600}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={`${inputClass} mt-2 resize-none`}
            />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button type="submit" disabled={busy || missing.length > 0}>
            {busy
              ? "Sending…"
              : community.visibility === "open"
                ? "Join community"
                : "Send request"}
          </Button>
          {missing.length > 0 ? (
            <span className="text-[0.8rem] text-slate-ink">
              Answer {missing.length} required{" "}
              {missing.length === 1 ? "question" : "questions"} first.
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                            */
/* ------------------------------------------------------------------ */

function MemberList({ community }: { community: Community }) {
  const members = useQuery(api.communities.membersOf, {
    communityId: community._id,
  });
  const setRole = useMutation(api.communities.setMemberRole);
  const [busy, setBusy] = useState<string | null>(null);

  if (members === undefined) return <LoadingRows rows={4} />;

  return (
    <ul className="space-y-3">
      {members.map((member) => (
        <Card as="li" key={member.membershipId} className="flex items-start gap-4">
          <Avatar name={member.name} src={member.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {member.alumniId ? (
                <Link
                  href={`/directory/${member.alumniId}` as never}
                  className="text-[0.95rem] text-ink transition-colors hover:text-maroon"
                >
                  {member.name}
                </Link>
              ) : (
                <span className="text-[0.95rem] text-ink">{member.name}</span>
              )}
              {member.verified ? <VerifiedMark /> : null}
              {member.role !== "member" ? (
                <Pill tone={member.role === "admin" ? "maroon" : "brass"}>
                  {member.role}
                </Pill>
              ) : null}
              {member.isYou ? <Pill>You</Pill> : null}
            </div>
            {member.department || shortBatch(member.batch) ? (
              <p className="font-mono mt-1 text-[0.68rem] tabular-nums text-brass-ink">
                {[member.department, shortBatch(member.batch)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {member.designation || member.company ? (
              <p className="mt-1 text-[0.85rem] text-ink">
                {[member.designation, member.company].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <p className="font-mono mt-1.5 text-[0.65rem] tabular-nums text-slate-soft">
              Joined {formatDate(member.joinedAt)}
            </p>
          </div>

          {/* Role controls, admins only and never on yourself — an admin
              demoting themselves out of a community they are alone in would
              lock it, which leaveCommunity already refuses for the same reason. */}
          {community.standing === "admin" && !member.isYou ? (
            <select
              aria-label={`Role for ${member.name}`}
              value={member.role}
              disabled={busy === member.membershipId}
              onChange={(event) => {
                setBusy(member.membershipId);
                setRole({
                  membershipId: member.membershipId as Id<"communityMembers">,
                  role: event.target.value as
                    | "admin"
                    | "moderator"
                    | "member"
                    | "removed",
                })
                  .then(() => toast.success(`${member.name} updated.`))
                  .catch((error) => toast.error(actionErrorMessage(error)))
                  .finally(() => setBusy(null));
              }}
              className="font-mono shrink-0 rounded-control border border-line bg-surface px-2.5 py-1.5 text-[0.7rem] uppercase tracking-[0.08em] text-ink"
            >
              <option value="member">Member</option>
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
              <option value="removed">Remove</option>
            </select>
          ) : null}
        </Card>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Join queue                                                         */
/* ------------------------------------------------------------------ */

function RequestQueue({ community }: { community: Community }) {
  const requests = useQuery(api.communities.joinRequests, {
    communityId: community._id,
  });
  const review = useMutation(api.communities.reviewJoinRequest);
  const [busy, setBusy] = useState<string | null>(null);

  if (requests === undefined) return <LoadingRows rows={3} />;
  if (requests.length === 0) {
    return (
      <Empty
        title="Nobody is waiting."
        hint={
          community.visibility === "open"
            ? "This community admits anyone who asks, so requests never queue here. Switch it to approval if you want to vet members."
            : "Requests to join appear here with each person's answers."
        }
      />
    );
  }

  function answer(membershipId: string, decision: "accepted" | "declined", name: string) {
    setBusy(membershipId);
    review({
      membershipId: membershipId as Id<"communityMembers">,
      decision,
    })
      .then(() =>
        toast.success(
          decision === "accepted" ? `${name} is in.` : `${name} declined.`,
        ),
      )
      .catch((error) => toast.error(actionErrorMessage(error)))
      .finally(() => setBusy(null));
  }

  return (
    <ul className="space-y-3">
      {requests.map((request) => (
        <Card as="li" key={request.membershipId}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar name={request.name} src={request.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {request.alumniId ? (
                  <Link
                    href={`/directory/${request.alumniId}` as never}
                    className="font-display text-lg leading-snug text-ink transition-colors hover:text-maroon"
                  >
                    {request.name}
                  </Link>
                ) : (
                  <span className="font-display text-lg leading-snug text-ink">
                    {request.name}
                  </span>
                )}
                {request.verified ? <VerifiedMark /> : null}
              </div>
              {request.department || shortBatch(request.batch) ? (
                <p className="font-mono mt-1 text-[0.68rem] tabular-nums text-brass-ink">
                  {[request.department, shortBatch(request.batch)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {request.designation || request.company ? (
                <p className="mt-1 text-[0.85rem] text-ink">
                  {[request.designation, request.company]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}

              {/* The answers, which are the whole reason to have a queue. */}
              {request.answers.length > 0 ? (
                <dl className="mt-3.5 space-y-3 rounded-card border border-line bg-bone p-4">
                  {request.answers.map((entry, index) => (
                    <div key={index}>
                      <dt className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-brass-ink">
                        {entry.prompt}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">
                        {entry.answer}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {request.note ? (
                <blockquote className="mt-3 rounded-control border-l-2 border-brass bg-bone px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-ink">
                  {request.note}
                </blockquote>
              ) : null}

              <p className="font-mono mt-3 text-[0.68rem] tabular-nums text-slate-ink">
                Asked {formatDate(request.askedAt)}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
              <Button
                size="sm"
                disabled={busy === request.membershipId}
                onClick={() =>
                  answer(request.membershipId, "accepted", request.name)
                }
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={busy === request.membershipId}
                onClick={() =>
                  answer(request.membershipId, "declined", request.name)
                }
              >
                Decline
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Screening questions                                                */
/* ------------------------------------------------------------------ */

function QuestionEditor({ community }: { community: Community }) {
  const questions = useQuery(api.questions.communityQuestions, {
    communityId: community._id,
  });
  const addQuestion = useMutation(api.questions.addQuestion);
  const setActive = useMutation(api.questions.setQuestionActive);
  const reorder = useMutation(api.questions.reorderQuestion);

  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"text" | "longText" | "choice">("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-5">
      {community.visibility === "open" ? (
        <Card>
          <Eyebrow>Not asked</Eyebrow>
          <p className="mt-2.5 max-w-2xl text-[0.9rem] leading-relaxed text-slate-ink">
            This community admits anyone who asks, so nobody is ever shown these
            questions. Set it to approval if you want to vet members — the questions
            below are kept either way.
          </p>
        </Card>
      ) : null}

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            addQuestion({
              scope: "communityJoin",
              communityId: community._id,
              prompt,
              kind,
              options:
                kind === "choice"
                  ? options.split("\n").map((line) => line.trim()).filter(Boolean)
                  : undefined,
              required,
            })
              .then(() => {
                setPrompt("");
                setOptions("");
                toast.success("Question added.");
              })
              .catch((error) => toast.error(actionErrorMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          <Eyebrow>Add a question</Eyebrow>
          <p className="mt-2 max-w-2xl text-[0.85rem] leading-relaxed text-slate-ink">
            Anyone requesting to join answers these, and you read the answers in the
            queue beside their profile.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div>
              <label className={labelClass} htmlFor="q-prompt">
                Question
              </label>
              <input
                id="q-prompt"
                required
                maxLength={300}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Which batch and department are you from?"
                className={`${inputClass} mt-2`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="q-kind">
                Answer type
              </label>
              <select
                id="q-kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "text" | "longText" | "choice")
                }
                className={`${inputClass} mt-2`}
              >
                <option value="text">Short text</option>
                <option value="longText">Long text</option>
                <option value="choice">Multiple choice</option>
              </select>
            </div>
          </div>

          {kind === "choice" ? (
            <div className="mt-4">
              <label className={labelClass} htmlFor="q-options">
                Options, one per line
              </label>
              <textarea
                id="q-options"
                rows={4}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
                placeholder={"CSE\nIT\nECE"}
                className={`${inputClass} mt-2 resize-none`}
              />
            </div>
          ) : null}

          <label className="mt-4 flex items-center gap-2.5 text-[0.875rem] text-ink">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="size-4 accent-maroon"
            />
            An answer is required
          </label>

          <div className="mt-5 border-t border-line pt-4">
            <Button type="submit" size="sm" disabled={busy || !prompt.trim()}>
              {busy ? "Adding…" : "Add question"}
            </Button>
          </div>
        </form>
      </Card>

      {questions === undefined ? (
        <LoadingRows rows={2} />
      ) : questions.length === 0 ? (
        <Empty
          title="No questions yet."
          hint="Without any, a join request arrives with just the member's profile and an optional note."
        />
      ) : (
        <ul className="space-y-3">
          {questions.map((question, index) => (
            <Card as="li" key={question._id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.68rem] tabular-nums text-slate-ink">
                      {index + 1}
                    </span>
                    {question.required ? (
                      <Pill tone="maroon">Required</Pill>
                    ) : (
                      <Pill>Optional</Pill>
                    )}
                    <Pill tone="quiet">{question.kind}</Pill>
                    {!question.active ? <Pill tone="brass">Retired</Pill> : null}
                  </div>
                  <p className="mt-2 text-[0.95rem] leading-snug text-ink">
                    {question.prompt}
                  </p>
                  {question.options.length > 0 ? (
                    <p className="mt-1.5 text-[0.8rem] text-slate-ink">
                      {question.options.join(" · ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      void reorder({
                        questionId: question._id,
                        direction: "up",
                      }).catch((error) => toast.error(actionErrorMessage(error)));
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      void reorder({
                        questionId: question._id,
                        direction: "down",
                      }).catch((error) => toast.error(actionErrorMessage(error)));
                    }}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void setActive({
                        questionId: question._id,
                        active: !question.active,
                      }).catch((error) => toast.error(actionErrorMessage(error)));
                    }}
                  >
                    {question.active ? "Retire" : "Restore"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

function CommunityBody({ slug }: { slug: string }) {
  const community = useQuery(api.communities.communityBySlug, { slug });
  const leave = useMutation(api.communities.leaveCommunity);
  const [tab, setTab] = useState<Tab | null>(null);

  const requests = useQuery(
    api.communities.joinRequests,
    community ? { communityId: community._id } : "skip",
  );
  const posts = useQuery(
    api.feed.communityFeed,
    community ? { communityId: community._id } : "skip",
  );

  if (community === undefined) return <LoadingRows rows={5} />;
  if (community === null) {
    return (
      <Empty
        title="No such community."
        hint="The link may be out of date, or it may have been archived."
        action={<Button href="/communities">All communities</Button>}
      />
    );
  }

  /**
   * Sharing the room, by the shortest route that works everywhere.
   *
   * On a phone this opens the system share sheet, which is what somebody
   * sending a link to a WhatsApp group actually wants. Everywhere else it
   * copies the URL. Both end with the same link, and the link lands on this
   * page -- where an outsider gets the join panel rather than the feed, so a
   * shared link admits nobody by itself.
   */
  async function share() {
    const url = `${window.location.origin}/communities/${community?.slug ?? ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: community?.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied. Anyone you send it to can ask to join.");
    } catch (error) {
      // A cancelled share sheet throws too, and is not a failure worth saying
      // anything about.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("That link could not be copied. The address bar has it.");
    }
  }

  const pending = requests?.length ?? 0;
  // Open on whatever is waiting: a queue with people in it beats the feed.
  const active: Tab = tab ?? (pending > 0 ? "requests" : "feed");

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "feed", label: "Feed", count: community.postCount },
    { id: "members", label: "Members", count: community.memberCount },
  ];
  if (community.canModerate) {
    tabs.push({ id: "requests", label: "Requests", count: pending });
    tabs.push({ id: "questions", label: "Questions" });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <TabBar
          tabs={tabs}
          active={active}
          onSelect={setTab}
          label={`${community.name} sections`}
        />
        <div className="flex flex-wrap gap-2">
          {/* Everyone who can see the room can pass it on: that is what makes a
              link the way people are actually invited to one. */}
          <Button size="sm" variant="outline" onClick={() => void share()}>
            Share link
          </Button>
          {community.standing === "member" ||
          community.standing === "moderator" ||
          community.standing === "admin" ? (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                void leave({ communityId: community._id })
                  .then(() => toast.success(`You have left ${community.name}.`))
                  .catch((error) => toast.error(actionErrorMessage(error)));
              }}
            >
              Leave
            </Button>
          ) : null}
          <Button href="/communities" variant="outline" size="sm">
            All communities
          </Button>
        </div>
      </div>

      {community.state !== "approved" ? (
        <Card className="mt-6" accent>
          <Eyebrow>
            {community.state === "pending" ? "Waiting on the association" : "Not approved"}
          </Eyebrow>
          <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink">
            {community.state === "pending"
              ? "This room is not open yet. The association reviews every new community before it appears in the list, and nobody else can see this page or post here until they do."
              : community.reviewNote ??
                "The association did not approve this community."}
          </p>
        </Card>
      ) : null}

      <div className="mt-6">
        {active === "feed" ? (
          community.canPost ? (
            <div className="space-y-4">
              <Composer
                communityId={community._id}
                placeholder={`Post to ${community.name}…`}
              />
              <PostList
                posts={posts?.allowed ? posts.posts : undefined}
                canModerate={posts?.canModerate ?? false}
                emptyTitle="Nothing posted here yet."
                emptyHint="Open it — the first post is what tells everyone else what this community is for."
              />
            </div>
          ) : (
            <div className="space-y-6">
              <JoinPanel community={community} />
              {community.description ? (
                <Card>
                  <Eyebrow>About</Eyebrow>
                  <p className="mt-2.5 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink">
                    {community.description}
                  </p>
                </Card>
              ) : null}
            </div>
          )
        ) : null}

        {active === "members" ? (
          community.canPost ? (
            <MemberList community={community} />
          ) : (
            <Empty
              title="Members are visible once you join."
              hint="A community's member list is for its members."
            />
          )
        ) : null}

        {active === "requests" && community.canModerate ? (
          <RequestQueue community={community} />
        ) : null}

        {active === "questions" && community.canModerate ? (
          <QuestionEditor community={community} />
        ) : null}
      </div>
    </>
  );
}

export default function CommunityPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const community = useQuery(api.communities.communityBySlug, { slug });

  const scope = [
    community?.scopeDepartment
      ? (DEPARTMENT_NAMES[community.scopeDepartment] ??
        community.scopeDepartment)
      : null,
    community?.scopeBatch ? `${community.scopeBatch} batch` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        module={
          community
            ? community.visibility === "open"
              ? "Community · anyone can join"
              : "Community · admins accept members"
            : "Community"
        }
        title={community?.name ?? "Loading…"}
        lede={community?.tagline ?? "Fetching this community."}
      >
        {community ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap gap-2">
              <Pill tone="dark">{community.memberCount} members</Pill>
              <Pill tone="dark">{community.postCount} posts</Pill>
              {scope.map((label) => (
                <Pill key={label} tone="dark">
                  {label}
                </Pill>
              ))}
            </div>
          </div>
        ) : null}
      </PageHeader>

      <Shell>
        <section className="py-12 sm:py-16">
          <AuthLoading>
            <LoadingRows rows={5} />
          </AuthLoading>

          <Unauthenticated>
            <div className="mx-auto max-w-lg text-center">
              <Eyebrow>Members only</Eyebrow>
              <h2 className="font-display mt-3 text-3xl leading-snug text-ink">
                Sign in to open this community.
              </h2>
              <div className="mt-8 flex justify-center">
                <Button href="/join">Sign in</Button>
              </div>
            </div>
          </Unauthenticated>

          <Authenticated>
            <CommunityBody slug={slug} />
          </Authenticated>
        </section>
      </Shell>
    </>
  );
}
