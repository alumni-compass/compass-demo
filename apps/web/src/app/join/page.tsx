import type { Metadata } from "next";

import SignInScreen from "@/components/sign-in-screen";
import { RITAA } from "@/lib/site";

/**
 * `/join` — the way into the portal, and nothing else on it.
 *
 * WHAT USED TO BE HERE. The joining narrative: the verification form, the
 * status lookup, the access-model table and the copy explaining the four roles.
 * That was removed deliberately — this route is the sign-in screen now. The
 * consequence is worth stating rather than discovering: nothing in the web app
 * calls `access.requestVerification` or `questions.answerVerificationQuestions`
 * any more, so no member can file a verification request or answer the screening
 * questions from the site, and the admin panel's verification queue will stay
 * empty until some surface files into it again. Both Convex functions are still
 * there and still work from the CLI; only the form is gone.
 *
 * A server component whose only job is the metadata: the screen itself is a
 * client component because every control on it depends on a live Convex query
 * (which providers this deployment has credentials for) and on the session
 * state. Keeping the two apart is what lets this route carry a real title
 * without making the whole page a client entry that cannot export one.
 */
export const metadata: Metadata = {
  title: "Sign in",
  description: `Sign in to the ${RITAA.name} portal with Google or LinkedIn.`,
};

export default function JoinPage() {
  return <SignInScreen />;
}
