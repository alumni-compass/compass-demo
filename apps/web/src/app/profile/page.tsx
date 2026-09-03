"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";

import ConnectedAccounts from "@/components/connected-accounts";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import { toast } from "sonner";

import {
  Button,
  Card,
  Eyebrow,
  LoadingRows,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  VerifiedMark,
} from "@/components/kit";
import {
  BATCH_YEARS,
  DEPARTMENT_NAMES,
  DEPARTMENTS,
  REGIONS,
  RITAA,
} from "@/lib/site";

/**
 * Module 2 — Alumni Profiles.
 *
 * The brief asks for three things and this page does exactly those three:
 * an editable profile carrying academic, personal and professional details;
 * tagging for skills, location and industries; and visibility settings per
 * field (public/private).
 *
 * Ownership. The profile shown here is always the signed-in member's own. None
 * of the three Convex calls takes an email argument: `profiles.byEmail`,
 * `profiles.upsertProfile` and `profiles.setFieldVisibility` all derive the
 * address from the verified session token via `authz.requireEmail`, so there is
 * no argument a caller could point at somebody else's record. An earlier version
 * of this page asked the member to type the address to load, and that was
 * directly exploitable: the same argument let any anonymous visitor read a
 * member's unredacted row — including a phone number they had marked private —
 * and overwrite their name, company or LinkedIn URL. The address now comes from
 * the session and the form sits behind `Authenticated`.
 *
 * Verification. `verified` and `featured` are not on this form and are not
 * accepted by any mutation in `profiles.ts`. The verified mark is granted only by
 * `access.ts:reviewVerification` after the office checks a roll number against
 * college records, so saving a profile here can never award it.
 *
 * Redaction itself belongs to the backend: `directory.ts` strips hidden fields
 * before they leave Convex. The preview on this page re-applies the same rule to
 * the values in the form so a member can see the consequence of a toggle
 * immediately, but it is a mirror of the server's rule, not the enforcement.
 */

/* ------------------------------------------------------------------ */
/* Shared bits                                                        */
/* ------------------------------------------------------------------ */

type SavedProfile = NonNullable<FunctionReturnType<typeof api.profiles.byEmail>>;

/**
 * The fields `profiles.setFieldVisibility` accepts, which are exactly the fields
 * `directory.publicView` knows how to redact. The backend rejects anything else,
 * so this list cannot drift into promising privacy the directory will not honour.
 */
const PRIVACY = {
  company: { field: "company", label: "Company" },
  region: { field: "region", label: "Location" },
  email: { field: "email", label: "Email" },
  phone: { field: "phone", label: "Phone" },
  linkedinUrl: { field: "linkedinUrl", label: "LinkedIn" },
} as const;

/** Same five, in the order the summary list reads them out. */
const PRIVACY_FIELDS = [
  PRIVACY.company,
  PRIVACY.region,
  PRIVACY.email,
  PRIVACY.phone,
  PRIVACY.linkedinUrl,
] as const;

type PrivacyField = { readonly field: string; readonly label: string };

/**
 * site.ts stops at the current year; `upsertProfile` also accepts next year's
 * cohort so a final-year student can claim their batch before graduating.
 */
const BATCH_OPTIONS = [
  ...BATCH_YEARS,
  BATCH_YEARS[BATCH_YEARS.length - 1]! + 1,
];

const BIO_LIMIT = 600;

const CONTROL =
  "w-full border border-line bg-white px-3 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-ink/55 hover:border-brass/60 focus:border-maroon";
const SELECT = `${CONTROL} font-mono text-[0.8rem]`;
const READONLY = `${CONTROL} bg-bone text-slate-ink hover:border-line`;
const LABEL =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";
const HINT = "text-[0.8rem] leading-snug text-slate-ink";
const ERROR = "font-mono text-[0.7rem] uppercase tracking-[0.1em] text-maroon";

function shortBatch(batch: number) {
  return `’${String(batch).slice(2)}`;
}

/**
 * Convex wraps a thrown Error as "Uncaught Error: <message> at handler (…)".
 * The member should read the sentence the mutation wrote, not the stack.
 */
function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const matched = raw.match(/Uncaught Error:\s*([^\n]+)/);
  return (matched?.[1] ?? raw)
    .replace(/\s+at handler.*$/, "")
    .replace(/\s*\[Request ID:.*$/, "")
    .trim();
}

