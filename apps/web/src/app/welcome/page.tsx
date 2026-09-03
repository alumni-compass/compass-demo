"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import Link from "next/link";

import ConnectedAccounts from "@/components/connected-accounts";
import DetailsForm from "@/components/details-form";
import {
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  PageHeader,
  Pill,
  Shell,
} from "@/components/kit";

/**
 * `/welcome` — the step after signing in, and the place to edit it afterwards.
 *
 * WHY IT IS ITS OWN ROUTE. The details form is the same whether a member is
 * filling it for the first time or correcting a phone number two years later,
 * so it is one route in two moods rather than two forms that would drift. The
 * copy at the top changes; the form does not.
 *
 * WHAT IT DOES NOT DO. It does not redirect. A member who has finished the form
 * and lands here again sees that they have finished it, with their answers in
 * the boxes — bouncing them to the dashboard would make the "edit your details"
 * link from the dashboard useless the moment it worked.
 */
/** The verified state, as the masthead pill. */
function VerifiedPill() {
  const profile = useQuery(api.profiles.byEmail);
  if (profile === undefined || profile === null) return null;
  return profile.verified ? (
    <Pill tone="jade">Verified alumnus</Pill>
  ) : (
    <Pill tone="dark">Not verified yet</Pill>
  );
}

function Completeness() {
  const status = useQuery(api.profiles.completeness);

  if (status === undefined) return null;

  if (!status.hasProfile) {
    return (
      <Pill tone="maroon">
        Not filled in yet · {status.total} question
        {status.total === 1 ? "" : "s"}
      </Pill>
    );
  }
  if (status.missing.length === 0) {
    return (
      <Pill tone="jade">
        Complete · {status.answered} of {status.total} answered
      </Pill>
    );
  }
  return (
    <Pill tone="brass">
      {status.missing.length} still required:{" "}
      {status.missing.map((field) => field.label).join(", ")}
    </Pill>
  );
}

export default function WelcomePage() {
  return (
    <>
      <PageHeader
        image="/campus-2.jpg"
        module="Module 02 · Alumni profiles"
        title="Your details."
        lede="Your name and address came from the account you signed in with. The rest is what makes you findable in the directory — and the association can change what is asked here without a new release."
      >
        <Authenticated>
          <div className="flex flex-wrap gap-2">
            <Completeness />
            <VerifiedPill />
          </div>
        </Authenticated>
      </PageHeader>

      <Shell className="py-14 sm:py-18">
        <AuthLoading>
          <Card>
            <LoadingRows rows={6} />
          </Card>
        </AuthLoading>

        <Unauthenticated>
          <Empty
            title="Sign in first"
            hint="This form is attached to the account you sign in with, so there is nothing to fill in until there is a session."
            action={<Button href="/join">Sign in to RITAA</Button>}
          />
        </Unauthenticated>

        <Authenticated>
          <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-start">
            <div className="space-y-6">
              {/* Above the fields, because it is the half of the profile the
                  member cannot type: whichever provider they did not sign in
                  with is the one carrying the details the other one lacks. */}
              <Card>
                <ConnectedAccounts callbackURL="/welcome" />
              </Card>

              <DetailsForm mode="onboarding" />
            </div>

            <Card className="hover:border-line">
              <Eyebrow>What happens with this</Eyebrow>
              <ul className="mt-3 space-y-3 text-[0.875rem] leading-relaxed text-slate-ink">
                <li>
                  <strong className="text-ink">The directory</strong> shows your
                  name, batch, department, position and employer to other signed-in
                  members.
                </li>
                <li>
                  <strong className="text-ink">Your phone and address</strong> stay
                  private. Contact fields are opt-in, one by one, from your
                  profile page — absent means private, never the other way round.
                </li>
                <li>
                  <strong className="text-ink">Your location</strong> is only
                  detected if you ask for it, and only kept up to date on each
                  sign-in if you tick the box. The place name is stored; the
                  coordinates are not.
                </li>
                <li>
                  <strong className="text-ink">Being verified</strong> is separate.
                  Filling this in does not make you a verified alumnus — the
                  association checks batch and roll number against college
                  records by hand.
                </li>
              </ul>
              <p className="mt-5 border-t border-line pt-4 text-[0.85rem] leading-relaxed text-slate-ink">
                Bio, skills, industries, mentorship and the per-field privacy
                switches live on{" "}
                <Link
                  href="/profile"
                  className="text-maroon underline decoration-brass/50 underline-offset-4"
                >
                  your profile
                </Link>
                .
              </p>
            </Card>
          </div>
        </Authenticated>
      </Shell>
    </>
  );
}
