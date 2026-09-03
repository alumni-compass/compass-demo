"use client";

import { useState } from "react";
import { toast } from "sonner";

import { actionErrorMessage } from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { RITAA } from "@/lib/site";

/**
 * The sign-in primitives — Google and LinkedIn, and nothing else.
 *
 * WHY ONLY TWO. A members' directory is worth joining only if the people in it
 * are who they say they are. A provider-confirmed identity arrives with a real
 * name, a working address and usually a photograph; a self-declared email and a
 * password arrive with none of that and leave the association hand-checking
 * everything. LinkedIn in particular is where these members already keep the
 * employer and designation this directory asks for, so it is the shortest path
 * from "signed in" to "a profile worth finding".
 *
 * Email-and-password and one-time codes are gone rather than hidden — see
 * `convex/auth.ts`, which no longer registers a password strategy at all. The
 * deployment agrees, and answers so: sign-in/email returns
 * EMAIL_PASSWORD_DISABLED, sign-up/email returns EMAIL_PASSWORD_SIGN_UP_DISABLED,
 * and forget-password and the email-OTP routes are not registered at all. There
 * is no unadvertised second way in.
 *
 * A provider button is interactive only when the server reports credentials for
 * it — see `auth.configuredAuthMethods`. With neither configured there is no
 * sign-in at all, and these components say exactly that instead of showing two
 * buttons that fail on click.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. The marks, the provider list and the
 * redirect are here; no layout is. `sign-in-screen.tsx` draws the buttons for
 * `/join`, and the Expo app draws its own against the same two ids — both call
 * `useProviderSignIn` rather than keeping a copy of the OAuth call, because two
 * copies would be two chances for one of them to stop reporting a failure.
 */

export type AuthMethods = {
  google: boolean;
  linkedin: boolean;
  anyConfigured: boolean;
};

export type ProviderId = "google" | "linkedin";

/** Google's mark, drawn inline — four paths, no external request. */
export function GoogleMark({ className = "size-[18px] shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden>
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

export function LinkedInMark({ className = "size-[18px] shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#0A66C2"
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05a3.75 3.75 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .78 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .78 23.2 0 22.22 0z"
      />
    </svg>
  );
}

export const PROVIDERS = [
  {
    id: "google",
    name: "Google",
    label: "Continue with Google",
    Mark: GoogleMark,
    /** What the member gets from choosing this one. */
    brings: "Confirms your name and email address.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    label: "Continue with LinkedIn",
    Mark: LinkedInMark,
    brings: "Confirms your name, address and current employer.",
  },
] as const;

/**
 * The one place the OAuth round trip is started.
 *
 * TWO KINDS OF FAILURE, both handled. Better Auth's client returns a refusal as
 * a value rather than throwing, so catching only the exception left a rejected
 * sign-in sitting at "Redirecting…" for ever with nothing said. The `catch` is
 * still needed, because a network failure does reject.
 *
 * `pending` is deliberately not cleared on success: the call navigates away to
 * the provider, so the button should stay in its redirecting state until the
 * page unloads.
 *
 * SIGN-IN LANDS ON THE FEED, not the dashboard. The feed is the page a member
 * has a reason to open twice a day; the dashboard is a summary of it. Landing
 * on the summary means every session starts one click away from the thing the
 * member came for.
 */
export function useProviderSignIn(callbackURL = "/feed") {
  const [pending, setPending] = useState<ProviderId | null>(null);

  async function signInWith(provider: ProviderId) {
    setPending(provider);
    try {
      const result = await authClient.signIn.social({ provider, callbackURL });
      if (result?.error) {
        setPending(null);
        toast.error(
          result.error.message ||
            `That provider refused the sign-in. Try the other one, or write to ${RITAA.email}.`,
        );
      }
    } catch (error) {
      setPending(null);
      toast.error(actionErrorMessage(error));
    }
  }

  return { pending, signInWith };
}
