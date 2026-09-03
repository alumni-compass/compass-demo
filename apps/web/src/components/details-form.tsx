"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import type { Id } from "@RIT-ALUMINI/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
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
} from "@/components/kit";
import { RITAA } from "@/lib/site";

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
/* The combobox                                                        */
/* ------------------------------------------------------------------ */

/**
 * Type-to-search over a live source, with free text always accepted.
 *
 * The suggestion list is advisory: `onChange` fires on every keystroke, so what
 * the member typed is already the value before any suggestion is picked. That
 * is what makes this safe for employer and position, where no list is complete.
 *
 * Requests are debounced and the response is dropped if a newer keystroke has
 * been typed since it left — otherwise a slow answer for "inf" arrives after a
 * fast one for "infosys" and replaces the better list with the worse one.
 */
function Combobox({
  id,
  value,
  placeholder,
  disabled,
  onChange,
  fetchSuggestions,
}: {
  id: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string, extra?: { domain?: string | null }) => void;
  fetchSuggestions: (
    query: string,
  ) => Promise<Array<{ label: string; hint?: string | null }>>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Array<{ label: string; hint?: string | null }>>(
    [],
  );
  const wrap = useRef<HTMLDivElement>(null);
  /** Incremented per request; a response with a stale token is discarded. */
  const token = useRef(0);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setRows([]);
      return;
    }
    const mine = token.current + 1;
    token.current = mine;
    setBusy(true);
    const timer = setTimeout(() => {
      fetchSuggestions(query)
        .then((results) => {
          if (token.current !== mine) return;
          setRows(results);
          if (results.length > 0) setOpen(true);
        })
        .catch(() => {
          // A suggestion source that fails must not interrupt typing.
          if (token.current === mine) setRows([]);
        })
        .finally(() => {
          if (token.current === mine) setBusy(false);
        });
    }, 250);
    return () => clearTimeout(timer);
    // fetchSuggestions is a stable action reference from convex/react.
  }, [value, fetchSuggestions]);

  return (
    <div className="relative" ref={wrap}>
      <input
        id={id}
        className={CONTROL}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (rows.length > 0) setOpen(true);
        }}
      />
      {busy ? (
        <span className="font-mono absolute right-3 top-1/2 -translate-y-1/2 text-[0.6rem] uppercase tracking-[0.1em] text-slate-soft">
          …
        </span>
      ) : null}

      {open && rows.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-line-strong bg-surface shadow-lift"
        >
          {rows.map((row) => (
            <li key={`${row.label}-${row.hint ?? ""}`} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2.5 text-left text-[0.875rem] text-ink transition-colors hover:bg-bone"
                onClick={() => {
                  onChange(row.label, { domain: row.hint ?? null });
                  setOpen(false);
                }}
              >
                <span>{row.label}</span>
                {row.hint ? (
                  <span className="font-mono shrink-0 text-[0.65rem] text-slate-soft">
                    {row.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          <li className="border-t border-line px-3.5 py-2">
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

  const suggestCompanies = useAction(api.lookups.companies);
  const suggestPositions = useAction(api.lookups.positions);
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
      batch: profile?.batch ? String(profile.batch) : "",
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
        if (raw) payload.batch = Number(raw);
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
          <Eyebrow>Your details</Eyebrow>
          <Pill tone="quiet">
            {fields.length} field{fields.length === 1 ? "" : "s"}
          </Pill>
        </div>

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
                  <Combobox
                    id={id}
                    value={value}
                    placeholder="Start typing your employer"
                    onChange={(next, extra) => {
                      set(field.key, next);
                      if (extra) setCompanyDomain(extra.domain ?? "");
                    }}
                    fetchSuggestions={async (query) => {
                      const rows = await suggestCompanies({ query });
                      return rows.map((row) => ({
                        label: row.name,
                        hint: row.domain,
                      }));
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
                  <Combobox
                    id={id}
                    value={value}
                    placeholder="Start typing your role"
                    onChange={(next) => set(field.key, next)}
                    fetchSuggestions={async (query) => {
                      const rows = await suggestPositions({ query });
                      return rows.map((row) => ({ label: row.title }));
                    }}
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
