"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useForm } from "@tanstack/react-form";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { Button, Eyebrow, Meter, Pill } from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { RITAA } from "@/lib/site";

/**
 * Module 1 — the sign-in surfaces, split out of `app/join/page.tsx` so the page
 * itself stays readable.
 *
 * Every control here is driven by `api.auth.configuredAuthMethods`, which reports
 * what the deployment actually has credentials for. A provider without
 * credentials is rendered disabled with the reason attached rather than as a
 * button that dead-ends at the OAuth redirect.
 */

export type AuthMethods = {
  emailPassword: boolean;
  google: boolean;
  linkedin: boolean;
  emailOtp: boolean;
};

/** Shared field styling, so the join page and these panels stay identical. */
export const inputClass =
  "w-full border border-line bg-white px-3 py-2.5 text-[0.9rem] text-ink transition-colors placeholder:text-slate-ink/55 focus:border-maroon disabled:cursor-not-allowed disabled:bg-bone disabled:text-slate-ink";
export const labelClass =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";
export const errorClass =
  "font-mono text-[0.7rem] leading-snug tracking-[0.04em] text-maroon";
export const hintClass = "text-[0.8rem] leading-snug text-slate-ink";

/**
 * Convex wraps an Error thrown inside a function with a request id and a stack
 * before it reaches the browser. The sentence the action wrote is the one the
 * member needs to read, so lift that out and show it exactly as written.
 */
export function actionErrorMessage(error: unknown) {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const named = /Uncaught (?:ConvexError|Error):\s*([^\n]+)/.exec(raw);
  if (named?.[1]) return named[1].trim();
  const line = raw
    .split("\n")
    .map((part) => part.trim())
    .find(
      (part) =>
        part.length > 0 &&
        !part.startsWith("[") &&
        !/^at\s/.test(part) &&
        part !== "Server Error",
    );
  return line ?? "That did not go through. Try again in a moment.";
}

/** mm:ss for the one-time-code expiry. */
function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Email + password — the one method that is always on                */
/* ------------------------------------------------------------------ */

/**
 * Same call shape, same zod validators and the same toast handling as
 * `sign-in-form.tsx` / `sign-up-form.tsx`, with the two collapsed into one
 * toggle so the member does not lose their place by navigating away.
 */
