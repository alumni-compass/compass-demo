"use client";

import { api } from "@convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import RitLogo from "@/components/rit-logo";
import {
  type ProviderId,
  PROVIDERS,
  useProviderSignIn,
} from "@/components/sign-in-card";
import { authClient } from "@/lib/auth-client";
import { RITAA } from "@/lib/site";

/**
 * The sign-in screen — the whole of `/join`.
 *
 * THE SHAPE. One centred panel that fills the viewport and is split in two on a
 * wide screen: a photograph on the left, the sign-in column on the right, both
 * inset inside a single rounded card that floats on the paper ground. Below
 * `lg` the photograph is dropped rather than stacked — on a phone it would push
 * the buttons below the fold, and the buttons are the entire purpose of the
 * screen. A back link to the site sits outside the card, top left, because the
 * site header and footer are withheld from this route (see `chrome-slot.tsx`):
 * a sign-in screen carrying eight nav links is a screen offering eight ways to
 * not sign in.
 *
 * TWO BUTTONS, AND WHAT SITS BETWEEN THEM. The rule reading "or" between Google
 * and LinkedIn is where a password form would be on most sites. There is none
 * here, so what would have been "or with email" is simply the choice between
 * the two providers — see `sign-in-card.tsx` for why those are the only two,
 * and `convex/auth.ts` for the backend that registers nothing else.
 *
 * EVERY STATE IS THE REAL ONE. The buttons read their provider's live
 * configuration off `auth.configuredAuthMethods`: a provider with no credentials
 * on the deployment renders disabled with the reason attached, and with neither
 * configured the screen says nobody can sign in at all rather than showing two
 * controls that fail on click. A visitor who already has a session is not sent
 * away silently either — they are told, and handed the way onward. While the
 * session is still resolving the buttons render as their own outline, so nothing
 * moves when they arrive.
 */

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

