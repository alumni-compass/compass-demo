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
    return { google, linkedin, anyConfigured: google || linkedin };
  },
});

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl, nativeAppUrl, "exp://"],
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
