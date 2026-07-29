"use client";

import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import { actionErrorMessage, type AuthMethods } from "./auth-panels";

/**
 * The sign-up / log-in card.
 *
 * Follows the order alumni platforms have settled on (and that iitmaa.org uses):
 * the social buttons come first because they are the path most members take, then
 * an "or" rule, then the email form for anyone without a Google or LinkedIn
 * account. Leading with the form buries the one-click route.
 *
 * A provider button is only interactive when the server reports credentials for
 * it — see `auth.configuredAuthMethods`. Unconfigured providers render visibly
 * unavailable rather than failing after the click.
 */

/** Google's mark, drawn inline — four paths, no external request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] shrink-0" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden>
      <path
        fill="#0A66C2"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05a3.75 3.75 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .78 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .78 23.2 0 22.22 0z"
      />
    </svg>
  );
}

const PROVIDERS = [
  { id: "google", label: "Continue with Google", Mark: GoogleMark },
  { id: "linkedin", label: "Continue with LinkedIn", Mark: LinkedInMark },
] as const;

export function SocialButtons({ methods }: { methods: AuthMethods | undefined }) {
  const [pending, setPending] = useState<string | null>(null);

  async function signInWith(provider: "google" | "linkedin") {
    setPending(provider);
    try {
      // Redirects away on success, so `pending` is only cleared on failure.
      await authClient.signIn.social({ provider, callbackURL: "/dashboard" });
    } catch (error) {
      setPending(null);
      toast.error(actionErrorMessage(error));
    }
  }

  const checking = methods === undefined;
  const anyLive = methods?.google === true || methods?.linkedin === true;

  return (
    <div>
      <div className="space-y-3">
        {PROVIDERS.map(({ id, label, Mark }) => {
          const live = methods?.[id] === true;
          return (
            <button
              key={id}
              type="button"
              disabled={!live || pending !== null}
              onClick={live ? () => void signInWith(id) : undefined}
              title={
                live
                  ? undefined
                  : `The association has not added ${id === "google" ? "Google" : "LinkedIn"} credentials to this deployment yet.`
              }
              className={`flex min-h-12 w-full items-center justify-center gap-3 border text-[0.925rem] transition-colors ${
                live
                  ? "border-ink/20 bg-white text-ink hover:border-ink/40 hover:bg-bone"
                  : "cursor-not-allowed border-dashed border-line bg-white/60 text-slate-ink"
              }`}
            >
              <Mark />
              <span>{pending === id ? "Redirecting…" : label}</span>
            </button>
          );
        })}
      </div>

      {/* One honest line, rather than a note under each button. */}
      <p className="mt-3 text-center text-[0.8rem] leading-snug text-slate-ink">
        {checking
          ? "Checking which sign-in methods this deployment has."
          : anyLive
            ? "Your provider confirms your email address. The association still verifies your batch and roll number separately."
            : "Google and LinkedIn switch on by themselves once the association adds their credentials. Use an email and password until then."}
      </p>
    </div>
  );
}

/** The "or" rule between the social buttons and the email form. */
export function OrDivider() {
  return (
    <div className="my-7 flex items-center gap-4" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-slate-ink">
        or
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
