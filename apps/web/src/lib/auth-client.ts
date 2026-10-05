import { signInDemo, signOutDemo } from "@/lib/standalone/session";

/**
 * Local stand-in for the old Convex / Better Auth client.
 *
 * Sign-in does not leave the browser. It opens the preview session as Meera Iyer,
 * a sample admin, so every screen can be used without a backend.
 */
export const authClient = {
  signIn: {
    social: async ({ callbackURL }: { provider: string; callbackURL?: string }) => {
      signInDemo();
      if (typeof window !== "undefined" && callbackURL) {
        window.location.assign(callbackURL);
      }
      return { error: null as { message?: string } | null };
    },
  },
  signOut: async (options?: { fetchOptions?: { onSuccess?: () => void } }) => {
    signOutDemo();
    options?.fetchOptions?.onSuccess?.();
  },
  listAccounts: async () => ({
    data: [{ providerId: "google", accountId: "preview" }],
    error: null as { message?: string } | null,
  }),
  linkSocial: async (_args: { provider: string; callbackURL?: string }) => ({
    error: {
      message: "This preview keeps one local session. Linking another provider is not available.",
    },
  }),
  unlinkAccount: async (_args: { providerId: string }) => ({
    error: null as { message?: string } | null,
  }),
};
