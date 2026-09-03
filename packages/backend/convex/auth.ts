import { expo } from "@better-auth/expo";
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;
const nativeAppUrl = process.env.NATIVE_APP_URL || "RIT-ALUMINI://";

export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Every origin a browser may call this auth server from.
 *
 * WHY THIS IS A FUNCTION AND NOT `[siteUrl]`. Better Auth refuses any request
 * whose `Origin` header is not on this list, with a bare `INVALID_ORIGIN` — and
 * one deployment is legitimately served from several origins. A single
 * `SITE_URL` covers exactly one of them, so every other one failed at the
 * moment a member clicked the button, which is the worst possible time to find
 * out and the least informative place to be told.
 *
 * The check only runs when the request carries a cookie, which is why this was
 * invisible to a curl test and immediate in a real browser.
 *
 * THE TRAP WORTH NAMING: `http://localhost:3001` and `http://127.0.0.1:3001`
 * are the same server and two different origins. Typing the other one produced
 * a refusal that looked like broken sign-in, so they are now paired
 * automatically whenever SITE_URL is local — nobody should need to know that to
 * reach a dev server.
 *
 * A DEPLOYED DOMAIN STILL HAS TO BE DECLARED, deliberately:
 *
 *   npx convex env set SITE_URL         https://alumini.ritrjpm.edu.in
 *   npx convex env set TRUSTED_ORIGINS  "https://alumini.ritrjpm.edu.in,http://localhost:3001"
 *
 * TRUSTED_ORIGINS is comma separated and takes the wildcards Better Auth
 * supports, so `https://*-ritaa.vercel.app` covers preview builds. Note what is
 * deliberately absent: a blanket `https://*.vercel.app`. That would let any
 * page on anybody's Vercel project make credentialed calls to this deployment,
 * which is an account-takeover surface traded for one saved env var.
 */
function trustedOrigins(): string[] {
  const origins = new Set<string>();

  const add = (value: string | undefined) => {
    const trimmed = value?.trim().replace(/\/+$/, "");
    if (trimmed) origins.add(trimmed);
  };

  add(siteUrl);
  add(nativeAppUrl);
  // Expo development clients.
  origins.add("exp://");

  for (const value of (process.env.TRUSTED_ORIGINS ?? "").split(",")) add(value);

  try {
    const url = new URL(siteUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const port = url.port ? `:${url.port}` : "";
      add(`http://localhost${port}`);
      add(`http://127.0.0.1${port}`);
    }
  } catch {
    // A malformed SITE_URL is reported by `configuredAuthMethods` rather than
    // thrown here, where it would take every auth route down at once.
  }

  return [...origins];
}

/**
 * Module 1 — social logins, and the ONLY way into the portal.
 *
 * Google and LinkedIn are the two sign-in methods. Email-and-password and
 * one-time codes were both removed: a members' network is only worth joining if
 * the people in it are who they say they are, and a provider-confirmed identity
 * with a real name and a work email attached is a far better starting point than
 * a self-declared address with a password. LinkedIn in particular is where these
 * members already keep the employer and designation this directory asks for.
 *
 * CONSEQUENCE, STATED PLAINLY: with neither provider's credentials set on the
 * deployment, nobody can sign in — there is no fallback any more. Set at least
 * one before launch. `configuredAuthMethods` reports this and the join page says
 * it out loud rather than showing two buttons that fail on click.
 *
 * Each provider is registered only when both of its credentials are present on
 * the deployment. Registering a provider without a client secret makes
 * better-auth fail the whole request at sign-in time, so gating on the env vars
 * is what keeps the configured providers working while the others stay absent.
 *
 * Set them with:
 *   npx convex env set GOOGLE_CLIENT_ID …
 *   npx convex env set GOOGLE_CLIENT_SECRET …
 *   npx convex env set LINKEDIN_CLIENT_ID …
 *   npx convex env set LINKEDIN_CLIENT_SECRET …
 *
 * Redirect/callback URL to register with each provider:
 *   <SITE_URL>/api/auth/callback/google
 *   <SITE_URL>/api/auth/callback/linkedin
 */
function socialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    providers.linkedin = {
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    };
  }
  return providers;
}

/**
 * Lets the sign-in page render only the buttons that will actually work, instead
 * of showing a Google button that dead-ends because no credentials are set.
 *
 * `anyConfigured` exists because it is now the difference between a portal
 * people can join and one nobody can: Google and LinkedIn are the only two ways
 * in, so with neither configured there is no sign-in at all. The join page reads
 * this and says so plainly instead of showing two dead buttons.
 */