/** The rule with a word in it. Between the two providers, not before a form. */
function OrRule() {
  return (
    <div className="font-mono flex items-center gap-3 text-[0.625rem] uppercase tracking-[0.22em] text-slate-soft">
      <span aria-hidden className="h-px flex-1 bg-line" />
      or
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

function ProviderButton({
  provider,
  live,
  pending,
  busy,
  onSignIn,
}: {
  provider: (typeof PROVIDERS)[number];
  live: boolean;
  pending: boolean;
  busy: boolean;
  onSignIn: (id: ProviderId) => void;
}) {
  const { id, name, label, Mark } = provider;

  return (
    <div>
      <button
        type="button"
        disabled={!live || busy}
        onClick={live ? () => onSignIn(id) : undefined}
        title={
          live
            ? undefined
            : `The association has not added ${name} credentials to this deployment yet.`
        }
        className={`flex h-12 w-full items-center justify-center gap-3 rounded-xl border text-[0.925rem] transition-all ${
          live
            ? "border-line-strong bg-surface text-ink shadow-panel hover:-translate-y-px hover:border-ink/35 hover:bg-bone hover:shadow-lift disabled:translate-y-0 disabled:opacity-60 disabled:shadow-panel"
            : "cursor-not-allowed border-dashed border-line bg-surface/60 text-slate-soft"
        }`}
      >
        <Mark className="size-5 shrink-0" />
        <span>{pending ? "Redirecting…" : label}</span>
      </button>
      {live ? null : (
        <p className="mt-2 text-center text-[0.75rem] leading-snug text-slate-ink">
          {name} switches on once the association adds its credentials.
        </p>
      )}
    </div>
  );
}

/** The two providers, the rule between them, and whatever state they are in. */
function ProviderStack() {
  const methods = useQuery(api.auth.configuredAuthMethods);
  const { pending, signInWith } = useProviderSignIn();

  const checking = methods === undefined;
  const anyLive = methods?.anyConfigured === true;
  const [google, linkedin] = PROVIDERS;

  return (
    <div className="space-y-4">
      <ProviderButton
        provider={google}
        live={methods?.google === true}
        pending={pending === "google"}
        busy={pending !== null}
        onSignIn={signInWith}
      />
      <OrRule />
      <ProviderButton
        provider={linkedin}
        live={methods?.linkedin === true}
        pending={pending === "linkedin"}
        busy={pending !== null}
        onSignIn={signInWith}
      />

      {checking ? (
        <p className="text-center text-[0.75rem] leading-snug text-slate-ink">
          Checking which providers this deployment has credentials for.
        </p>
      ) : null}

      {!checking && anyLive ? (
        <p className="text-[0.78rem] leading-relaxed text-slate-ink">
          Your provider confirms your name and email address; LinkedIn also brings
          across your employer and designation. The same button signs you in and
          creates your account.
        </p>
      ) : null}

      {/* The case that matters most, said plainly rather than implied. */}
      {!checking && !anyLive ? (
        <div className="rounded-card border border-maroon/30 bg-maroon-tint p-4">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-maroon">
            No sign-in configured
          </p>
          <p className="mt-2 text-[0.85rem] leading-relaxed text-ink">
            Google and LinkedIn are the only two ways into the portal, and neither
            has credentials on this deployment — so nobody can sign in at the
            moment, including the association.
          </p>
          <p className="mt-2 text-[0.8rem] leading-relaxed text-slate-ink">
            Write to{" "}
            <a
              href={`mailto:${RITAA.email}`}
              className="text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
            >
              {RITAA.email}
            </a>
            . Setting either provider on the deployment switches this screen on by
            itself.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The shape of the buttons, while the session is still resolving. */
function ProviderSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-12 animate-pulse rounded-xl bg-surface-sunk" />
      <OrRule />
      <div className="h-12 animate-pulse rounded-xl bg-surface-sunk" />
    </div>
  );
}

/** What an existing session sees. Not a silent redirect — a sentence and a way on. */
function SignedInPanel() {
  const router = useRouter();
  const user = useQuery(api.auth.getCurrentUser);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-line bg-bone p-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-jade">
          Already signed in
        </p>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink">
          {user?.email
            ? `This browser already has a session for ${user.email}.`
            : "This browser already has a session."}
        </p>
      </div>
      <Link
        href="/dashboard"
        className="font-mono flex h-12 w-full items-center justify-center rounded-xl bg-maroon text-[0.7rem] uppercase tracking-[0.12em] text-bone shadow-panel transition-colors hover:bg-maroon-deep"
      >
        Continue to dashboard
      </Link>
      <button
        type="button"
        onClick={() =>
          void authClient.signOut({
            fetchOptions: { onSuccess: () => router.refresh() },
          })
        }
        className="flex h-11 w-full items-center justify-center rounded-xl border border-line text-[0.875rem] text-slate-ink transition-colors hover:border-line-strong hover:text-ink"
      >
        Not you? Sign out
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The screen                                                         */
/* ------------------------------------------------------------------ */

export default function SignInScreen() {
  return (
    <div className="fixed inset-0 z-[60] grid h-svh w-screen place-items-center overflow-hidden bg-bone px-4 py-4 sm:px-6 sm:py-6">
      <Link
        href="/"
        className="absolute left-5 top-5 z-10 flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-[0.875rem] text-slate-ink transition-colors hover:bg-surface hover:text-ink sm:left-7 sm:top-7"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4 stroke-current"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 3L2.5 8 7 13M2.5 8h11" />
        </svg>
        <span>Home</span>
      </Link>

      <div className="grid h-full max-h-[748px] w-full max-w-[1480px] grid-cols-1 gap-5 overflow-hidden rounded-[28px] border border-line bg-surface p-5 shadow-[0_24px_70px_-30px_rgb(21_26_46/0.22)] sm:gap-7 sm:p-6 lg:grid-cols-2 lg:gap-8">
        {/* The photograph. Dropped below lg — see the note at the top. */}
        <div className="relative hidden h-full overflow-hidden rounded-2xl bg-surface-sunk lg:block">
          {/* Local static asset, so a plain <img> avoids a needless loader hop. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/campus-3.jpg"
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover object-center"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 p-8">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-brass-soft">
              {RITAA.institute} · Estd {RITAA.established}
            </p>
            <p className="font-display mt-2 max-w-sm text-[1.35rem] leading-snug text-bone">
              A directory is worth joining only if the people in it are who they
              say they are.
            </p>
          </div>
        </div>

        {/* The sign-in column.
            Centred by `min-h-full` on an inner wrapper rather than
            `items-center` on the scroll container: a centred flex child that
            outgrows its scrollport has its overflowing top clipped and
            unreachable, which on a short screen would be the heading and the
            first provider button. This way it centres when there is room and
            scrolls from the top when there is not. */}
        <div className="relative h-full overflow-y-auto px-2 sm:px-4 lg:px-6">
          <div className="flex min-h-full flex-col justify-center">
            <div className="mx-auto w-full max-w-md py-8">
              <div className="flex items-center gap-3">
                <RitLogo className="size-11" />
                <span className="leading-none">
                  <span className="font-display block text-lg tracking-tight text-ink">
                    {RITAA.shortName}
                  </span>
                  <span className="font-mono block text-[0.6rem] uppercase tracking-[0.16em] text-slate-ink">
                    Alumni Association
                  </span>
                </span>
              </div>

              <div className="mt-8 space-y-1.5">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-brass-ink">
                  Welcome back
                </p>
                <h1 className="font-display text-[1.75rem] leading-[1.1] tracking-tight text-ink sm:text-[2rem] sm:leading-[1.05]">
                  Sign in to {RITAA.shortName}
                </h1>
                <p className="text-[0.9rem] leading-relaxed text-slate-ink">
                  Pick up where you left off.
                </p>
              </div>

              <div className="mt-8">
                <AuthLoading>
                  <ProviderSkeleton />
                </AuthLoading>
                <Unauthenticated>
                  <ProviderStack />
                </Unauthenticated>
                <Authenticated>
                  <SignedInPanel />
                </Authenticated>
              </div>

              <p className="mt-8 border-t border-line pt-5 text-[0.85rem] leading-relaxed text-slate-ink">
                New to {RITAA.shortName}? The same two buttons sign you up — an
                account is created the first time you use one.{" "}
                <Link
                  href="/about"
                  className="text-maroon underline decoration-brass/50 underline-offset-4 transition-colors hover:text-maroon-deep"
                >
                  What the association does
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
