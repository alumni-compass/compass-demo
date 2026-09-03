/*
 * Sign-in for the Expo app — the same two providers as the web portal.
 *
 * WHAT THIS REPLACED. Two forms, one for email-and-password sign-in and one for
 * sign-up, both calling `authClient.signIn.email` / `signUp.email`. The shared
 * backend registers no password strategy at all — the deployment answers
 * EMAIL_PASSWORD_DISABLED and EMAIL_PASSWORD_SIGN_UP_DISABLED to those two
 * routes — so both forms could only ever fail. They are gone rather than left
 * behind a warning, and there is no separate sign-up component any more because
 * with OAuth the same button does both.
 *
 * WHAT STILL HAS TO HAPPEN BEFORE THIS WORKS ON A DEVICE, stated plainly rather
 * than implied by a button that fails: the OAuth round trip leaves the app and
 * comes back through the `RIT-ALUMINI://` scheme (`app.json`), which Convex
 * already trusts via `NATIVE_APP_URL` in `convex/auth.ts`. Google and LinkedIn
 * must each also have that native redirect registered on their console beside
 * the web one, or the provider refuses the request. Until then the button
 * reports the provider's refusal instead of pretending to sign anyone in.
 *
 * `@better-auth/expo` (wired in `lib/auth-client.ts`) is what opens the system
 * browser and stores the session in SecureStore; `expo-web-browser` is already
 * a dependency, so nothing further is needed here.
 */
import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Button, Spinner, Surface, useToast } from "heroui-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { authClient } from "@/lib/auth-client";

type ProviderId = "google" | "linkedin";

const PROVIDERS = [
  {
    id: "google",
    name: "Google",
    label: "Continue with Google",
    brings: "Confirms your name and email address.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    label: "Continue with LinkedIn",
    brings: "Confirms your name, address and current employer.",
  },
] as const satisfies ReadonlyArray<{
  id: ProviderId;
  name: string;
  label: string;
  brings: string;
}>;

function messageFrom(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function SignIn() {
  const { toast } = useToast();
  /** Which providers this deployment actually holds credentials for. */
  const methods = useQuery(api.auth.configuredAuthMethods);
  const [pending, setPending] = useState<ProviderId | null>(null);

  async function signInWith(provider: ProviderId) {
    setPending(provider);
    try {
      // Better Auth returns a refusal as a value rather than throwing, so both
      // shapes have to be handled or a rejected sign-in says nothing at all.
      const result = await authClient.signIn.social({ provider, callbackURL: "/" });
      if (result?.error) {
        toast.show({
          variant: "danger",
          label: result.error.message || "That provider refused the sign-in.",
        });
      }
    } catch (error) {
      toast.show({
        variant: "danger",
        label: messageFrom(error, "Could not reach the sign-in service."),
      });
    } finally {
      setPending(null);
    }
  }

  const checking = methods === undefined;
  const anyConfigured = methods?.anyConfigured === true;

  return (
    <Surface variant="secondary" className="p-4 rounded-xl">
      <Text className="text-foreground font-medium">Sign in</Text>
      <Text className="text-muted text-xs mt-1">
        The same button signs you in and creates your account. There is no
        password — Google and LinkedIn are the only two ways in.
      </Text>

      <View className="gap-3 mt-4">
        {PROVIDERS.map((provider) => {
          const live = methods?.[provider.id] === true;
          return (
            <View key={provider.id}>
              <Button
                onPress={() => {
                  void signInWith(provider.id);
                }}
                isDisabled={!live || pending !== null}
              >
                {pending === provider.id ? (
                  <Spinner size="sm" color="default" />
                ) : (
                  <Button.Label>{provider.label}</Button.Label>
                )}
              </Button>
              <Text className="text-muted text-xs mt-1">
                {checking
                  ? "Checking this deployment."
                  : live
                    ? provider.brings
                    : `${provider.name} switches on once the association adds its credentials.`}
              </Text>
            </View>
          );
        })}
      </View>

      {!checking && !anyConfigured ? (
        <Text className="text-danger text-xs mt-3">
          Neither provider has credentials on this deployment, so nobody can sign
          in at the moment — including the association.
        </Text>
      ) : null}
    </Surface>
  );
}
