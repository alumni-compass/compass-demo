"use client";

import { api, type Id, useAction, useMutation, useQuery } from "@/lib/standalone";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import {
  actionErrorMessage,
  Button,
  Card,
  Eyebrow,
  LoadingRows,
  Pill,
  VerifiedMark,
} from "@/components/kit";
import { batchLabelForYear, batchYearFromLabel, RITAA } from "@/lib/site";

/**
 * The member details form — what a member fills in after signing in.
 *
 * NOTHING HERE IS HARD-CODED. The fields, their labels, their help text,
 * whether each is required, the order they appear in and the contents of the
 * two dropdowns all come from `profileFields.list`, which an admin edits in the
 * console. Any extra prompts the association adds come from
 * `questions.profileQuestions`. So this file renders a form; it does not decide
 * what the form asks. Adding the 2027 batch, renaming "Position" to
 * "Designation" or asking a new question is a console change, not a deploy.
 *
 * THE ADDRESS IS NOT EDITABLE, and that is the point of the whole sign-in
 * design: it arrives from Google or LinkedIn already confirmed, which is the
 * only reason the directory can claim its addresses are real. Any address is
 * welcome — there is no college-domain rule anywhere in the portal — but it has
 * to be one the member could actually sign in with.
 *
 * TWO FIELDS SUGGEST RATHER THAN CONSTRAIN. Employer and position are
 * comboboxes backed by `lookups.companies` and `lookups.positions`: type, pick
 * a suggestion from a worldwide source, or keep exactly what you typed. They
 * are not dropdowns because no closed list can name every employer or every
 * job title, and a member whose answer is missing from a dropdown cannot
 * complete the form at all. See the note at the top of `lookups.ts`.
 *
 * LOCATION IS TWO SEPARATE PERMISSIONS, deliberately.
 *   - "Use my current location" is one detection the member asked for, here and
 *     now. The browser asks its own permission question; the answer is turned
 *     into a place name and dropped into the box, editable like any other.
 *   - The checkbox is consent for the portal to refresh that place on each
 *     later sign-in, stored server-side on the profile. It is off unless ticked,
 *     and unticking it clears any place that was detected rather than typed.
 * Coordinates are never stored — `lookups.resolveLocation` uses them to look up
 * a name and discards them. A stored coordinate history is not something the
 * association asked for and not something this form quietly builds.
 */

type FieldKind =
  | "text"
  | "email"
  | "phone"
  | "longText"
  | "select"
  | "company"
  | "position"
  | "location";

type ConfiguredField = {
  key: string;
  label: string;
  help: string | null;
  kind: FieldKind;
  options: string[];
  required: boolean;
  order: number;
  locked: boolean;
};

/* ------------------------------------------------------------------ */
/* Shared control styling                                              */
/* ------------------------------------------------------------------ */

const CONTROL =
  "w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-soft hover:border-line-strong focus:border-maroon focus:outline-none";
const SELECT = `${CONTROL} font-mono text-[0.8rem]`;
const READONLY = `${CONTROL} cursor-not-allowed bg-bone text-slate-ink hover:border-line`;
const LABEL =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";
const HINT = "text-[0.8rem] leading-snug text-slate-ink";

