"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { MethodPills, SocialButtons } from "@/components/sign-in-card";
import {
  actionErrorMessage,
  Button,
  Card,
  Empty,
  errorClass,
  Eyebrow,
  hintClass,
  inputClass,
  labelClass,
  LoadingRows,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
  VerifiedMark,
} from "@/components/kit";
import {
  BATCH_YEARS,
  DEPARTMENT_NAMES,
  DEPARTMENTS,
  formatDate,
  RITAA,
  ROLES,
} from "@/lib/site";

/**
 * Module 1 — user roles & access.
 *
 * Everything on this page talks to a real Convex function:
 *
 *  - `api.auth.configuredAuthMethods` decides which sign-in controls are live.
 *    Google, LinkedIn and one-time codes each switch on the moment the
 *    association adds credentials to the deployment; until then they are
 *    rendered disabled with the reason attached, never as buttons that fail.
 *  - `api.access.startOtp` / `confirmOtp` run the OTP challenge. A confirmed
 *    code proves control of an email address — it does not open a session,
 *    because the better-auth server here has no OTP sign-in plugin.
 *  - `api.access.requestVerification` files the alumni verification request and
 *    `verificationFor` streams its status back live. Approval is an internal
 *    mutation, so authenticity stays a human check against college records and
 *    cannot be triggered from a browser.
 *  - `api.access.roleFor` resolves the visitor's own role on the server.
 */

/* ------------------------------------------------------------------ */
/* Static copy                                                        */
/* ------------------------------------------------------------------ */

/** Which role ids may reach each area of the portal. */
const ACCESS_MODEL: Array<{ area: string; roles: string[] }> = [
  {
    area: "Public pages — stories, events, giving",
    roles: ["alumni", "entrepreneur", "admin", "guest"],
  },
  {
    area: "Alumni directory and contact details",
    roles: ["alumni", "entrepreneur", "admin"],
  },
  {
    area: "Career hub, resume upload, referrals",
    roles: ["alumni", "entrepreneur", "admin"],
  },
  {
    area: "Mentorship booking and feedback",
    roles: ["alumni", "entrepreneur", "admin"],
  },
  {
    area: "RACE venture profile and idea submission",
    roles: ["entrepreneur", "admin"],
  },
  { area: "Member management and content moderation", roles: ["admin"] },
  { area: "Analytics dashboard and report exports", roles: ["admin"] },
];

/** Plain English for the `source` field `roleFor` returns. */
const ROLE_SOURCE_COPY: Record<string, string> = {
  "no-session": "You are not signed in, so the portal treats you as a guest.",
  assigned: "An administrator has granted this role to your email address.",
  venture:
    "You have a venture registered on RACE, and a founder is an entrepreneur without needing a separate grant.",
  verified: "Your alumni verification request has been approved by the office.",
  unverified:
    "No approved verification request is on file for this address yet, so the least privileged role applies.",
};

const AFTER_STEPS = [
  {
    n: "01",
    t: "The request reaches the office",
    c: "Your name, batch, department, roll number and graduation year are stored as a pending request the secretary can see.",
  },
  {
    n: "02",
    t: "Records are checked by hand",
    c: "The details are matched against the institute's graduation records. A mismatch is queried by email, not rejected silently — approval is an internal-only mutation, so nothing about it can be self-served from a browser.",
  },
  {
    n: "03",
    t: "Your role changes with it",
    c: "Approval grants the alumni role, flips your directory listing to verified, and opens the directory, career hub and mentorship network.",
  },
];

/* ------------------------------------------------------------------ */
/* Verification                                                       */
/* ------------------------------------------------------------------ */

type VerifyField =
  | "name"
  | "email"
  | "batch"
  | "department"
  | "rollNumber"
  | "graduationYear"
  | "confirmed";

type VerifyForm = {
  name: string;
  email: string;
  batch: string;
  department: string;
  rollNumber: string;
  graduationYear: string;
  confirmed: boolean;
};

const EMPTY_VERIFY: VerifyForm = {
  name: "",
  email: "",
  batch: "",
  department: "",
  rollNumber: "",
  graduationYear: "",
  confirmed: false,
};

