"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { actionErrorMessage, Pill } from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { RITAA } from "@/lib/site";

/**
 * The sign-in card — Google and LinkedIn, and nothing else.
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
 * `convex/auth.ts`, which no longer registers a password strategy at all. There
 * is no unadvertised second way in.
 *
 * A provider button is interactive only when the server reports credentials for
 * it — see `auth.configuredAuthMethods`. With neither configured there is no
 * sign-in at all, and this card says exactly that instead of showing two buttons
 * that fail on click.
 */

export type AuthMethods = {
  google: boolean;
  linkedin: boolean;
  anyConfigured: boolean;
};

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
  const anyLive = methods?.anyConfigured === true;

  return (
    <div>
      <div className="space-y-3">
        {PROVIDERS.map(({ id, name, label, Mark, brings }) => {
          const live = methods?.[id] === true;
          return (
            <div key={id}>
              <button
                type="button"
                disabled={!live || pending !== null}
                onClick={live ? () => void signInWith(id) : undefined}
                title={
                  live
                    ? undefined
                    : `The association has not added ${name} credentials to this deployment yet.`
                }
                className={`flex min-h-12 w-full items-center justify-center gap-3 rounded-control border text-[0.925rem] transition-all ${
                  live
                    ? "border-line-strong bg-surface text-ink shadow-panel hover:-translate-y-px hover:border-ink/35 hover:shadow-lift"
                    : "cursor-not-allowed border-dashed border-line bg-surface/60 text-slate-soft"
                }`}
              >
                <Mark />
                <span>{pending === id ? "Redirecting…" : label}</span>
              </button>
              <p className="mt-2 text-center text-[0.75rem] leading-snug text-slate-ink">
                {checking
                  ? "Checking this deployment."
                  : live
                    ? brings
                    : `${name} switches on once the association adds its credentials.`}
              </p>
            </div>
          );
        })}
      </div>

      {/* The one case that matters most, said plainly rather than implied. */}
      {!checking && !anyLive ? (
        <div className="mt-6 rounded-card border border-maroon/30 bg-maroon-tint p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="maroon">No sign-in configured</Pill>
          </div>
          <p className="mt-3 text-[0.875rem] leading-relaxed text-ink">
            Google and LinkedIn are the only two ways into the portal, and neither
            has credentials on this deployment yet — so nobody can sign in at the
            moment, including the association.
          </p>
          <p className="mt-2.5 text-[0.85rem] leading-relaxed text-slate-ink">
            Set one of them on the Convex deployment and this card switches on by
            itself. Until then, write to{" "}
            <a
              href={`mailto:${RITAA.email}`}
              className="text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
            >
              {RITAA.email}
            </a>
            .
          </p>
        </div>
      ) : null}

      {!checking && anyLive ? (
        <p className="mt-5 border-t border-line pt-4 text-center text-[0.8rem] leading-snug text-slate-ink">
          Your provider confirms your email address. The association still verifies
          your batch and roll number separately — that is the step below.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The state of the two providers, for a page that wants to report it.
 *
 * Its own component so the join masthead can show it without every caller
 * re-deriving what "live" means from the raw query.
 */
export function MethodPills() {
  const methods = useQuery(api.auth.configuredAuthMethods);

  return (
    <div className="flex flex-wrap gap-2">
      {PROVIDERS.map((provider) => (
        <Pill key={provider.id} tone="dark">
          {provider.name} ·{" "}
          {methods === undefined
            ? "checking"
            : methods[provider.id]
              ? "live"
              : "not configured"}
        </Pill>
      ))}
    </div>
  );
}