function Row({
  label,
  required,
  help,
  htmlFor,
  children,
  aside,
}: {
  label: string;
  required: boolean;
  help?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className={LABEL} htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-1 text-maroon">*</span> : null}
        </label>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
      {help ? <p className={`mt-2 ${HINT}`}>{help}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The suggestion box                                                  */
/* ------------------------------------------------------------------ */

type Suggestion = { label: string; hint?: string | null; iconUrl?: string | null };

/** One character is enough to start looking. */
const MIN_CHARS = 1;

/**
 * Type-to-search over a live source, with free text always accepted.
 *
 * WHAT OPENS THE LIST, and why that took two goes to get right. The first
 * version opened it from an effect that watched the RESULTS:
 *
 *     useEffect(() => { if (rows.length > 0) setOpen(true) }, [rows.length])
 *
 * which has nothing to do with what the member is doing. Two bugs fell out of
 * it. A field arriving with a saved value searched on mount, so the list
 * appeared over a form nobody had touched. And because every box re-runs its
 * effects when the form re-renders, clicking into the employer field opened the
 * position field's list at the same time — each box was opening on its own
 * data, not on its own focus.
 *
 * Now opening requires all of: this input is focused, the member has typed in
 * THIS box, they have not dismissed it, and there is something to show. None of
 * those can be true for a box the member is not in, so the fields cannot open
 * each other, and nothing searches until somebody types.
 *
 * There is no `onBlur`. Closing on blur races the click on the option — blur
 * fires first and the option unmounts before its handler runs. A mousedown
 * listener outside the component closes it instead, which is the one order that
 * works.
 *
 * WHY IT IS FAST. It asks a QUERY first, which rides the socket the app already
 * holds and answers from `lookupCache` immediately. Only a genuine miss fires
 * the action, once per distinct query; the action writes the cache row and this
 * subscription delivers it without asking again. Backspacing is free.
 */
function SuggestBox({
  id,
  kind,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  kind: "company" | "position";
  value: string;
  placeholder?: string;
  onChange: (value: string, extra?: { domain?: string | null }) => void;
}) {
  const [focused, setFocused] = useState(false);
  /** True once the member has typed in this box. Gates both search and open. */
  const [dirty, setDirty] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [typed, setTyped] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  /** One action per distinct query, however many times this re-renders. */
  const asked = useRef<Set<string>>(new Set());

  const suggestCompanies = useAction(api.lookups.companies);
  const suggestPositions = useAction(api.lookups.positions);

  // Short debounce: the read below is local, so there is much less to protect
  // against than when every keystroke went out to the network.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(value.trim()), 140);
    return () => clearTimeout(timer);
  }, [value]);

  /* Nothing is searched until this box has been typed in — which is also what
     stops a saved value from firing a lookup the moment the form opens. */
  const query = dirty && typed.length >= MIN_CHARS ? typed : "";

  const cached = useQuery(api.lookups.cached, query ? { kind, query } : "skip");

  useEffect(() => {
    if (!query) return;
    // Wait for the cache to answer before deciding this is a miss.
    if (cached === undefined) return;
    if (cached.hit && !cached.stale) return;
    if (asked.current.has(query)) return;
    asked.current.add(query);

    const run = kind === "company" ? suggestCompanies : suggestPositions;
    void run({ query }).catch(() => {
      // A dead source must not interrupt typing; retry on the next keystroke.
      asked.current.delete(query);
    });
  }, [query, cached, kind, suggestCompanies, suggestPositions]);

  const rows: Suggestion[] = (() => {
    const raw = (cached?.rows ?? []) as Array<Record<string, unknown>>;
    if (kind === "company") {
      return raw.map((row) => ({
        label: String(row.name ?? ""),
        hint: typeof row.domain === "string" ? row.domain : null,
        iconUrl: typeof row.logoUrl === "string" ? row.logoUrl : null,
      }));
    }
    return raw.map((row) => ({ label: String(row.title ?? "") }));
  })().filter((row) => row.label);

  /* Derived, not stored: there is no state that can be left open by mistake. */
  const open = focused && dirty && !dismissed && rows.length > 0;
  const waiting = Boolean(query) && cached !== undefined && !cached.hit;

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) {
        setFocused(false);
        setDismissed(true);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDismissed(true);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      <input
        id={id}
        className={CONTROL}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onChange={(event) => {
          setDirty(true);
          setDismissed(false);
          onChange(event.target.value);
        }}
      />
      {waiting ? (
        <span className="font-mono absolute right-3 top-1/2 -translate-y-1/2 text-[0.6rem] uppercase tracking-[0.1em] text-slate-soft">
          …
        </span>
      ) : null}

      {open ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-line-strong bg-surface shadow-lift"
        >
          {rows.map((row) => (
            <li key={`${row.label}-${row.hint ?? ""}`} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-bone"
                onClick={() => {
                  onChange(row.label, { domain: row.hint ?? null });
                  // Picking one is an answer, so the list is done.
                  setDirty(false);
                  setDismissed(true);
                }}
              >
                {row.iconUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={row.iconUrl}
                    alt=""
                    width={20}
                    height={20}
                    loading="lazy"
                    className="size-5 shrink-0 rounded-[3px] bg-bone object-contain"
                    /* A company with no mark on file must not leave a broken
                       image icon in the list — hide it, keep the row. */
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="size-5 shrink-0 rounded-[3px] border border-line bg-bone"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
                  {row.label}
                </span>
                {row.hint ? (
                  <span className="font-mono shrink-0 text-[0.65rem] text-slate-soft">
                    {row.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          <li className="border-t border-line px-3 py-2">
            <p className="text-[0.7rem] leading-snug text-slate-ink">
              Not listed? Keep typing — whatever you write is saved as it is.
            </p>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

export default function DetailsForm({
  mode = "edit",
}: {
  mode?: "onboarding" | "edit";
}) {
  const router = useRouter();
  const uid = useId();

  const config = useQuery(api.profileFields.list);
  const extraQuestions = useQuery(api.questions.profileQuestions);
  const profile = useQuery(api.profiles.byEmail);
  const priorAnswers = useQuery(api.questions.myProfileAnswers);
  const user = useQuery(api.auth.getCurrentUser);

  const save = useMutation(api.profiles.upsertProfile);
  const saveAnswers = useMutation(api.questions.answerProfileQuestions);
  const setConsent = useMutation(api.profiles.setLocationConsent);

  const resolveLocation = useAction(api.lookups.resolveLocation);
  const locateTypedLocation = useAction(api.lookups.locateTypedLocation);

  const [values, setValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [companyDomain, setCompanyDomain] = useState("");
  const [wantsRefresh, setWantsRefresh] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Prefill runs once, or every keystroke would be overwritten by the query. */
  const seeded = useRef(false);

  const loading =
    config === undefined ||
    profile === undefined ||
    user === undefined ||
    extraQuestions === undefined ||
    priorAnswers === undefined;

  useEffect(() => {
    if (loading || seeded.current) return;
    seeded.current = true;

    const providerName = (user?.name ?? "").trim();
    const parts = providerName.split(/\s+/).filter(Boolean);
    const providerFirst = parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? "");
    const providerLast = parts.length > 1 ? parts[parts.length - 1] : "";

    setValues({
      firstName: profile?.firstName || providerFirst,
      lastName: profile?.lastName || providerLast,
      email: profile?.email || (user?.email ?? ""),
      phone: profile?.phone ?? "",
      location: profile?.location ?? "",
      address: profile?.address ?? "",
      /*
       * The select holds the admin's LABEL ("2020-2024"); the profile stores
       * the graduating year. Reopening the form therefore has to map back, or
       * a member with batch 2024 would see an empty dropdown and be asked to
       * choose something they already chose.
       */
      batch: batchLabelForYear(
        profile?.batch ?? null,
        (config?.fields ?? []).find((field) => field.key === "batch")?.options ?? [],
      ),
      department: profile?.department ?? "",
      company: profile?.company ?? "",
      workLocation: profile?.workLocation ?? "",
      designation: profile?.designation ?? "",
    });
    setCompanyDomain(profile?.companyDomain ?? "");
    setWantsRefresh(profile?.locationConsent === true);
    setAnswers(
      Object.fromEntries(
        (priorAnswers ?? []).map((row) => [String(row.questionId), row.answer]),
      ),
    );
  }, [loading, profile, user, priorAnswers]);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  /* ---- Location -------------------------------------------------------- */

  async function detectLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("This browser cannot report a location.");
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolveLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
          .then((result) => {
            if (result.label) {
              set("location", result.label);
              toast.success(`Location set to ${result.label}.`);
            } else {
              toast.error(
                "Could not turn that position into a place name. Type it instead.",
              );
            }
          })
          .catch((error) => toast.error(actionErrorMessage(error)))
          .finally(() => setDetecting(false));
      },
      (error) => {
        setDetecting(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Your browser refused the location request. Type it instead."
            : "Could not read a location just now. Type it instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  /* ---- Save ------------------------------------------------------------ */

  const fields: ConfiguredField[] = (config?.fields ?? []) as ConfiguredField[];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    // Only the fields the admin is actually asking for are sent. An absent
    // argument means "leave it alone" — see the note on upsertProfile — so a
    // retired field keeps whatever answer it already had rather than being
    // silently cleared.
    const payload: Record<string, string | number | undefined> = {};
    for (const field of fields) {
      if (field.key === "email") continue;
      const raw = (values[field.key] ?? "").trim();
      if (field.required && !raw) {
        setBusy(false);
        toast.error(`${field.label} is required.`);
        return;
      }
      if (field.key === "batch") {
        // "2020-2024" is submitted as 2024 — see batchYearFromLabel, which is
        // the same rule the server validates with.
        const year = raw ? batchYearFromLabel(raw) : null;
        if (raw && year === null) {
          setBusy(false);
          toast.error(`${field.label} does not name a year. Choose one from the list.`);
          return;
        }
        if (year !== null) payload.batch = year;
        continue;
      }
      payload[field.key] = raw;
    }
    if (fields.some((field) => field.key === "company")) {
      payload.companyDomain = companyDomain;
    }

    try {
      await save(payload as Parameters<typeof save>[0]);

      if ((extraQuestions ?? []).length > 0) {
        await saveAnswers({
          answers: (extraQuestions ?? []).map((question) => ({
            questionId: question._id as Id<"questions">,
            answer: answers[String(question._id)] ?? "",
          })),
        });
      }

      // Consent is applied after the profile exists, because it is stored on
      // that row — there is nothing to attach it to before the first save.
      await setConsent({ consent: wantsRefresh });

      /*
       * Put them on the map.
       *
       * A detected location arrives with the centroid of the place it resolved
       * to; a typed one is just a name, so the name is looked up here. Not
       * awaited into the success path: a geocoder that is slow or down must not
       * make a saved profile look unsaved. The location is already stored — this
       * only decides whether the map can draw it yet, and `presence.map` counts
       * a name without a centroid separately rather than hiding it.
       */
      const typedLocation = (values.location ?? "").trim();
      if (typedLocation) {
        void locateTypedLocation({ label: typedLocation }).catch(() => {
          /* silent: the label is saved either way */
        });
      }

      toast.success(
        mode === "onboarding" ? "Your profile is set up." : "Details saved.",
      );
      if (mode === "onboarding") router.push("/dashboard");
    } catch (error) {
      toast.error(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  /* ---- Render ---------------------------------------------------------- */

  if (loading) {
    return (
      <Card>
        <LoadingRows rows={6} />
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {config?.configured === false ? (
        <div className="rounded-card border border-brass/40 bg-bone p-4">
          <p className={HINT}>
            These are the default fields. Nobody has opened{" "}
            <span className="font-mono">/admin</span> and saved the form
            configuration yet, so an admin can still change every label, option
            and ordering below.
          </p>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Your details</Eyebrow>
            {/*
              The tick is granted, never claimed. `alumni.verified` is written
              only by `access.reviewVerification`, an internalMutation the
              office runs after checking a roll number against college records
              — so nothing a member does on this form can turn it on, and
              re-saving cannot turn it off. Showing the state here is the point:
              this is the page where somebody wonders whether they are verified.
            */}
            {profile?.verified ? (
              <VerifiedMark />
            ) : profile ? (
              <Pill tone="brass">Awaiting verification</Pill>
            ) : null}
          </div>
          <Pill tone="quiet">
            {fields.length} field{fields.length === 1 ? "" : "s"}
          </Pill>
        </div>

        {profile && !profile.verified ? (
          <p className={`mt-2 ${HINT}`}>
            Filling this in does not verify you. The association checks your
            batch and roll number against college records by hand, and the tick
            appears here when they do.
          </p>
        ) : null}

        <div className="mt-5">
          {fields.map((field) => {
            const id = `${uid}-${field.key}`;
            const value = values[field.key] ?? "";

            if (field.kind === "email") {
              return (
                <Row
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  help={field.help}
                  htmlFor={id}
                  aside={<Pill tone="jade">From your sign-in</Pill>}
                >
                  <input id={id} className={READONLY} value={value} readOnly />
                </Row>
              );
            }

            if (field.kind === "select") {
              return (
                <Row
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  help={field.help}
                  htmlFor={id}
                >
                  <select
                    id={id}
                    className={SELECT}
                    value={value}
                    onChange={(event) => set(field.key, event.target.value)}
                  >
                    <option value="">Choose…</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    {/* A value that predates an edit to the option list stays
                        visible rather than silently resetting to "Choose…". */}
                    {value && !field.options.includes(value) ? (
                      <option value={value}>{value} (no longer listed)</option>
                    ) : null}
                  </select>
                </Row>
              );
            }

            if (field.kind === "longText") {
              return (
                <Row
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  help={field.help}
                  htmlFor={id}
                >
                  <textarea
                    id={id}
                    className={`${CONTROL} min-h-24`}
                    value={value}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                </Row>
              );
            }

            if (field.kind === "company") {
              return (
                <Row
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  help={field.help}
                  htmlFor={id}
                >
                  <SuggestBox
                    id={id}
                    kind="company"
                    value={value}
                    placeholder="Start typing your employer"
                    onChange={(next, extra) => {
                      set(field.key, next);
                      if (extra) setCompanyDomain(extra.domain ?? "");
                    }}
                  />
                </Row>
              );
            }

            if (field.kind === "position") {
              return (
                <Row
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  help={field.help}
                  htmlFor={id}
                >
                  <SuggestBox
                    id={id}
                    kind="position"
                    value={value}
                    placeholder="Start typing your role"
                    onChange={(next) => set(field.key, next)}
                  />
                </Row>
              );
            }

            if (field.kind === "location") {
              return (
                <Row
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  help={field.help}
                  htmlFor={id}
                  aside={
                    profile?.locationSource ? (
                      <Pill tone="quiet">
                        {profile.locationSource === "device"
                          ? "Detected"
                          : "Typed by you"}
                      </Pill>
                    ) : null
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <input
                      id={id}
                      className={`${CONTROL} flex-1`}
                      value={value}
                      placeholder="Rajapalayam, Tamil Nadu, India"
                      onChange={(event) => set(field.key, event.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void detectLocation()}
                      disabled={detecting}
                    >
                      {detecting ? "Detecting…" : "Use my current location"}
                    </Button>
                  </div>

                  <label className="mt-3 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[#9b1c31]"
                      checked={wantsRefresh}
                      onChange={(event) => setWantsRefresh(event.target.checked)}
                    />
                    <span className={HINT}>
                      Keep this up to date automatically. Each time you sign in,
                      the portal reads your location from this browser and
                      updates the place above, so a move shows up without you
                      editing anything. Only the place name is stored — never
                      coordinates — and unticking this clears any place that was
                      detected rather than typed.
                    </span>
                  </label>
                </Row>
              );
            }

            return (
              <Row
                key={field.key}
                label={field.label}
                required={field.required}
                help={field.help}
                htmlFor={id}
              >
                <input
                  id={id}
                  className={CONTROL}
                  value={value}
                  inputMode={field.kind === "phone" ? "tel" : undefined}
                  autoComplete={
                    field.key === "firstName"
                      ? "given-name"
                      : field.key === "lastName"
                        ? "family-name"
                        : field.kind === "phone"
                          ? "tel"
                          : "off"
                  }
                  onChange={(event) => set(field.key, event.target.value)}
                />
              </Row>
            );
          })}
        </div>
      </Card>

      {(extraQuestions ?? []).length > 0 ? (
        <Card>
          <Eyebrow>Also asked by the association</Eyebrow>
          <p className={`mt-2 ${HINT}`}>
            These are added and edited by the association in the admin console.
          </p>
          <div className="mt-5">
            {(extraQuestions ?? []).map((question) => {
              const id = `${uid}-q-${String(question._id)}`;
              const value = answers[String(question._id)] ?? "";
              const onChange = (next: string) =>
                setAnswers((prev) => ({ ...prev, [String(question._id)]: next }));

              return (
                <Row
                  key={String(question._id)}
                  label={question.prompt}
                  required={question.required}
                  htmlFor={id}
                >
                  {question.kind === "choice" ? (
                    <select
                      id={id}
                      className={SELECT}
                      value={value}
                      onChange={(event) => onChange(event.target.value)}
                    >
                      <option value="">Choose…</option>
                      {question.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : question.kind === "longText" ? (
                    <textarea
                      id={id}
                      className={`${CONTROL} min-h-24`}
                      value={value}
                      onChange={(event) => onChange(event.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      className={CONTROL}
                      value={value}
                      onChange={(event) => onChange(event.target.value)}
                    />
                  )}
                </Row>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy
            ? "Saving…"
            : mode === "onboarding"
              ? "Save and continue"
              : "Save details"}
        </Button>
        <p className={HINT}>
          You can change any of this later. Questions about a field go to{" "}
          <a
            href={`mailto:${RITAA.email}`}
            className="text-maroon underline decoration-brass/50 underline-offset-4"
          >
            {RITAA.email}
          </a>
          .
        </p>
      </div>
    </form>
  );
}
