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
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
