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
 * Module 1 — social logins (Google, LinkedIn).
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
 */
export const configuredAuthMethods = query({
  args: {},
  handler: async () => ({
    emailPassword: true,
    google: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    linkedin: Boolean(
      process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET,
    ),
    /** OTP needs a mail sender; see access.ts startOtp. */
    emailOtp: Boolean(process.env.RESEND_API_KEY),
  }),
});

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl, nativeAppUrl, "exp://"],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: socialProviders(),
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
