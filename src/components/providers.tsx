"use client";

import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { env } from "@/lib/env";
import { Toaster } from "@/components/ui/sonner";
import { ConvexReactClient } from "convex/react";

import { authClient } from "@/lib/auth-client";

import { ThemeProvider } from "./theme-provider";

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

export default function Providers({
  children,
  initialToken,
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ConvexBetterAuthProvider
        client={convex}
        // @convex-dev/better-auth types its AuthClient prop by feeding
        // `BetterAuthClientPlugin & { plugins }` into createAuthClient, which collapses
        // useSession().data to `never`. Our client is correct at runtime, so cast here.
        authClient={authClient as unknown as AuthClient}
        initialToken={initialToken}
      >
        {children}
      </ConvexBetterAuthProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