export function AccountPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "signin">("create");

  const signUpForm = useForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
        },
        {
          onSuccess: () => {
            router.push("/dashboard");
            toast.success("Sign up successful");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  const signInForm = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: () => {
            router.push("/dashboard");
            toast.success("Sign in successful");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Email &amp; password</Eyebrow>
        <Pill tone="jade">Live</Pill>
      </div>

      {/* Mode toggle — two real buttons, no navigation, no layout shift. */}
      <div
        role="group"
        aria-label="Choose account action"
        className="mt-5 grid grid-cols-2 gap-px border border-line bg-line"
      >
        {(
          [
            { id: "create", label: "Create account" },
            { id: "signin", label: "Sign in" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            aria-pressed={mode === tab.id}
            className={`font-mono px-4 py-2.5 text-[0.72rem] uppercase tracking-[0.12em] transition-colors ${
              mode === tab.id
                ? "bg-ink text-bone"
                : "bg-white text-slate-ink hover:text-maroon"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "create" ? (
        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            signUpForm.handleSubmit();
          }}
        >
          <fieldset className="space-y-5 border-0 p-0">
            <legend className="font-mono mb-4 text-[0.7rem] uppercase tracking-[0.12em] text-ink">
              Create a new account
            </legend>

            <signUpForm.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <label className={labelClass} htmlFor={`signup-${field.name}`}>
                    Full name
                  </label>
                  <input
                    id={`signup-${field.name}`}
                    name={field.name}
                    autoComplete="name"
                    aria-required="true"
                    aria-invalid={field.state.meta.errors.length > 0}
                    className={inputClass}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className={errorClass}>
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </signUpForm.Field>

            <signUpForm.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <label className={labelClass} htmlFor={`signup-${field.name}`}>
                    Email
                  </label>
                  <input
                    id={`signup-${field.name}`}
                    name={field.name}
                    type="email"
                    autoComplete="email"
                    aria-required="true"
                    aria-invalid={field.state.meta.errors.length > 0}
                    className={inputClass}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className={errorClass}>
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </signUpForm.Field>

            <signUpForm.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <label className={labelClass} htmlFor={`signup-${field.name}`}>
                    Password
                  </label>
                  <input
                    id={`signup-${field.name}`}
                    name={field.name}
                    type="password"
                    autoComplete="new-password"
                    aria-required="true"
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby="signup-password-hint"
                    className={inputClass}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <p id="signup-password-hint" className={hintClass}>
                    Minimum eight characters. Stored hashed by better-auth — the
                    association never sees it.
                  </p>
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className={errorClass}>
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </signUpForm.Field>
          </fieldset>

          <signUpForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? "Submitting…" : "Create account"}
              </Button>
            )}
          </signUpForm.Subscribe>
        </form>
      ) : (
        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            signInForm.handleSubmit();
          }}
        >
          <fieldset className="space-y-5 border-0 p-0">
            <legend className="font-mono mb-4 text-[0.7rem] uppercase tracking-[0.12em] text-ink">
              Sign in to an existing account
            </legend>

            <signInForm.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <label className={labelClass} htmlFor={`signin-${field.name}`}>
                    Email
                  </label>
                  <input
                    id={`signin-${field.name}`}
                    name={field.name}
                    type="email"
                    autoComplete="email"
                    aria-required="true"
                    aria-invalid={field.state.meta.errors.length > 0}
                    className={inputClass}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className={errorClass}>
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </signInForm.Field>

            <signInForm.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <label className={labelClass} htmlFor={`signin-${field.name}`}>
                    Password
                  </label>
                  <input
                    id={`signin-${field.name}`}
                    name={field.name}
                    type="password"
                    autoComplete="current-password"
                    aria-required="true"
                    aria-invalid={field.state.meta.errors.length > 0}
                    className={inputClass}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className={errorClass}>
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </signInForm.Field>
          </fieldset>

          <signInForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? "Submitting…" : "Sign in"}
              </Button>
            )}
          </signInForm.Subscribe>
        </form>
      )}

      <p className="mt-6 border-t border-line pt-5 text-[0.85rem] leading-relaxed text-slate-ink">
        Forgotten your password? Reset mail needs the same gateway as one-time
        codes, so until that is configured write to{" "}
        <a
          href={`mailto:${RITAA.email}`}
          className="text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
        >
          {RITAA.email}
        </a>{" "}
        and the secretary will reset it by hand.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Social logins — Google and LinkedIn                                */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  {
    id: "google",
    label: "Continue with Google",
    live: "Redirects to Google, then back to your dashboard.",
    gated:
      "The association has not added a Google OAuth client ID and secret to this deployment yet, so this button would dead-end at the redirect.",
  },
  {
    id: "linkedin",
    label: "Continue with LinkedIn",
    live: "Redirects to LinkedIn, then back to your dashboard.",
    gated:
      "The association has not added LinkedIn OAuth credentials and an approved redirect URI to this deployment yet.",
  },
] as const;

export function ProviderPanel({ methods }: { methods: AuthMethods | undefined }) {
  const [pending, setPending] = useState<string | null>(null);

  async function signInWith(provider: "google" | "linkedin") {
    setPending(provider);
    try {
      await authClient.signIn.social({ provider, callbackURL: "/dashboard" });
    } catch (error) {
      setPending(null);
      toast.error(actionErrorMessage(error));
    }
  }

  const anyLive = methods?.google === true || methods?.linkedin === true;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Social logins</Eyebrow>
        {methods === undefined ? (
          <Pill>Checking</Pill>
        ) : anyLive ? (
          <Pill tone="jade">Live</Pill>
        ) : (
          <Pill tone="brass">Awaiting credentials</Pill>
        )}
      </div>

      <p className="mt-5 text-[0.9rem] leading-relaxed text-slate-ink">
        Signing in with Google or LinkedIn creates the same account as a password
        would — the provider only confirms the email address, and the association
        still verifies your batch and roll number separately.
      </p>

      <div className="mt-6 space-y-6">
        {PROVIDERS.map((provider) => {
          const isLive = methods?.[provider.id] === true;
          const unknown = methods === undefined;
          return (
            <div key={provider.id}>
              <Button
                variant="outline"
                className={
                  isLive
                    ? "w-full"
                    : "w-full border-dashed !border-line !text-slate-ink"
                }
                disabled={!isLive || pending !== null}
                onClick={isLive ? () => void signInWith(provider.id) : undefined}
              >
                {pending === provider.id ? "Redirecting…" : provider.label}
              </Button>
              <p className={`mt-2.5 ${hintClass}`}>
                {unknown
                  ? "Checking whether this deployment has credentials for this provider."
                  : isLive
                    ? provider.live
                    : provider.gated}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-6 border-t border-line pt-5 text-[0.85rem] leading-relaxed text-slate-ink">
        Each provider is registered on the server only when both its client id and
        its secret are present, which is why the buttons above switch on by
        themselves the moment the association supplies them. Nothing else on this
        page changes.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* OTP — proof of control over an email address                       */
/* ------------------------------------------------------------------ */

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

export function OtpPanel({ methods }: { methods: AuthMethods | undefined }) {
  const startOtp = useAction(api.access.startOtp);
  const confirmOtp = useAction(api.access.confirmOtp);

  const [purpose, setPurpose] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);

  // A one-second tick, and only while a code is actually outstanding, so the
  // expiry and the resend cooldown stay truthful without the page ever animating.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sentTo || confirmedFor) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sentTo, confirmedFor]);

  const live = methods?.emailOtp === true;
  const msLeft = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const expired = expiresAt !== null && msLeft === 0;
  const cooldownLeft = sentAt
    ? Math.max(0, OTP_RESEND_COOLDOWN_MS - (now - sentAt))
    : 0;

  async function send() {
    setSendError(null);
    setCodeError(null);

    const parsed = z
      .email("Enter a valid email address, for example name@example.com.")
      .safeParse(email.trim());
    if (!parsed.success) {
      setEmailError(
        parsed.error.issues[0]?.message ?? "Enter a valid email address.",
      );
      document.getElementById("otp-email")?.focus();
      return;
    }
    setEmailError(null);
    setSending(true);
    try {
      const result = await startOtp({ email: parsed.data, purpose });
      const issuedAt = Date.now();
      setSentTo(parsed.data);
      setSentAt(issuedAt);
      setExpiresAt(issuedAt + result.expiresInMinutes * 60_000);
      setNow(issuedAt);
      setCode("");
      setConfirmedFor(null);
      toast.success(`Code sent to ${parsed.data}`);
    } catch (error) {
      // Shown exactly as the server wrote it — cooldown, unconfigured mail, or
      // a rejected address all read as plain sentences.
      setSendError(actionErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError("Enter the six digits from the email — numbers only.");
      document.getElementById("otp-code")?.focus();
      return;
    }
    setConfirming(true);
    try {
      const result = await confirmOtp({ email: sentTo, code: code.trim() });
      if (result.ok) {
        setConfirmedFor(sentTo);
        setCodeError(null);
        toast.success("Email address confirmed");
      } else {
        setCodeError(
          result.reason ?? "That code could not be confirmed. Request a new one.",
        );
      }
    } catch (error) {
      setCodeError(actionErrorMessage(error));
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    setSentTo(null);
    setSentAt(null);
    setExpiresAt(null);
    setCode("");
    setCodeError(null);
    setSendError(null);
    setConfirmedFor(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>One-time code</Eyebrow>
        {methods === undefined ? (
          <Pill>Checking</Pill>
        ) : live ? (
          <Pill tone="jade">Live</Pill>
        ) : (
          <Pill tone="brass">Mail gateway missing</Pill>
        )}
      </div>

      {confirmedFor ? (
        <div className="mt-5">
          <div className="border border-jade/30 bg-jade/8 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="jade">Confirmed</Pill>
              <span className="font-mono text-[0.75rem] text-ink">
                {confirmedFor}
              </span>
            </div>
            <p className="mt-3 text-[0.9rem] leading-relaxed text-ink">
              You control this address. The association can now use it for
              verification correspondence, RSVP reminders and password resets.
            </p>
            <p className="mt-3 text-[0.85rem] leading-relaxed text-slate-ink">
              This did <strong className="text-ink">not</strong> sign you in. The
              better-auth server on this deployment has no OTP sign-in plugin, so a
              code proves ownership of the address and nothing more — use your
              password, or a social provider, to open a session.
            </p>
          </div>
          <div className="mt-5">
            <Button variant="outline" onClick={reset}>
              Confirm another address
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-5 text-[0.9rem] leading-relaxed text-slate-ink">
            A six-digit code is emailed to the address you give and is valid for ten
            minutes. Only a hash of it is stored on the server, so the code cannot be
            read back out of the database.
          </p>

          <fieldset className="mt-6 border-0 p-0" disabled={!live}>
            <legend className="font-mono mb-3 text-[0.7rem] uppercase tracking-[0.12em] text-ink">
              What is the code for?
            </legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(
                [
                  { id: "signup", label: "A new account" },
                  { id: "signin", label: "An account I already have" },
                ] as const
              ).map((choice) => (
                <label
                  key={choice.id}
                  htmlFor={`otp-purpose-${choice.id}`}
                  className="flex items-center gap-2 text-[0.875rem] text-ink"
                >
                  <input
                    id={`otp-purpose-${choice.id}`}
                    type="radio"
                    name="otp-purpose"
                    value={choice.id}
                    checked={purpose === choice.id}
                    onChange={() => setPurpose(choice.id)}
                    className="size-4 accent-maroon"
                  />
                  {choice.label}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Its own form, so Enter in the field requests the code. */}
          <form
            className="mt-6 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className={labelClass} htmlFor="otp-email">
              Email address
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="otp-email"
                name="otp-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                disabled={!live || sending}
                aria-required="true"
                aria-invalid={emailError !== null}
                aria-describedby={emailError ? "otp-email-error" : undefined}
                className={inputClass}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(null);
                }}
              />
              <Button
                type="submit"
                disabled={!live || sending}
                className="shrink-0"
              >
                {sending ? "Sending…" : sentTo ? "Resend code" : "Email me a code"}
              </Button>
            </div>
            {emailError ? (
              <p id="otp-email-error" className={errorClass}>
                {emailError}
              </p>
            ) : null}
            {!live ? (
              <p className={hintClass}>
                {methods === undefined
                  ? "Checking whether this deployment can send mail."
                  : "Email delivery is not configured on this deployment yet, so no code can be sent. The association needs to add a transactional mail key before this turns on."}
              </p>
            ) : sentTo && cooldownLeft > 0 ? (
              <p className={hintClass}>
                A new code can be requested in {Math.ceil(cooldownLeft / 1000)}s.
              </p>
            ) : null}
          </form>

          {sendError ? (
            <p role="alert" className={`mt-4 ${errorClass}`}>
              {sendError}
            </p>
          ) : null}

          {sentTo ? (
            <form className="mt-7 border-t border-line pt-6" onSubmit={confirm}>
              <fieldset className="border-0 p-0">
                <legend className="font-mono mb-3 text-[0.7rem] uppercase tracking-[0.12em] text-ink">
                  Enter the code sent to {sentTo}
                </legend>

                <div className="space-y-2">
                  <label className={labelClass} htmlFor="otp-code">
                    Six-digit code
                  </label>
                  <input
                    id="otp-code"
                    name="otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    aria-required="true"
                    aria-invalid={codeError !== null}
                    aria-describedby={codeError ? "otp-code-error" : "otp-code-hint"}
                    className={`${inputClass} font-mono text-center text-lg tabular-nums tracking-[0.5em]`}
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                      setCodeError(null);
                    }}
                  />
                  {codeError ? (
                    <p id="otp-code-error" role="alert" className={errorClass}>
                      {codeError}
                    </p>
                  ) : (
                    <p id="otp-code-hint" className={hintClass}>
                      Five wrong attempts invalidate the code and you will need a new
                      one.
                    </p>
                  )}
                </div>

                <div className="mt-5">
                  <Meter
                    value={msLeft / OTP_TTL_MS}
                    label={expired ? "Code expired" : `Expires in ${clock(msLeft)}`}
                    tone={expired ? "maroon" : "brass"}
                  />
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Button type="submit" disabled={confirming || expired}>
                    {confirming ? "Checking…" : "Confirm code"}
                  </Button>
                  <Button variant="outline" onClick={reset}>
                    Start over
                  </Button>
                </div>

                {expired ? (
                  <p className={`mt-4 ${hintClass}`}>
                    Ten minutes have passed. Request a new code with the button
                    above.
                  </p>
                ) : null}
              </fieldset>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
