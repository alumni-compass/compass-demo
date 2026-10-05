import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const convexUrlSchema = (exampleHost: string) =>
  z.url().refine((url) => new URL(url).hostname !== exampleHost, {
    message: `Replace the ${exampleHost} placeholder before running the app`,
  });

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    EXPO_PUBLIC_CONVEX_URL: convexUrlSchema("example.convex.cloud"),
    EXPO_PUBLIC_CONVEX_SITE_URL: convexUrlSchema("example.convex.site"),
  },
  // Each variable must be referenced explicitly, exactly as web.ts does.
  // babel-preset-expo inlines EXPO_PUBLIC_* only at direct static member
  // accesses like `process.env.EXPO_PUBLIC_CONVEX_URL`; handing it the whole
  // `process.env` object leaves nothing to rewrite, so in a release bundle the
  // values are absent, validation throws at module load and the app crashes on
  // launch. It only appears to work in dev because the Expo runtime populates
  // process.env there.
  runtimeEnv: {
    EXPO_PUBLIC_CONVEX_URL: process.env.EXPO_PUBLIC_CONVEX_URL,
    EXPO_PUBLIC_CONVEX_SITE_URL: process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  },
  emptyStringAsUndefined: true,
});