function validateVerify(form: VerifyForm) {
  const errors: Partial<Record<VerifyField, string>> = {};

  if (form.name.trim().length < 2) {
    errors.name = "Enter your full name as it appears on your degree certificate.";
  }
  if (!z.email().safeParse(form.email.trim()).success) {
    errors.email =
      "Enter the email address on your account, for example name@example.com.";
  }
  if (!form.batch) errors.batch = "Choose the year your batch joined RIT.";
  if (!form.department) {
    errors.department = "Choose the department you graduated from.";
  }
  if (form.rollNumber.trim().length < 4) {
    errors.rollNumber =
      "Enter the roll number printed on your college records — at least four characters.";
  }
  if (!form.graduationYear) {
    errors.graduationYear = "Choose the year you graduated.";
  } else if (form.batch && Number(form.graduationYear) < Number(form.batch)) {
    errors.graduationYear =
      "Graduation year cannot be earlier than the year your batch joined.";
  }
  if (!form.confirmed) {
    errors.confirmed =
      "Tick the box to confirm these details match your college records.";
  }

  return errors;
}

function VerificationForm({
  onFiled,
  defaultName,
  defaultEmail,
}: {
  onFiled: (email: string) => void;
  defaultName: string;
  defaultEmail: string;
}) {
  const requestVerification = useMutation(api.access.requestVerification);
  /*
   * The association's own extra questions, authored on /admin. Fetched rather
   * than hardcoded, so adding one there changes this form with no code change.
   * Saved by a separate mutation from the fixed fields, so correcting one answer
   * never means re-filing the whole request.
   */
  const extraQuestions = useQuery(api.questions.verificationQuestions);
  const answerQuestions = useMutation(api.questions.answerVerificationQuestions);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [form, setForm] = useState<VerifyForm>({
    ...EMPTY_VERIFY,
    name: defaultName,
    email: defaultEmail,
  });
  const [errors, setErrors] = useState<Partial<Record<VerifyField, string>>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // The session resolves a beat after mount, so fill the two fields it can
  // answer — but only while they are still empty, so nothing typed is lost.
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      name: prev.name || defaultName,
      email: prev.email || defaultEmail,
    }));
  }, [defaultName, defaultEmail]);

  function set<K extends keyof VerifyForm>(key: K, value: VerifyForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as VerifyField]) return prev;
      const next = { ...prev };
      delete next[key as VerifyField];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);

    const found = validateVerify(form);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`verify-${first}`)?.focus();
      return;
    }

    setPending(true);
    try {
      const email = form.email.trim().toLowerCase();
      const result = await requestVerification({
        name: form.name.trim(),
        email,
        batch: Number(form.batch),
        department: form.department,
        rollNumber: form.rollNumber.trim(),
        graduationYear: Number(form.graduationYear),
      });
      /*
       * The request is filed first and the answers second, deliberately. If the
       * answers fail validation the request still exists and the member can
       * correct one field, rather than losing a completed form to a rejected
       * optional extra.
       */
      const supplied = (extraQuestions ?? [])
        .map((question) => ({
          questionId: question._id,
          answer: (answers[question._id] ?? "").trim(),
        }))
        .filter((entry) => entry.answer.length > 0);
      if (supplied.length > 0) {
        await answerQuestions({ answers: supplied });
      }

      onFiled(email);
      toast.success(
        result.alreadyVerified
          ? "This address is already verified"
          : "Verification request filed for review",
      );
      setForm({ ...EMPTY_VERIFY, name: form.name.trim(), email });
    } catch (error) {
      setFailure(actionErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Alumni verification</Eyebrow>
        <Pill tone="brass">Checked by the office</Pill>
      </div>

      <p className="mt-5 text-[0.9rem] leading-relaxed text-slate-ink">
        The directory is only worth using if everyone in it genuinely studied at
        RIT. The association matches the batch, department and roll number below
        against college records before your profile becomes visible to other
        members. That is a manual check by a person in the office, not an instant
        one — expect a few working days.
      </p>

      <form className="mt-6" onSubmit={handleSubmit}>
        <fieldset className="border-0 p-0">
          <legend className="font-mono mb-4 text-[0.7rem] uppercase tracking-[0.12em] text-ink">
            Your college record
          </legend>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className={labelClass} htmlFor="verify-name">
                Name as on records
              </label>
              <input
                id="verify-name"
                name="verify-name"
                autoComplete="name"
                aria-required="true"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "verify-name-error" : undefined}
                className={inputClass}
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
              />
              {errors.name ? (
                <p id="verify-name-error" className={errorClass}>
                  {errors.name}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className={labelClass} htmlFor="verify-email">
                Email on your account
              </label>
              <input
                id="verify-email"
                name="verify-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                aria-required="true"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "verify-email-error" : undefined}
                className={inputClass}
                value={form.email}
                onChange={(event) => set("email", event.target.value)}
              />
              {errors.email ? (
                <p id="verify-email-error" className={errorClass}>
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className={labelClass} htmlFor="verify-batch">
                Batch
              </label>
              <select
                id="verify-batch"
                name="verify-batch"
                aria-required="true"
                aria-invalid={Boolean(errors.batch)}
                aria-describedby={errors.batch ? "verify-batch-error" : undefined}
                className={inputClass}
                value={form.batch}
                onChange={(event) => set("batch", event.target.value)}
              >
                <option value="">Select your batch</option>
                {BATCH_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              {errors.batch ? (
                <p id="verify-batch-error" className={errorClass}>
                  {errors.batch}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className={labelClass} htmlFor="verify-department">
                Department
              </label>
              <select
                id="verify-department"
                name="verify-department"
                aria-required="true"
                aria-invalid={Boolean(errors.department)}
                aria-describedby={
                  errors.department ? "verify-department-error" : undefined
                }
                className={inputClass}
                value={form.department}
                onChange={(event) => set("department", event.target.value)}
              >
                <option value="">Select your department</option>
                {DEPARTMENTS.map((code) => (
                  <option key={code} value={code}>
                    {code} — {DEPARTMENT_NAMES[code]}
                  </option>
                ))}
              </select>
              {errors.department ? (
                <p id="verify-department-error" className={errorClass}>
                  {errors.department}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className={labelClass} htmlFor="verify-rollNumber">
                Roll number
              </label>
              <input
                id="verify-rollNumber"
                name="verify-rollNumber"
                placeholder="e.g. 9213205001"
                aria-required="true"
                aria-invalid={Boolean(errors.rollNumber)}
                aria-describedby={
                  errors.rollNumber ? "verify-rollNumber-error" : undefined
                }
                className={`${inputClass} font-mono tabular-nums uppercase`}
                value={form.rollNumber}
                onChange={(event) => set("rollNumber", event.target.value)}
              />
              {errors.rollNumber ? (
                <p id="verify-rollNumber-error" className={errorClass}>
                  {errors.rollNumber}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className={labelClass} htmlFor="verify-graduationYear">
                Graduation year
              </label>
              <select
                id="verify-graduationYear"
                name="verify-graduationYear"
                aria-required="true"
                aria-invalid={Boolean(errors.graduationYear)}
                aria-describedby={
                  errors.graduationYear ? "verify-graduationYear-error" : undefined
                }
                className={inputClass}
                value={form.graduationYear}
                onChange={(event) => set("graduationYear", event.target.value)}
              >
                <option value="">Confirm your graduation year</option>
                {BATCH_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              {errors.graduationYear ? (
                <p id="verify-graduationYear-error" className={errorClass}>
                  {errors.graduationYear}
                </p>
              ) : null}
            </div>
          </div>

          {/* ---- The association's own extra questions -------------------
              Authored on /admin, so this block appears only once there is
              something to ask and disappears again if every question is
              retired. */}
          {extraQuestions && extraQuestions.length > 0 ? (
            <div className="mt-6 rounded-card border border-line bg-bone p-5">
              <Eyebrow>Also asked by the association</Eyebrow>
              <p className="mt-2 text-[0.82rem] leading-relaxed text-slate-ink">
                These go to the office with your request, so it can cross-check
                more than the roll number alone.
              </p>
              <div className="mt-5 space-y-5">
                {extraQuestions.map((question) => (
                  <div key={question._id}>
                    <label className={labelClass} htmlFor={`vq-${question._id}`}>
                      {question.prompt}
                      {question.required ? (
                        <span className="text-maroon"> *</span>
                      ) : (
                        <span className="text-slate-soft"> (optional)</span>
                      )}
                    </label>

                    {question.kind === "choice" ? (
                      <select
                        id={`vq-${question._id}`}
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
                        id={`vq-${question._id}`}
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
                        id={`vq-${question._id}`}
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
            </div>
          ) : null}

          <div className="mt-5 border border-line bg-bone p-4">
            <div className="flex gap-3">
              <input
                id="verify-confirmed"
                name="verify-confirmed"
                type="checkbox"
                aria-invalid={Boolean(errors.confirmed)}
                aria-describedby={
                  errors.confirmed ? "verify-confirmed-error" : undefined
                }
                className="mt-1 size-4 shrink-0 accent-maroon"
                checked={form.confirmed}
                onChange={(event) => set("confirmed", event.target.checked)}
              />
              <label
                htmlFor="verify-confirmed"
                className="text-[0.85rem] leading-relaxed text-ink"
              >
                I confirm the batch, department, roll number and graduation year
                above are the ones on my degree certificate, and that RITAA may
                check them against college records.
              </label>
            </div>
            {errors.confirmed ? (
              <p id="verify-confirmed-error" className={`mt-3 ${errorClass}`}>
                {errors.confirmed}
              </p>
            ) : null}
          </div>

          <div className="mt-6">
            <Button type="submit" disabled={pending}>
              {pending ? "Filing…" : "Submit for verification"}
            </Button>
          </div>

          {failure ? (
            <p role="alert" className={`mt-4 ${errorClass}`}>
              {failure}
            </p>
          ) : null}

          <p className={`mt-4 ${hintClass}`}>
            Submitting again from the same address updates your pending request
            instead of queueing a duplicate. An already-approved member cannot
            reset their own verified status this way.
          </p>
        </fieldset>
      </form>
    </div>
  );
}

function VerificationStatus({
  email,
  onLookup,
}: {
  email: string;
  onLookup: (email: string) => void;
}) {
  const [draft, setDraft] = useState(email);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Same reason as the form: adopt the watched address once, never overwrite.
  useEffect(() => {
    setDraft((prev) => prev || email);
  }, [email]);

  const record = useQuery(
    api.access.verificationFor,
    email ? { email } : "skip",
  );

  function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = z.email().safeParse(draft.trim());
    if (!parsed.success) {
      setLookupError("Enter a valid email address to look up.");
      return;
    }
    setLookupError(null);
    onLookup(parsed.data.toLowerCase());
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Live status</Eyebrow>
        {!email ? (
          <Pill>No request</Pill>
        ) : record === undefined ? (
          <Pill>Loading</Pill>
        ) : record === null ? (
          <Pill>No request</Pill>
        ) : record.status === "approved" ? (
          <Pill tone="jade">Approved</Pill>
        ) : record.status === "rejected" ? (
          <Pill tone="maroon">Rejected</Pill>
        ) : (
          <Pill tone="brass">Pending</Pill>
        )}
      </div>

      <form className="mt-5" onSubmit={handleLookup}>
        <div className="space-y-2">
          <label className={labelClass} htmlFor="status-email">
            Check the status of an address
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="status-email"
              name="status-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              aria-invalid={lookupError !== null}
              aria-describedby={lookupError ? "status-email-error" : undefined}
              className={inputClass}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setLookupError(null);
              }}
            />
            <Button type="submit" variant="outline" className="shrink-0">
              Check
            </Button>
          </div>
          {lookupError ? (
            <p id="status-email-error" className={errorClass}>
              {lookupError}
            </p>
          ) : null}
        </div>
      </form>

      <div className="mt-6">
        {!email ? (
          <Empty
            title="Nothing to show yet"
            hint="File the request on the left, or type the address you applied with above. The status updates here by itself the moment the office reviews it."
          />
        ) : record === undefined ? (
          <LoadingRows rows={2} />
        ) : record === null ? (
          <Empty
            title="No request on file"
            hint={`The association has no verification request from ${email}. Fill in the form on the left to create one.`}
          />
        ) : record.status === "pending" ? (
          <div className="border border-brass/40 bg-brass/8 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="brass">Pending review</Pill>
              <span className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                Filed {formatDate(record.createdAt)}
              </span>
            </div>
            <p className="mt-3 text-[0.9rem] leading-relaxed text-ink">
              Your request is in the queue for {email}. Someone in the office
              compares your roll number against the institute's graduation records
              and then approves or queries it — usually within a few working days.
            </p>
            <p className={`mt-3 ${hintClass}`}>
              You can keep using the portal as a guest in the meantime. Nothing is
              lost if you close this page.
            </p>
          </div>
        ) : record.status === "approved" ? (
          <div className="border border-jade/30 bg-jade/8 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="jade">Approved</Pill>
              <VerifiedMark />
              {record.reviewedAt ? (
                <span className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                  {formatDate(record.reviewedAt)}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[0.9rem] leading-relaxed text-ink">
              {email} is a verified member. Approval granted the alumni role and
              flipped the directory listing to verified, so the directory, career
              hub and mentorship network are open.
            </p>
            {record.reviewNote ? (
              <p className={`mt-3 ${hintClass}`}>
                Note from the office: {record.reviewNote}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Button href="/directory">Open the directory</Button>
              <Button href="/mentorship" variant="outline">
                Mentorship network
              </Button>
            </div>
          </div>
        ) : (
          <div className="border border-maroon/30 bg-maroon/8 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="maroon">Rejected</Pill>
              {record.reviewedAt ? (
                <span className="font-mono text-[0.72rem] tabular-nums text-slate-ink">
                  {formatDate(record.reviewedAt)}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[0.9rem] leading-relaxed text-ink">
              The office could not match {email} to a graduation record.
            </p>
            <p className="mt-3 border-l-2 border-maroon/40 pl-3 text-[0.9rem] leading-relaxed text-ink">
              {record.reviewNote
                ? record.reviewNote
                : "No reason was recorded with the decision."}
            </p>
            <p className={`mt-3 ${hintClass}`}>
              Correct whatever was wrong and submit the form again — a resubmission
              reopens the same request as pending. If you believe the record is
              right, write to{" "}
              <a
                href={`mailto:${RITAA.email}`}
                className="text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
              >
                {RITAA.email}
              </a>{" "}
              with a scan of your degree certificate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Signed-in state                                                    */
/* ------------------------------------------------------------------ */

function SessionPanel({
  name,
  email,
  role,
  source,
}: {
  name: string;
  email: string;
  role: string;
  source: string;
}) {
  const label = ROLES.find((entry) => entry.id === role)?.label ?? role;

  return (
    <Card className="hover:border-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Your session</Eyebrow>
        <Pill tone="jade">Signed in</Pill>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Monogram name={name || email || "RITAA"} size="lg" />
        <div>
          <p className="font-display text-2xl leading-snug text-ink">
            {name || "Your account"}
          </p>
          <p className="font-mono mt-1 text-[0.75rem] text-slate-ink">{email}</p>
        </div>
      </div>

      <dl className="mt-6 grid gap-px border border-line bg-line sm:grid-cols-2">
        <div className="bg-white p-5">
          <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
            Resolved role
          </dt>
          <dd className="font-mono mt-2 text-lg uppercase tracking-[0.08em] text-maroon">
            {label}
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
            Resolved from
          </dt>
          <dd className="font-mono mt-2 text-lg tracking-[0.04em] text-ink">
            {source}
          </dd>
        </div>
      </dl>

      <p className="mt-5 text-[0.9rem] leading-relaxed text-slate-ink">
        {ROLE_SOURCE_COPY[source] ??
          "The server resolved this role from your email address."}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/dashboard">Open your dashboard</Button>
        <Button href="/directory" variant="outline">
          Browse the directory
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function JoinPage() {
  const methods = useQuery(api.auth.configuredAuthMethods);
  const currentUser = useQuery(api.auth.getCurrentUser);

  const sessionEmail = currentUser?.email ?? "";
  const sessionName = currentUser?.name ?? "";

  /** Whose verification status the right-hand panel is showing. */
  const [statusEmail, setStatusEmail] = useState("");
  const watchedEmail = statusEmail || sessionEmail;

  const resolvedRole = useQuery(
    api.access.roleFor,
    sessionEmail ? { email: sessionEmail } : {},
  );

  return (
    <>
      <PageHeader
        image="/campus-1.jpg"
        module="Module 01 · User roles & access"
        title="Join the association."
        lede="Sign in with Google or LinkedIn, then give the association the details it needs to verify you as an RIT graduate. Two steps, and each one reports its real state rather than a hopeful one."
      >
        <MethodPills />
      </PageHeader>

      {/* ---- Sign in -----------------------------------------------------
          One narrow column and two buttons. There is no email form to fall
          back to any more, so there is no "or" rule and no second decision:
          the member picks the account they already have. */}
      <Shell>
        <section className="py-16 sm:py-20">
          <AuthLoading>
            <div className="mx-auto max-w-md">
              <LoadingRows rows={3} />
            </div>
          </AuthLoading>

          <Unauthenticated>
            <div className="mx-auto max-w-md">
              <div className="text-center">
                <Eyebrow>Sign in or sign up</Eyebrow>
                <h2 className="font-display mt-2 text-2xl leading-snug text-ink">
                  One click, with an account you already have
                </h2>
                <p className="mt-2 text-[0.9rem] leading-relaxed text-slate-ink">
                  The same button signs you in and creates your account. LinkedIn
                  also brings across the employer and designation this directory
                  asks for.
                </p>
              </div>

              <div className="mt-8 rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
                <SocialButtons methods={methods} />
              </div>

              <p className="mt-5 text-center text-[0.8rem] leading-relaxed text-slate-ink">
                Signing in creates an account. It does not verify you as an RIT
                graduate — that is the next step below, and the association checks
                it by hand.
              </p>
            </div>
          </Unauthenticated>

          <Authenticated>
            <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:items-start">
              <SessionPanel
                name={sessionName}
                email={sessionEmail}
                role={resolvedRole?.role ?? "guest"}
                source={resolvedRole?.source ?? "no-session"}
              />
              <Card className="hover:border-line">
                <Eyebrow>Where to next</Eyebrow>
                <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                  A session is not the same as being verified.
                </h3>
                <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
                  Signing in proves you own the account. Verification is what proves
                  you studied at RIT, and it is what promotes you out of the guest
                  role — so if your status below still says pending, that is the step
                  left to finish.
                </p>
                <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
                  Signing in with a different email? Use the status panel further
                  down to look up any address you have applied with.
                </p>
              </Card>
            </div>
          </Authenticated>
        </section>
      </Shell>

      {/* ---- Why sign in at all -----------------------------------------
          This replaced the one-time-code section. A code only ever proved
          control of an email address, which the two providers now confirm
          themselves, so the step was verifying something already verified. The
          space is better spent saying what a session actually opens up. */}
      <section className="border-y border-line bg-surface">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="What an account opens"
            title="Signing in is what makes the directory two-way"
            lede="Without a session the portal is a list of names. With one it is a network: you can ask to connect, answer requests, and message the members who accepted."
          />
          <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-3">
            {[
              {
                t: "Connect",
                c: "Ask any member to connect, with a note saying why. Nothing is shared until they accept, and either of you can undo it afterwards.",
                href: "/network" as const,
                cta: "Your network",
              },
              {
                t: "Message",
                c: "Accepting opens a direct thread inside the portal. No phone number changes hands — what other members can see stays yours to set on your profile.",
                href: "/messages" as const,
                cta: "Your messages",
              },
              {
                t: "Be findable",
                c: "Your batch, department and employer are what other graduates search by. A profile you have filled in is the difference between being listed and being found.",
                href: "/profile" as const,
                cta: "Your profile",
              },
            ].map((item) => (
              <div key={item.t} className="flex flex-col bg-surface p-7">
                <h3 className="font-display text-xl leading-snug text-ink">
                  {item.t}
                </h3>
                <p className="mt-2.5 flex-1 text-[0.9rem] leading-relaxed text-slate-ink">
                  {item.c}
                </p>
                <div className="mt-6">
                  <Button href={item.href} variant="outline" size="sm">
                    {item.cta}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat value="2" label="Ways to sign in" />
            <Stat value="Mutual" label="Every connection" />
            <Stat value="Opt-in" label="Contact details" />
            <Stat value="Server-side" label="Where privacy is enforced" />
          </div>
        </Shell>
      </section>

      {/* ---- Alumni verification ---------------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Integrated alumni verification"
            title="Prove you studied here"
            lede="This is the authenticity gate for the whole portal. Nobody can approve their own request — the review mutation is internal to the server and runs from the association's console, not from a browser."
          />
          <div className="grid gap-px border border-line bg-line lg:grid-cols-[1.15fr_1fr]">
            <div className="bg-white p-7">
              <VerificationForm
                onFiled={setStatusEmail}
                defaultName={sessionName}
                defaultEmail={sessionEmail}
              />
            </div>
            <div className="bg-white p-7">
              <VerificationStatus
                email={watchedEmail}
                onLookup={setStatusEmail}
              />
            </div>
          </div>
        </section>
      </Shell>

      {/* ---- Role-based access ------------------------------------------ */}
      <section className="border-y border-line bg-white">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Role-based access"
            title="Alumni, Entrepreneurs, Admins, Guests"
            lede="What you see after signing in depends on the role the server resolves for your email address. Anyone unknown is a guest, because defaulting to the least privileged role is the only safe default."
          />

          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((role) => {
              const isYours = resolvedRole?.role === role.id;
              return (
                <div key={role.id} className="bg-white p-7">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Eyebrow>{role.id}</Eyebrow>
                    {isYours ? <Pill tone="maroon">You</Pill> : null}
                  </div>
                  <h3 className="font-display mt-2 text-xl text-ink">
                    {role.label}
                  </h3>
                  <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                    {role.blurb}
                  </p>
                </div>
              );
            })}
          </div>

          {/* The visitor's own resolved role, straight from the server. */}
          <div className="mt-10 border border-line bg-bone p-6 sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Eyebrow>Your resolved role</Eyebrow>
                {resolvedRole === undefined ? (
                  <p className="font-display mt-2 text-2xl text-slate-ink">
                    Resolving…
                  </p>
                ) : (
                  <p className="font-display mt-2 text-2xl text-ink">
                    {ROLES.find((entry) => entry.id === resolvedRole.role)?.label ??
                      resolvedRole.role}
                  </p>
                )}
                <p className="mt-2 max-w-xl text-[0.9rem] leading-relaxed text-slate-ink">
                  {resolvedRole === undefined
                    ? "Asking the server which role applies to this visitor."
                    : (ROLE_SOURCE_COPY[resolvedRole.source] ??
                      "The server resolved this role from your email address.")}
                </p>
              </div>
              <div className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-slate-ink">
                <span className="text-brass">source</span>{" "}
                {resolvedRole?.source ?? "—"}
              </div>
            </div>
          </div>

          <div className="mt-10 overflow-x-auto border border-line bg-white">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <caption className="sr-only">
                Which role can reach which area of the RITAA portal
              </caption>
              <thead>
                <tr className="border-b border-line bg-bone">
                  <th
                    scope="col"
                    className="font-mono px-4 py-3 text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
                  >
                    Area of the portal
                  </th>
                  {ROLES.map((role) => (
                    <th
                      key={role.id}
                      scope="col"
                      className="font-mono px-4 py-3 text-center text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink"
                    >
                      {role.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACCESS_MODEL.map((row) => (
                  <tr key={row.area} className="border-b border-line last:border-0">
                    <th
                      scope="row"
                      className="px-4 py-3 text-[0.875rem] font-normal text-ink"
                    >
                      {row.area}
                    </th>
                    {ROLES.map((role) => {
                      const allowed = row.roles.includes(role.id);
                      return (
                        <td
                          key={role.id}
                          className={`font-mono px-4 py-3 text-center text-[0.8rem] ${
                            allowed ? "text-jade" : "text-slate-ink/40"
                          }`}
                        >
                          <span className="sr-only">
                            {allowed ? "Allowed" : "Not allowed"}
                          </span>
                          <span aria-hidden>{allowed ? "✓" : "—"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 max-w-3xl text-[0.875rem] leading-relaxed text-slate-ink">
            Where this stands today: roles resolve on the server, approval of a
            verification request is an internal-only mutation, and the directory
            already enforces per-field visibility server-side so a hidden phone
            number is never sent to the browser. Route-level gating — the part that
            keeps a guest out of the admin panel — is the model above and is not
            enforced in code yet. It must be in place before the portal opens
            publicly.
          </p>
        </Shell>
      </section>

      {/* ---- What the office does next ---------------------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-16 sm:py-20">
          <SectionHead
            eyebrow="After you apply"
            title="What happens on the association's side"
          />
          <ol className="grid gap-px border border-line bg-line sm:grid-cols-3">
            {AFTER_STEPS.map((step) => (
              <li key={step.n} className="bg-bone-deep p-7">
                <span className="font-mono text-[0.7rem] tabular-nums tracking-[0.18em] text-brass">
                  {step.n}
                </span>
                <h3 className="font-display mt-2 text-xl leading-snug text-ink">
                  {step.t}
                </h3>
                <p className="mt-2.5 text-[0.88rem] leading-relaxed text-slate-ink">
                  {step.c}
                </p>
              </li>
            ))}
          </ol>
          <p className="font-mono mt-10 text-[0.72rem] uppercase tracking-[0.14em] text-slate-ink">
            Questions · {RITAA.email} · {RITAA.phone}
          </p>
        </Shell>
      </section>
    </>
  );
}