/** Labelled control. The visibility toggle sits on the label row when present. */
function FormRow({
  id,
  label,
  hint,
  error,
  visibility,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  visibility?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <label className={LABEL} htmlFor={id}>
          {label}
        </label>
        {visibility}
      </div>
      <div className="mt-2">{children}</div>
      {hint ? (
        <p id={`${id}-hint`} className={`mt-2 ${HINT}`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={`mt-2 ${ERROR}`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Public / private switch for one field.
 *
 * A real button with `role="switch"`, so it is reachable by Tab and operable
 * with Space or Enter. Checked means private, which the accessible name spells
 * out rather than leaving to the colour.
 */
function VisibilityToggle({
  label,
  hidden,
  busy,
  onToggle,
}: {
  label: string;
  hidden: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={hidden}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => onToggle(!hidden)}
      aria-label={`${label} is ${
        hidden ? "private" : "public"
      }. Activate to make it ${hidden ? "public" : "private"}.`}
      title={
        hidden
          ? `${label} is hidden from the directory for everyone`
          : `${label} is visible to signed-in members`
      }
      className={`font-mono inline-flex items-center gap-1.5 border px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        hidden
          ? "border-maroon/40 bg-maroon/8 text-maroon hover:border-maroon"
          : "border-jade/30 bg-jade/10 text-jade hover:border-jade"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 ${hidden ? "bg-maroon" : "bg-jade"}`}
      />
      <span aria-hidden>{busy ? "Saving…" : hidden ? "Private" : "Public"}</span>
    </button>
  );
}

/**
 * Tag editor for skills, industries and mentor topics.
 *
 * Type a value and press Enter or comma to add it; a pasted "a, b, c" splits on
 * the commas. Every tag carries its own remove button with a spoken label. The
 * tag list sits above the input so adding one never moves an existing remove
 * button out from under the pointer. No library — this is three DOM elements.
 */
function TagField({
  id,
  label,
  hint,
  placeholder,
  values,
  onChange,
  tone = "quiet",
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  tone?: "quiet" | "brass" | "jade";
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((part) => part.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (parts.length > 0) {
      const next = [...values];
      for (const part of parts) {
        const clash = next.some(
          (existing) => existing.toLowerCase() === part.toLowerCase(),
        );
        if (!clash) next.push(part);
      }
      if (next.length !== values.length) onChange(next);
    }
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      // Enter must add a tag, never submit the surrounding form.
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && values.length > 0) {
      event.preventDefault();
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>

      {values.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <span className="inline-flex items-center gap-1">
                <Pill tone={tone}>{value}</Pill>
                <button
                  type="button"
                  aria-label={`Remove ${value} from ${label.toLowerCase()}`}
                  onClick={() =>
                    onChange(values.filter((existing) => existing !== value))
                  }
                  className="font-mono border border-line bg-white px-1.5 py-0.5 text-[0.7rem] leading-none text-slate-ink transition-colors hover:border-maroon hover:text-maroon"
                >
                  <span aria-hidden>✕</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex gap-2">
        <input
          id={id}
          type="text"
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
          className={CONTROL}
        />
        <button
          type="button"
          onClick={() => commit(draft)}
          disabled={draft.trim().length === 0}
          className="font-mono shrink-0 border border-ink/25 px-4 text-[0.72rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-maroon hover:text-maroon disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <p id={`${id}-hint`} className={`mt-2 ${HINT}`}>
        {hint} Press Enter or comma to add.{" "}
        <span className="font-mono tabular-nums">{values.length}</span> added.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page — the session decides whose profile this is                    */
/* ------------------------------------------------------------------ */

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        module="Module 02 · Alumni Profiles"
        title="Your profile, and exactly who sees each part of it."
        lede="Academic, personal and professional details in one form. Tag your skills, location and industries so members can find you — and mark any contact field private if you would rather it stayed off the directory."
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone="dark">Editable profile</Pill>
          <Pill tone="dark">Skill · location · industry tags</Pill>
          <Pill tone="dark">Per-field public / private</Pill>
        </div>
      </PageHeader>

      {/* The three session states, handled the way /join handles them. */}
      <AuthLoading>
        <Shell>
          <section className="py-16 sm:py-20" aria-busy>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-slate-ink">
              Checking your session…
            </p>
            <div className="mt-6">
              <LoadingRows rows={5} />
            </div>
          </section>
        </Shell>
      </AuthLoading>

      <Unauthenticated>
        <SignInRequired />
      </Unauthenticated>

      <Authenticated>
        <OwnProfile />
      </Authenticated>
    </>
  );
}

/**
 * No session, so there is no profile to edit — and, deliberately, nothing to
 * type either. An address box here is what made the old version exploitable.
 */
function SignInRequired() {
  return (
    <Shell>
      <section className="py-16 sm:py-20">
        <SectionHead
          eyebrow="Sign in required"
          title="Your profile belongs to your account"
          lede="A profile can only be read and edited by the member it belongs to, so this page needs a session before it can show you anything."
        />
        <Card className="max-w-2xl hover:border-line">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Eyebrow>Not signed in</Eyebrow>
            <Pill tone="quiet">No session</Pill>
          </div>
          <h3 className="font-display mt-4 text-2xl leading-snug text-ink">
            Sign in to edit your profile.
          </h3>
          <p className="mt-3 text-[0.9rem] leading-relaxed text-slate-ink">
            The profile you edit here is the one attached to your signed-in
            account. There is no box for typing an address — the
            association&rsquo;s server takes your email from your session token,
            so a member can only ever load and change their own record, and
            nobody can read a field another member has marked private.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button href="/join">Sign in or join RITAA</Button>
            <Button href="/directory" variant="outline">
              Browse the directory
            </Button>
          </div>
          <p className={`mt-5 border-t border-line pt-5 ${HINT}`}>
            No profile yet? Signing in is enough to start one — the form opens
            blank and saving it creates your record, unverified until the office
            confirms you. Questions: {RITAA.email}.
          </p>
        </Card>
      </section>
    </Shell>
  );
}

/**
 * Signed in. `profiles.byEmail` takes no arguments and resolves the row from the
 * session; `auth.getCurrentUser` is here only to show the member which address
 * that is, and it returns null rather than throwing for a session without one.
 */
function OwnProfile() {
  const profile = useQuery(api.profiles.byEmail, {});
  const currentUser = useQuery(api.auth.getCurrentUser);

  if (profile === undefined || currentUser === undefined) {
    return (
      <Shell>
        <section className="py-16 sm:py-20" aria-busy>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-slate-ink">
            Loading your profile…
          </p>
          <div className="mt-6">
            <LoadingRows rows={5} />
          </div>
        </section>
      </Shell>
    );
  }

  const sessionEmail =
    typeof currentUser?.email === "string" ? currentUser.email : null;

  /**
   * A session carrying no email cannot be keyed to a profile — every mutation
   * would fail inside `authz.requireEmail`. Say so, rather than render a form
   * whose Save button could never work.
   */
  if (sessionEmail === null) {
    return (
      <Shell>
        <section className="py-16 sm:py-20">
          <SectionHead
            eyebrow="Account problem"
            title="Your account has no email address attached"
            lede="Profiles are filed under an email address, so there is nothing for this page to load or save until your account has one."
          />
          <Card className="max-w-2xl hover:border-line">
            <p className="text-[0.9rem] leading-relaxed text-slate-ink">
              You are signed in, but the session carries no email address. The
              association&rsquo;s server keys every profile on the address in your
              session token, so it cannot find or create your record. Write to{" "}
              <a
                href={`mailto:${RITAA.email}`}
                className="text-maroon underline decoration-brass/50 underline-offset-4"
              >
                {RITAA.email}
              </a>{" "}
              and the office will attach one to your account.
            </p>
            <div className="mt-6">
              <Button href="/directory" variant="outline">
                Browse the directory
              </Button>
            </div>
          </Card>
        </section>
      </Shell>
    );
  }

  return (
    // Keyed on the address so signing in as somebody else starts a clean form
    // instead of leaving the previous member's values in the inputs.
    <ProfileEditor
      key={sessionEmail}
      sessionEmail={sessionEmail}
      saved={profile}
    />
  );
}

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

function ProfileEditor({
  sessionEmail,
  saved,
}: {
  sessionEmail: string;
  saved: SavedProfile | null;
}) {
  const upsertProfile = useMutation(api.profiles.upsertProfile);
  const setFieldVisibility = useMutation(api.profiles.setFieldVisibility);

  /**
   * The batch and department option lists, as the association configured them.
   *
   * `profileFields.list` is the same source the details form reads and the same
   * one `upsertProfile` validates against, so this select cannot offer a batch
   * the server would refuse. The local constants remain as the fallback for the
   * moment before the query resolves and for a deployment where no admin has
   * saved a configuration yet.
   */
  const fieldConfig = useQuery(api.profileFields.list);
  const configuredOptions = (key: string, fallback: readonly (string | number)[]) => {
    const field = fieldConfig?.fields.find((entry) => entry.key === key);
    return field && field.options.length > 0
      ? field.options
      : fallback.map((value) => String(value));
  };

  /* ---- Form state. Seeded once from the record, then owned here. ------ */
  const [name, setName] = useState(saved?.name ?? "");
  const [phone, setPhone] = useState(saved?.phone ?? "");
  const [batch, setBatch] = useState(saved ? String(saved.batch) : "");
  const [department, setDepartment] = useState(saved?.department ?? "");
  const [designation, setDesignation] = useState(saved?.designation ?? "");
  const [company, setCompany] = useState(saved?.company ?? "");
  const [region, setRegion] = useState(saved?.region ?? "");
  const [bio, setBio] = useState(saved?.bio ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(saved?.linkedinUrl ?? "");
  const [skills, setSkills] = useState<string[]>(saved?.skills ?? []);
  const [industries, setIndustries] = useState<string[]>(saved?.industries ?? []);
  const [openToMentor, setOpenToMentor] = useState(saved?.openToMentor ?? false);
  const [mentorTopics, setMentorTopics] = useState<string[]>(
    saved?.mentorTopics ?? [],
  );

  /**
   * Visibility before the record exists has nowhere to live on the server, so a
   * new profile holds its choices here and ships them with the first save. Once
   * the row exists the saved value is the single source of truth and every
   * toggle is written immediately by `setFieldVisibility` — which is why the
   * switches always show what the directory is actually doing, not what this
   * form last guessed.
   */
  const [draftHidden, setDraftHidden] = useState<string[]>(
    saved?.hiddenFields ?? [],
  );
  const hidden = new Set(saved ? saved.hiddenFields : draftHidden);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedResult, setSavedResult] = useState<{ created: boolean } | null>(
    null,
  );
  const [pendingField, setPendingField] = useState<string | null>(null);

  /* ---- Validation mirrors upsertProfile, so the server never has to
          reject something the member could have been told about here. ---- */
  function validate() {
    const found: Record<string, string> = {};
    if (!name.trim()) {
      found.name = "Enter your name — it is how members find you.";
    }
    const year = Number(batch);
    if (!batch || !Number.isInteger(year)) {
      found.batch = "Choose your graduating batch.";
    }
    if (!department) {
      found.department = "Choose your department.";
    }
    if (!region) {
      found.region = "Choose your location — the directory filters on it.";
    }
    const link = linkedinUrl.trim();
    if (link && !/^https?:\/\/\S+$/i.test(link)) {
      found.linkedinUrl = "Include the full link, starting with https://.";
    }
    if (bio.trim().length > BIO_LIMIT) {
      found.bio = `Trim the bio to ${BIO_LIMIT} characters or fewer.`;
    }
    return found;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setSavedResult(null);
    if (Object.keys(found).length > 0) {
      setFormError(
        `Fix ${Object.keys(found).length === 1 ? "the field" : "the fields"} marked below, then save again.`,
      );
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      // No email argument. The mutation keys the row on the session, which is
      // what stops one member from writing over another member's profile.
      const outcome = await upsertProfile({
        name: name.trim(),
        phone: phone.trim() || undefined,
        batch: Number(batch),
        department,
        designation: designation.trim(),
        company: company.trim(),
        region,
        skills,
        industries,
        bio: bio.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
        openToMentor,
        mentorTopics,
        hiddenFields: [...hidden],
      });
      setSavedResult({ created: outcome.created });
      toast.success(outcome.created ? "Profile created" : "Profile saved");
    } catch (error) {
      setFormError(readableError(error));
      toast.error("Profile not saved");
    } finally {
      setSaving(false);
    }
  }

  async function toggleVisibility(target: PrivacyField, next: boolean) {
    const { field, label } = target;
    // The confirmation below belongs to the last save; a privacy change makes
    // its private-field count stale, so it goes.
    setSavedResult(null);

    if (!saved) {
      // Nothing to patch yet — remember the choice and save it with the profile.
      setDraftHidden((current) =>
        next
          ? [...current.filter((f) => f !== field), field]
          : current.filter((f) => f !== field),
      );
      return;
    }

    setPendingField(field);
    try {
      // Session-keyed as well: only the caller's own record can be re-hidden.
      await setFieldVisibility({ field, hidden: next });
      setFormError(null);
      toast.success(`${label} is now ${next ? "private" : "public"}`);
    } catch (error) {
      const message = readableError(error);
      setFormError(message);
      toast.error(message);
    } finally {
      setPendingField(null);
    }
  }

  function toggleFor(field: PrivacyField) {
    return (
      <VisibilityToggle
        label={field.label}
        hidden={hidden.has(field.field)}
        busy={pendingField === field.field}
        onToggle={(next) => toggleVisibility(field, next)}
      />
    );
  }

  const privateCount = PRIVACY_FIELDS.filter((f) => hidden.has(f.field)).length;

  return (
    <Shell>
      <section className="py-16 sm:py-20">
        <SectionHead
          eyebrow={saved ? "Your record · Edit" : "Your record · Create"}
          title={saved ? `Editing ${saved.name}` : "No profile on record yet"}
          lede={
            saved
              ? "Change anything below and save. The verified mark and featured status are not on this form — only the association can grant those."
              : "Nothing is filed under your account yet. Fill the form and save to create the record; it appears in the directory as unverified until the office confirms your roll number."
          }
        />

        <p className="mb-10 max-w-3xl border-l-2 border-brass bg-white px-4 py-3 text-[0.875rem] leading-relaxed text-slate-ink">
          <strong className="font-normal text-ink">
            This profile is bound to your signed-in account.
          </strong>{" "}
          The server reads your email address from your session token rather than
          from anything this page sends, so you can only load and edit your own
          record — and no one else can open yours or reverse a field you have
          marked private.
        </p>

        {/* ---- Record status. Read-only on purpose. --------------------- */}
        <div className="mb-10 grid gap-px border border-line bg-line sm:grid-cols-3">
          <div className="bg-white p-5">
            <Eyebrow>Signed in as</Eyebrow>
            <p className="font-mono mt-2 break-words text-[0.8rem] text-ink">
              {sessionEmail}
            </p>
          </div>
          <div className="bg-white p-5">
            <Eyebrow>Verification</Eyebrow>
            <div className="mt-2">
              {saved?.verified ? (
                <VerifiedMark />
              ) : (
                <Pill tone="quiet">Not verified</Pill>
              )}
            </div>
            <p className="mt-2 text-[0.78rem] leading-snug text-slate-ink">
              Granted by the association office, never from this page.
            </p>
          </div>
          <div className="bg-white p-5">
            <Eyebrow>Kept private</Eyebrow>
            <p className="font-mono mt-2 text-[0.8rem] tabular-nums text-ink">
              {privateCount} of {PRIVACY_FIELDS.length} fields
            </p>
            <p className="mt-2 text-[0.78rem] leading-snug text-slate-ink">
              Private fields never leave the server.
            </p>
          </div>
        </div>

        {/* ---- Both providers on one account --------------------------- */}
        <div className="mb-10 border border-line bg-white p-5">
          <ConnectedAccounts callbackURL="/profile" />
        </div>

        <div className="grid gap-12 lg:grid-cols-[1.45fr_1fr] lg:items-start lg:gap-16">
          {/* ---- The form ---------------------------------------------- */}
          <form onSubmit={handleSubmit} noValidate className="space-y-12">
            {/* ---- Academic ------------------------------------------- */}
            <fieldset className="border border-line bg-white p-6 sm:p-7">
              <legend className="font-mono px-2 text-[0.7rem] uppercase tracking-[0.14em] text-brass">
                Academic
              </legend>
              <p className={`${HINT} mt-1`}>
                What RIT has on record for you. The batch year is also the
                directory&rsquo;s cohort key, so it decides which batch rail you
                appear under.
              </p>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <FormRow
                  id="profile-batch"
                  label="Graduating batch"
                  error={errors.batch}
                >
                  <select
                    id="profile-batch"
                    name="batch"
                    required
                    aria-invalid={errors.batch ? true : undefined}
                    aria-describedby={errors.batch ? "profile-batch-error" : undefined}
                    value={batch}
                    onChange={(event) => setBatch(event.target.value)}
                    className={SELECT}
                  >
                    <option value="">Select your batch</option>
                    {configuredOptions("batch", BATCH_OPTIONS).map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </FormRow>

                <FormRow
                  id="profile-department"
                  label="Department"
                  error={errors.department}
                >
                  <select
                    id="profile-department"
                    name="department"
                    required
                    aria-invalid={errors.department ? true : undefined}
                    aria-describedby={
                      errors.department ? "profile-department-error" : undefined
                    }
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                    className={SELECT}
                  >
                    <option value="">Select your department</option>
                    {configuredOptions("department", DEPARTMENTS).map((code) => (
                      <option key={code} value={code}>
                        {DEPARTMENT_NAMES[code] ? `${code} — ${DEPARTMENT_NAMES[code]}` : code}
                      </option>
                    ))}
                  </select>
                </FormRow>

                <FormRow
                  id="profile-graduation"
                  label="Graduation year"
                  className="sm:col-span-2"
                  hint="Taken from the batch above — the record keeps one year for both. The roll number and graduation year the office checks against college records are collected in the join flow, not here."
                >
                  <input
                    id="profile-graduation"
                    readOnly
                    aria-describedby="profile-graduation-hint"
                    value={batch ? `Graduated in ${batch}` : "Choose a batch first"}
                    className={`${READONLY} font-mono tabular-nums`}
                  />
                </FormRow>
              </div>
            </fieldset>

            {/* ---- Personal ------------------------------------------- */}
            <fieldset className="border border-line bg-white p-6 sm:p-7">
              <legend className="font-mono px-2 text-[0.7rem] uppercase tracking-[0.14em] text-brass">
                Personal
              </legend>
              <p className={`${HINT} mt-1`}>
                Your name and department are always public — a directory of
                anonymous entries would be useless. Everything else in this block
                has its own switch.
              </p>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <FormRow
                  id="profile-name"
                  label="Full name"
                  error={errors.name}
                  className="sm:col-span-2"
                >
                  <input
                    id="profile-name"
                    name="name"
                    required
                    autoComplete="name"
                    placeholder="e.g. Arunprasanth S"
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "profile-name-error" : undefined}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={CONTROL}
                  />
                </FormRow>

                <FormRow
                  id="profile-email"
                  label="Email"
                  visibility={toggleFor(PRIVACY.email)}
                  hint="The address on your signed-in account, and the key your profile is filed under. It is not editable here — ask the association office if it needs to change."
                >
                  <input
                    id="profile-email"
                    type="email"
                    readOnly
                    autoComplete="email"
                    aria-describedby="profile-email-hint"
                    value={sessionEmail}
                    className={`${READONLY} font-mono text-[0.8rem]`}
                  />
                </FormRow>

                <FormRow
                  id="profile-phone"
                  label="Phone"
                  visibility={toggleFor(PRIVACY.phone)}
                  hint="Optional. Most members keep this private and let people reach them by email first."
                >
                  <input
                    id="profile-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="e.g. 94xxxxxxxx"
                    aria-describedby="profile-phone-hint"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className={CONTROL}
                  />
                </FormRow>

                <FormRow
                  id="profile-region"
                  label="Location"
                  error={errors.region}
                  visibility={toggleFor(PRIVACY.region)}
                  hint="Where you are based now. The directory's region filter uses this exact list, which is why it is a choice rather than free text."
                  className="sm:col-span-2"
                >
                  <select
                    id="profile-region"
                    name="region"
                    required
                    aria-invalid={errors.region ? true : undefined}
                    aria-describedby={
                      errors.region
                        ? "profile-region-error profile-region-hint"
                        : "profile-region-hint"
                    }
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    className={SELECT}
                  >
                    <option value="">Select your location</option>
                    {REGIONS.map((place) => (
                      <option key={place} value={place}>
                        {place}
                      </option>
                    ))}
                  </select>
                </FormRow>

                <FormRow
                  id="profile-bio"
                  label="Short bio"
                  error={errors.bio}
                  className="sm:col-span-2"
                  hint={
                    <>
                      Two or three sentences on what you work on and what you are
                      happy to be asked about.{" "}
                      <span className="font-mono tabular-nums">
                        {bio.trim().length}
                      </span>{" "}
                      / {BIO_LIMIT} characters.
                    </>
                  }
                >
                  <textarea
                    id="profile-bio"
                    name="bio"
                    rows={5}
                    maxLength={BIO_LIMIT + 100}
                    aria-invalid={errors.bio ? true : undefined}
                    aria-describedby={
                      errors.bio
                        ? "profile-bio-error profile-bio-hint"
                        : "profile-bio-hint"
                    }
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    className={`${CONTROL} resize-y leading-relaxed`}
                  />
                </FormRow>
              </div>
            </fieldset>

            {/* ---- Professional --------------------------------------- */}
            <fieldset className="border border-line bg-white p-6 sm:p-7">
              <legend className="font-mono px-2 text-[0.7rem] uppercase tracking-[0.14em] text-brass">
                Professional
              </legend>
              <p className={`${HINT} mt-1`}>
                What you do now. Company and LinkedIn can each be kept private if
                your employer would rather you did not publish it.
              </p>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <FormRow
                  id="profile-designation"
                  label="Designation"
                  hint="Your current role, in the words your industry uses."
                >
                  <input
                    id="profile-designation"
                    name="designation"
                    autoComplete="organization-title"
                    placeholder="e.g. Senior Software Engineer"
                    aria-describedby="profile-designation-hint"
                    value={designation}
                    onChange={(event) => setDesignation(event.target.value)}
                    className={CONTROL}
                  />
                </FormRow>

                <FormRow
                  id="profile-company"
                  label="Company"
                  visibility={toggleFor(PRIVACY.company)}
                  hint="The directory's company filter searches this field, so members looking for someone inside your employer find you through it."
                >
                  <input
                    id="profile-company"
                    name="company"
                    autoComplete="organization"
                    placeholder="e.g. Zoho Corporation"
                    aria-describedby="profile-company-hint"
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    className={CONTROL}
                  />
                </FormRow>

                <div className="sm:col-span-2">
                  <TagField
                    id="profile-industries"
                    label="Industries"
                    tone="brass"
                    placeholder="e.g. SaaS, Manufacturing, EdTech"
                    values={industries}
                    onChange={setIndustries}
                    hint="The sectors you work in — this is what founders on RACE filter by."
                  />
                </div>

                <FormRow
                  id="profile-linkedin"
                  label="LinkedIn"
                  error={errors.linkedinUrl}
                  visibility={toggleFor(PRIVACY.linkedinUrl)}
                  className="sm:col-span-2"
                  hint="Optional. Paste the full profile address, starting with https://."
                >
                  <input
                    id="profile-linkedin"
                    name="linkedinUrl"
                    type="url"
                    inputMode="url"
                    placeholder="https://www.linkedin.com/in/…"
                    aria-invalid={errors.linkedinUrl ? true : undefined}
                    aria-describedby={
                      errors.linkedinUrl
                        ? "profile-linkedin-error profile-linkedin-hint"
                        : "profile-linkedin-hint"
                    }
                    value={linkedinUrl}
                    onChange={(event) => setLinkedinUrl(event.target.value)}
                    className={CONTROL}
                  />
                </FormRow>
              </div>
            </fieldset>

            {/* ---- Tags + mentorship ---------------------------------- */}
            <fieldset className="border border-line bg-white p-6 sm:p-7">
              <legend className="font-mono px-2 text-[0.7rem] uppercase tracking-[0.14em] text-brass">
                Skills & mentoring
              </legend>
              <p className={`${HINT} mt-1`}>
                Skills are the tags the directory shows on your card and searches
                against. Mentor topics feed the mentorship network in module 5.
              </p>

              <div className="mt-6 space-y-6">
                <TagField
                  id="profile-skills"
                  label="Skills"
                  placeholder="e.g. React, Embedded C, Structural design"
                  values={skills}
                  onChange={setSkills}
                  hint="Add the things you would be comfortable being asked about."
                />

                <div className="flex gap-3 border border-line bg-bone p-4">
                  <input
                    id="profile-mentor"
                    name="openToMentor"
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-maroon"
                    checked={openToMentor}
                    onChange={(event) => setOpenToMentor(event.target.checked)}
                  />
                  <label
                    htmlFor="profile-mentor"
                    className="text-[0.85rem] leading-relaxed text-ink"
                  >
                    I am open to mentoring alumni and students. This lists you in
                    the mentorship network, where members can book a slot against
                    one specific question.
                  </label>
                </div>

                {openToMentor ? (
                  <TagField
                    id="profile-mentor-topics"
                    label="Will mentor on"
                    tone="jade"
                    placeholder="e.g. First job interviews, GATE preparation"
                    values={mentorTopics}
                    onChange={setMentorTopics}
                    hint="Naming topics gets you better requests than leaving it open."
                  />
                ) : (
                  <p className={HINT}>
                    Mentor topics appear here once you tick the box above. Turning
                    mentoring off clears the saved topics.
                  </p>
                )}
              </div>
            </fieldset>

            {/* ---- Privacy summary ------------------------------------ */}
            <fieldset className="border border-line bg-white p-6 sm:p-7">
              <legend className="font-mono px-2 text-[0.7rem] uppercase tracking-[0.14em] text-brass">
                Visibility per field
              </legend>
              <p className={`${HINT} mt-1`}>
                <strong className="font-normal text-ink">
                  Private means hidden from the directory for everyone.
                </strong>{" "}
                A private field is stripped by the backend before the directory
                sends anything to a browser, so no other member — verified or not
                — receives it, and the profile page shows “Not shared by this
                member” in its place instead of leaving a gap. It stays in the
                association&rsquo;s own records, and you can still see and edit it
                here. Public means visible to signed-in members of the directory.
              </p>

              <ul className="mt-6 divide-y divide-line border-y border-line">
                {PRIVACY_FIELDS.map((field) => (
                  <li
                    key={field.field}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-ink">
                      {field.label}
                    </span>
                    <VisibilityToggle
                      label={field.label}
                      hidden={hidden.has(field.field)}
                      busy={pendingField === field.field}
                      onToggle={(next) => toggleVisibility(field, next)}
                    />
                  </li>
                ))}
              </ul>

              <p className={`mt-5 ${HINT}`}>
                {saved
                  ? "Each switch is written to your record the moment you press it — you do not need to save the form for a privacy change to take effect."
                  : "These choices are stored with the profile when you save it for the first time. After that, each switch takes effect immediately on its own."}
              </p>
            </fieldset>

            {/* ---- Save ----------------------------------------------- */}
            <div className="border border-line bg-bone-deep p-6 sm:p-7">
              {formError ? (
                <p
                  role="alert"
                  className="mb-4 border-l-2 border-maroon bg-white px-4 py-3 text-[0.875rem] leading-relaxed text-ink"
                >
                  {formError}
                </p>
              ) : null}

              {savedResult ? (
                <div
                  role="status"
                  className="mb-4 border-l-2 border-jade bg-white px-4 py-3"
                >
                  <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-jade">
                    {savedResult.created ? "Profile created" : "Profile saved"}
                  </p>
                  <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink">
                    {savedResult.created
                      ? "Your record is in the directory now, marked unverified until the office checks your roll number against college records."
                      : "Your changes are live in the directory."}{" "}
                    {privateCount > 0
                      ? `${privateCount} ${privateCount === 1 ? "field is" : "fields are"} kept private and were not published.`
                      : "Every field on this profile is public."}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : saved ? "Save changes" : "Create profile"}
                </Button>
                {saved ? (
                  <Button
                    href={{ pathname: `/directory/${saved._id}` }}
                    variant="outline"
                  >
                    View public profile
                  </Button>
                ) : null}
                <Link
                  href="/directory"
                  className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-slate-ink underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon"
                >
                  Back to directory
                </Link>
              </div>

              <p className={`mt-4 ${HINT}`}>
                Verified and featured status are deliberately absent from this
                form. Verification is granted by the association after it checks
                your details against college records — nothing you save here can
                award it. Questions: {RITAA.email}.
              </p>
            </div>
          </form>

          {/* ---- Live preview ----------------------------------------- */}
          <div className="lg:sticky lg:top-8">
            <DirectoryPreview
              person={{
                name: name.trim(),
                batch: batch ? Number(batch) : null,
                department,
                designation: designation.trim(),
                company: hidden.has("company") ? null : company.trim(),
                region: hidden.has("region") ? null : region,
                email: hidden.has("email") ? null : sessionEmail,
                phone: hidden.has("phone") ? null : phone.trim(),
                linkedinUrl: hidden.has("linkedinUrl") ? null : linkedinUrl.trim(),
                skills,
                industries,
                bio: bio.trim(),
                openToMentor,
                mentorTopics,
                verified: saved?.verified ?? false,
              }}
              privateCount={privateCount}
            />
          </div>
        </div>
      </section>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Preview — the same redaction the directory applies                  */
/* ------------------------------------------------------------------ */

type PreviewPerson = {
  name: string;
  batch: number | null;
  department: string;
  designation: string;
  company: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  skills: string[];
  industries: string[];
  bio: string;
  openToMentor: boolean;
  mentorTopics: string[];
  verified: boolean;
};

/**
 * Contact row that names a redaction instead of leaving a blank.
 *
 * `null` means the field is marked private and was stripped; an empty string
 * means it is public but not filled in. Both reach other members as the
 * directory's "Not shared by this member" line — the distinction here is for the
 * owner, who is the only person who can tell the two apart.
 */
function PreviewContact({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-b-0">
      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-[0.82rem] text-ink">
        {value === null ? (
          <span className="font-mono text-[0.7rem] text-maroon">
            Private — not shared
          </span>
        ) : value === "" ? (
          <span className="font-mono text-[0.7rem] text-slate-ink">
            Not filled in
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * A directory card built from the form, with the hidden fields removed exactly
 * the way `directory.publicView` removes them. It is the point of the visibility
 * switches: flip one and the consequence is on screen before you save.
 */
function DirectoryPreview({
  person,
  privateCount,
}: {
  person: PreviewPerson;
  privateCount: number;
}) {
  return (
    <div>
      <div className="rule-brass h-px w-full" />
      <div className="mt-5">
        <Eyebrow>Live preview</Eyebrow>
        <h2 className="font-display mt-2 text-2xl leading-snug text-ink">
          How the directory shows you
        </h2>
        <p className="mt-2.5 text-[0.875rem] leading-relaxed text-slate-ink">
          This is your card as another signed-in member sees it, with the{" "}
          <span className="font-mono tabular-nums">{privateCount}</span> private{" "}
          {privateCount === 1 ? "field" : "fields"} already removed. It updates as
          you type, before anything is saved.
        </p>
      </div>

      <div className="mt-6 border border-line bg-white p-6">
        <div className="flex items-start gap-4">
          <Monogram name={person.name || "RITAA"} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-display text-lg leading-snug text-ink">
                {person.name || "Your name"}
              </h3>
              {person.verified ? <VerifiedMark /> : null}
              {person.openToMentor ? <Pill tone="jade">Mentors</Pill> : null}
            </div>
            <p className="font-mono mt-1.5 text-[0.7rem] uppercase tracking-[0.1em] tabular-nums text-brass">
              {person.department || "Department"} ·{" "}
              {person.batch === null ? "Batch" : shortBatch(person.batch)}
            </p>
            <p className="mt-2 text-[0.9rem] leading-snug text-ink">
              {person.designation || "Designation not filled in"}
            </p>
            <p className="text-[0.9rem] text-slate-ink">
              {person.company === null
                ? "Company not shared"
                : person.company || "Company not filled in"}
            </p>
            <p className="font-mono mt-2 text-[0.72rem] text-slate-ink">
              {person.region === null
                ? "Region not shared"
                : person.region || "Location not chosen"}
            </p>
          </div>
        </div>

        {person.bio ? (
          <p className="mt-4 text-[0.85rem] leading-relaxed text-slate-ink">
            {person.bio}
          </p>
        ) : null}

        {person.skills.length > 0 ? (
          <div className="mt-4">
            <Eyebrow tone="slate">Skills</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {person.skills.map((skill) => (
                <Pill key={skill}>{skill}</Pill>
              ))}
            </div>
          </div>
        ) : null}

        {person.industries.length > 0 ? (
          <div className="mt-4">
            <Eyebrow tone="slate">Industries</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {person.industries.map((industry) => (
                <Pill key={industry} tone="brass">
                  {industry}
                </Pill>
              ))}
            </div>
          </div>
        ) : null}

        {person.openToMentor && person.mentorTopics.length > 0 ? (
          <div className="mt-4">
            <Eyebrow tone="slate">Will mentor on</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {person.mentorTopics.map((topic) => (
                <Pill key={topic} tone="jade">
                  {topic}
                </Pill>
              ))}
            </div>
          </div>
        ) : null}

        <dl className="mt-5 border-t border-line pt-2">
          <PreviewContact label="Email" value={person.email} />
          <PreviewContact label="Phone" value={person.phone} />
          <PreviewContact label="LinkedIn" value={person.linkedinUrl} />
        </dl>
      </div>

      <p className="font-mono mt-4 text-[0.7rem] leading-relaxed text-slate-ink">
        Redaction is enforced in Convex, not here — a private field is never sent
        to another member&rsquo;s browser at all.
      </p>
    </div>
  );
}