export const configuredAuthMethods = query({
  args: {},
  handler: async () => {
    const google = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    );
    const linkedin = Boolean(
      process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET,
    );
    return {
      google,
      linkedin,
      anyConfigured: google || linkedin,
      /*
       * The origin rules, returned so the sign-in screen can check itself.
       *
       * Neither value is a secret: an origin is a public address, and the list
       * is enforced on this side whatever a client believes about it. What they
       * buy is a screen that can say "this deployment does not trust the
       * address you are on, and here is the command" — instead of a member
       * pressing a button and getting INVALID_ORIGIN out of a fetch they cannot
       * see, which is exactly how this went wrong once already.
       */
      siteUrl,
      trustedOrigins: trustedOrigins(),
    };
  },
});

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: trustedOrigins(),
    database: authComponent.adapter(ctx),
    // No emailAndPassword block: passwords are off. Leaving it enabled while the
    // UI offered only social buttons would keep a second, unadvertised way in
    // that nothing on the site tells members about and nobody maintains.
    socialProviders: socialProviders(),
    /**
     * ONE MEMBER, BOTH PROVIDERS.
     *
     * The association wants a member who arrived through Google to add their
     * LinkedIn, and a member who arrived through LinkedIn to add the address
     * Google confirmed — one account either way, and either button gets them
     * back in. That is what account linking is, and these are the three
     * settings it needs.
     *
     * `trustedProviders` names the two. Without it, an implicit link during
     * sign-in falls back to asking whether the incoming provider marked the
     * address verified; both of these do, but relying on a claim when the
     * provider itself is known is the weaker of the two checks.
     *
     * `allowDifferentEmails` is the one that matters here, and it carries a
     * warning in Better Auth worth reading before copying this. THE CASE IT
     * EXISTS FOR IS OURS: a member signs in with a personal Gmail and their
     * LinkedIn carries a work address. Without this, `linkSocial` refuses with
     * a bare UNAUTHORIZED and the member cannot connect the second account at
     * all — see the email comparison in better-auth's /link-social route.
     *
     * WHY IT IS SAFE IN THIS SHAPE, precisely:
     *   - It only relaxes MANUAL linking, which requires an existing session
     *     AND a completed OAuth round trip with the second provider. The person
     *     has just proved control of both accounts.
     *   - A link never rebinds identity: better-auth leaves the local `email`
     *     and `emailVerified` untouched, so the address this portal keys a
     *     profile on cannot be changed by connecting something to it.
     *   - Implicit linking during sign-in still matches on address only. A
     *     provider arriving with a different address therefore gets its own
     *     account rather than joining someone else's — this setting does not
     *     widen that path.
     *
     * `updateUserInfoOnLink` is deliberately left off. It would copy the newly
     * linked provider's name and photograph onto the member's row, and the
     * member's name is theirs to correct on the details form; a link should not
     * quietly rewrite it.
     *
     * Unlinking the last remaining account is refused by better-auth itself
     * (`allowUnlinkingAll` stays at its default), so no member can disconnect
     * their way out of their own account.
     */
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "linkedin"],
        allowDifferentEmails: true,
        /*
         * WHY THIS IS OFF, and why that is safe HERE specifically.
         *
         * Signing in with Google to an address that already had a LinkedIn
         * account failed with `account_not_linked`. The gate is one clause in
         * better-auth's implicit-link check:
         *
         *   requireLocalEmailVerified && !dbUser.user.emailVerified
         *
         * It defaults to true and refuses the link when the EXISTING local row
         * is not marked email-verified. LinkedIn's OIDC response does not
         * reliably carry an `email_verified` claim, so a row created by
         * LinkedIn is stored unverified — and Google could then never attach to
         * it. The member is left unable to sign in with a provider that
         * confirmed their address perfectly well.
         *
         * The attack the default defends against is pre-registration: someone
         * creates an UNVERIFIED account at a victim's address, waits, and has
         * the victim's real OAuth identity linked into the attacker's row.
         * That requires a signup path which mints a user row without proving
         * control of the address. THIS DEPLOYMENT HAS NONE — passwords are not
         * registered (the API answers EMAIL_PASSWORD_SIGN_UP_DISABLED), and
         * forget-password and the email-OTP routes do not exist. The only way a
         * row comes into being is a completed Google or LinkedIn round trip,
         * and both verify the address before releasing it. So every row is
         * provider-confirmed even where the stored flag says otherwise: the
         * flag is a claim-parsing artefact, not evidence.
         *
         * The other clause still stands guard — an UNTRUSTED provider arriving
         * with an unverified claim is refused regardless of this setting.
         *
         * SELF-HEALING, and a note for the upgrade. On a successful link where
         * the provider does assert the address, better-auth writes
         * `emailVerified: true` back to the local row, so each affected member
         * is fixed permanently the first time they use Google. This option is
         * marked deprecated upstream and the gate becomes unconditional in a
         * later minor; by then most rows will have been repaired, but a
         * LinkedIn-only member may still need `emailVerified` set by hand.
         */
        requireLocalEmailVerified: false,
      },
    },
    plugins: [
      expo(),
      crossDomain({ siteUrl }),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});
