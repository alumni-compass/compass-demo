"use client";

import { api } from "@RIT-ALUMINI/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import {
  Button,
  Card,
  Empty,
  Eyebrow,
  LoadingRows,
  Meter,
  Monogram,
  PageHeader,
  Pill,
  SectionHead,
  Shell,
  Stat,
} from "@/components/kit";
import { BATCH_YEARS, formatDate, inr, RITAA } from "@/lib/site";

/**
 * Module 8 — a single campaign page, the thing the brief means by "campaign
 * pages by batch/cause".
 *
 * `giving.bySlug` returns the raw document — no progress, no allocated total —
 * so both are derived here, with the goal guarded against zero. bySlug is also
 * what distinguishes the two failure modes a dynamic route has: `undefined`
 * means the query is still in flight, `null` means there is no such campaign,
 * and the two must never render as each other.
 *
 * `givingReports.campaignLedger` supplies the transparency half: this campaign's
 * gifts with anonymity applied server side, the payment rails they arrived on,
 * and the reconciliation between itemised gifts and the treasurer's total.
 *
 * As on the index: no payment gateway exists in this project, and
 * `giving.recordDonation` is a ledger write intended for a verified gateway
 * webhook. It is never called from the browser — the panel below hands the
 * donor's intent to the association by email instead.
 */

type Campaign = NonNullable<FunctionReturnType<typeof api.giving.bySlug>>;
type Ledger = NonNullable<
  FunctionReturnType<typeof api.givingReports.campaignLedger>
>;
type Gift = Ledger["gifts"][number];

const METHODS = [
  { id: "upi", label: "UPI", hint: "GPay, PhonePe, Paytm, any BHIM app" },
  { id: "card", label: "Credit / debit card", hint: "Visa, Mastercard or RuPay" },
  { id: "netbanking", label: "Netbanking", hint: "NEFT, IMPS or a bank transfer" },
  { id: "wallet", label: "Wallet", hint: "Amazon Pay, Mobikwik and similar" },
] as const;

type MethodId = (typeof METHODS)[number]["id"];

const PRESET_AMOUNTS = [500, 1000, 2500, 5000];

const FIELD =
  "w-full border border-line bg-bone px-3 py-2.5 text-[0.9rem] text-ink placeholder:text-slate-ink/60";
const FIELD_LABEL =
  "font-mono block text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Accepts a plain string so ledger rows can be labelled with the same names. */
function methodLabel(id: string) {
  return METHODS.find((m) => m.id === id)?.label ?? id;
}

function giftMailto(input: {
  amountInr: number;
  method: MethodId;
  campaign: string;
  campaignUrl: string;
  donorName: string;
  batch: string;
  anonymous: boolean;
  message: string;
}) {
  const subject = `Gift of ${inr(input.amountInr)} — ${input.campaign}`;
  const body = [
    `I would like to give ${inr(input.amountInr)} to ${RITAA.shortName}.`,
    "",
    `Campaign: ${input.campaign}`,
    ...(input.campaignUrl ? [`Campaign page: ${input.campaignUrl}`] : []),
    `Amount: ${inr(input.amountInr)}`,
    `Preferred payment method: ${methodLabel(input.method)}`,
    `Donor wall name: ${
      input.anonymous
        ? "Withheld — please list this gift as anonymous"
        : input.donorName.trim() || "(not given)"
    }`,
    `Batch: ${input.batch || "(not stated)"}`,
    `Message for the donor wall: ${input.message.trim() || "(none)"}`,
    "",
    "Please send me the payment details for that method and confirm once the gift has been received.",
  ].join("\n");
  return `mailto:${RITAA.email}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

function AllocationBreakdown({
  raisedInr,
  allocated,
  allocations,
}: {
  raisedInr: number;
  allocated: number;
  allocations: readonly { label: string; amountInr: number }[];
}) {
  // Scaled against the larger of raised/allocated so a bar never overflows and
  // an over-committed campaign still reads truthfully. The `1` floor is what
  // keeps a campaign that has raised nothing from dividing by zero.
  const scale = Math.max(raisedInr, allocated, 1);
  const unallocated = raisedInr - allocated;
  const overBy = Math.max(0, -unallocated);

  return (
    <div>
      {allocations.length === 0 ? (
        <p className="text-[0.9rem] leading-relaxed text-slate-ink">
          Nothing has been spent from this fund yet. Each disbursement is published
          here — line item, amount and share of the total — as the association
          releases it.
        </p>
      ) : (
        <ul className="space-y-5">
          {allocations.map((line, i) => {
            const share = line.amountInr / scale;
            return (
              <li key={`${line.label}-${i}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[0.95rem] leading-snug text-ink">
                    {line.label}
                  </span>
                  <span className="font-mono shrink-0 text-[0.85rem] tabular-nums text-ink">
                    {inr(line.amountInr)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 flex-1 bg-bone-deep">
                    <div
                      className="h-full bg-brass"
                      style={{ width: `${Math.min(100, share * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono w-9 shrink-0 text-right text-[0.7rem] tabular-nums text-slate-ink">
                    {Math.round(share * 100)}%
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="font-mono mt-7 space-y-2 border-t border-line pt-5 text-[0.78rem]">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-ink">Raised</dt>
          <dd className="tabular-nums text-ink">{inr(raisedInr)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-ink">Allocated &amp; spent</dt>
          <dd className="tabular-nums text-ink">{inr(allocated)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-ink">
            {overBy > 0 ? "Committed beyond funds raised" : "Still unallocated"}
          </dt>
          <dd
            className={cx("tabular-nums", overBy > 0 ? "text-maroon" : "text-jade")}
          >
            {inr(Math.abs(unallocated))}
          </dd>
        </div>
      </dl>

      {/* Over-allocation is a finding, not a rendering bug: say so in words and
          keep the meter honest rather than letting a bar run off its track. */}
      {overBy > 0 ? (
        <p
          role="status"
          className="mt-5 border border-maroon/30 bg-maroon/8 p-3 text-[0.84rem] leading-relaxed text-ink"
        >
          <span className="font-mono block text-[0.68rem] uppercase tracking-[0.12em] text-maroon">
            Over-allocated
          </span>
          <span className="mt-1 block">
            Published spending is {inr(overBy)} more than this campaign has
            received. Either a gift is still to be reconciled against the ledger,
            or the balance is being met from another fund. Ask the association at{" "}
            {RITAA.email} which applies here.
          </span>
        </p>
      ) : null}

      {raisedInr > 0 ? (
        <div className="mt-5">
          <Meter
            value={allocated / raisedInr}
            label={
              overBy > 0
                ? "Spent of funds raised — over-committed"
                : "Spent of funds raised"
            }
            tone={overBy > 0 ? "maroon" : "brass"}
          />
        </div>
      ) : (
        <p className="font-mono mt-5 text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
          Nothing raised yet — no share to report
        </p>
      )}
    </div>
  );
}

/* ---- Transparent reporting: this campaign's ledger ------------------ */

/**
 * One gift on the ledger.
 *
 * `campaignLedger` has already applied anonymity, so an anonymous row arrives
 * with the "Anonymous donor" label and a null batch — there is no real name here
 * to build a monogram from, which is why the placeholder mark exists.
 */
function GiftEntry({ gift }: { gift: Gift }) {
  return (
    <li className="bg-white p-6">
      <div className="flex items-start gap-4">
        {gift.anonymous ? (
          <span
            aria-hidden
            className="font-mono inline-flex size-12 shrink-0 items-center justify-center border border-line bg-bone text-slate-ink"
          >
            ·
          </span>
        ) : (
          <Monogram name={gift.donorName} />
        )}
        <div className="min-w-0">
          <p className="text-[0.95rem] leading-snug text-ink">{gift.donorName}</p>
          <p className="font-mono mt-1 text-[0.7rem] tabular-nums text-brass">
            {gift.batch ? `Batch ${gift.batch}` : "Batch withheld"} ·{" "}
            {formatDate(gift.createdAt)}
          </p>
        </div>
        <span className="font-mono ml-auto shrink-0 text-[0.9rem] tabular-nums text-maroon">
          {inr(gift.amountInr)}
        </span>
      </div>
      {gift.message ? (
        <p className="mt-4 border-l-2 border-brass/40 pl-3 text-[0.86rem] leading-relaxed text-slate-ink">
          {gift.message}
        </p>
      ) : null}
      <p className="font-mono mt-3 text-[0.66rem] uppercase tracking-[0.12em] text-slate-ink">
        Received by {methodLabel(gift.method)}
      </p>
    </li>
  );
}

/**
 * The campaign's own donor wall plus the reconciliation between gifts listed one
 * by one and the total the treasurer reports. A reader who adds up the list and
 * gets a smaller number deserves the explanation on the page, not a discrepancy.
 */
function CampaignLedgerReport({
  slug,
  donorCount,
  raisedInr,
}: {
  slug: string;
  donorCount: number;
  raisedInr: number;
}) {
  const ledger = useQuery(api.givingReports.campaignLedger, {
    slug,
    giftLimit: 30,
  });

  return (
    <section className="border-y border-line bg-white">
      <Shell className="py-16 sm:py-20">
        <SectionHead
          eyebrow="Transparent reporting"
          title="Gifts on this campaign's ledger"
          lede="Every gift recorded against this campaign, newest first, with the rail it arrived on. Donors who asked to stay anonymous keep their amount and their date, and give up their name and their cohort."
        />

        {ledger === undefined ? (
          <LoadingRows rows={4} />
        ) : ledger === null ? (
          <Empty
            title="This campaign has no ledger yet"
            hint="Nothing has been recorded against it. Gifts appear here once the treasurer confirms a payment."
          />
        ) : (
          <>
            <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-white p-6">
                <Stat
                  value={inr(ledger.itemisedInr)}
                  label="Listed gift by gift"
                />
              </div>
              <div className="bg-white p-6">
                <Stat
                  value={ledger.itemisedGiftCount}
                  label="Gifts on the ledger"
                />
              </div>
              <div className="bg-white p-6">
                <Stat
                  value={inr(ledger.aggregateInr)}
                  label="Recorded in bulk, not itemised"
                />
              </div>
              <div className="bg-white p-6">
                <Stat
                  value={ledger.anonymousGiftCount}
                  label="Given anonymously"
                />
              </div>
            </div>

            <p className="mt-8 max-w-3xl text-[0.9rem] leading-relaxed text-slate-ink">
              The campaign reports {donorCount} donor
              {donorCount === 1 ? "" : "s"} and {inr(raisedInr)} raised.{" "}
              {ledger.aggregateInr > 0
                ? `${ledger.itemisedGiftCount} of those gifts are itemised below; the remaining ${inr(
                    ledger.aggregateInr,
                  )} arrived through batch collections, cheques and campus drives that the treasurer records against the campaign rather than donor by donor.`
                : "Every rupee of that is itemised below."}
            </p>

            {ledger.methodMix.length > 0 ? (
              <div className="mt-10">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-slate-ink">
                  How those gifts arrived
                </p>
                <dl className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                  {ledger.methodMix.map((rail) => (
                    <div key={rail.method} className="bg-white p-5">
                      <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
                        {methodLabel(rail.method)}
                      </dt>
                      <dd className="font-mono mt-1.5 text-[1.05rem] tabular-nums text-ink">
                        {inr(rail.amountInr)}
                      </dd>
                      <dd className="font-mono mt-0.5 text-[0.68rem] tabular-nums text-brass">
                        {rail.giftCount} gift{rail.giftCount === 1 ? "" : "s"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <div className="mt-10">
              {ledger.gifts.length === 0 ? (
                <Empty
                  title="No gifts itemised against this campaign"
                  hint="The total above is what the treasurer has recorded. Individual gifts appear here as they are entered on the register."
                  action={<Button href="#donate">Be the first named gift</Button>}
                />
              ) : (
                <>
                  <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                    {ledger.gifts.map((gift) => (
                      <GiftEntry key={gift._id} gift={gift} />
                    ))}
                  </ul>
                  {/* The query is capped, so say what is on screen rather than
                      letting the count above imply a shorter list is the whole. */}
                  {ledger.itemisedGiftCount > ledger.gifts.length ? (
                    <p className="font-mono mt-4 text-[0.72rem] tabular-nums text-slate-ink">
                      Showing the {ledger.gifts.length} most recent of{" "}
                      {ledger.itemisedGiftCount} itemised gifts. The full register
                      is with the treasurer at {RITAA.email}.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </Shell>
    </section>
  );
}

/** Collects the donor's intent. Never writes to the donations ledger. */
function DonatePanel({ campaignTitle }: { campaignTitle: string }) {
  const [amount, setAmount] = useState("1000");
  const [method, setMethod] = useState<MethodId>("upi");
  const [anonymous, setAnonymous] = useState(false);
  const [donorName, setDonorName] = useState("");
  const [batch, setBatch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftHref, setDraftHref] = useState<string | null>(null);

  const parsed = Number(amount);
  const amountValid = Number.isFinite(parsed) && parsed > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountValid) {
      setDraftHref(null);
      setError(
        "Enter an amount greater than ₹0 — a whole number of rupees, for example 1000.",
      );
      return;
    }
    setError(null);
    const href = giftMailto({
      amountInr: Math.round(parsed),
      method,
      campaign: campaignTitle,
      // The treasurer gets the exact campaign, not a title they have to match.
      campaignUrl: typeof window === "undefined" ? "" : window.location.href,
      donorName,
      batch,
      anonymous,
      message,
    });
    setDraftHref(href);
    window.location.href = href;
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={handleSubmit} noValidate>
        <p className={FIELD_LABEL}>Campaign</p>
        <p className="mt-2 border border-line bg-bone px-3 py-2.5 text-[0.9rem] leading-snug text-ink">
          {campaignTitle}
        </p>

        <fieldset className="mt-6">
          <legend className={FIELD_LABEL}>Amount</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_AMOUNTS.map((preset) => {
              const active = amountValid && Math.round(parsed) === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setAmount(String(preset));
                    setError(null);
                  }}
                  className={cx(
                    "font-mono border px-3 py-1.5 text-[0.72rem] tabular-nums uppercase tracking-[0.12em] transition-colors",
                    active
                      ? "border-maroon bg-maroon text-bone"
                      : "border-line bg-bone text-slate-ink hover:border-brass hover:text-ink",
                  )}
                >
                  {inr(preset)}
                </button>
              );
            })}
          </div>
          <label htmlFor="gift-amount" className="mt-4 block">
            <span className={FIELD_LABEL}>Or another amount (₹)</span>
          </label>
          <input
            id="gift-amount"
            name="amount"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "gift-amount-error" : undefined}
            className={cx(FIELD, "font-mono mt-2 tabular-nums")}
          />
          {error ? (
            <p
              id="gift-amount-error"
              role="alert"
              className="mt-2 text-[0.82rem] leading-snug text-maroon"
            >
              {error}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="mt-6">
          <legend className={FIELD_LABEL}>Payment method</legend>
          <p className="mt-1 text-[0.82rem] leading-snug text-slate-ink">
            Whichever you pick is carried into the request, so the association
            replies with the details for that rail rather than a generic account
            number.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {METHODS.map((option) => (
              <label
                key={option.id}
                className={cx(
                  "flex cursor-pointer items-start gap-2.5 border p-3 transition-colors",
                  method === option.id
                    ? "border-maroon bg-bone"
                    : "border-line bg-bone hover:border-brass",
                )}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.id}
                  checked={method === option.id}
                  onChange={() => setMethod(option.id)}
                  className="mt-0.5 accent-maroon"
                />
                <span>
                  <span className="font-mono block text-[0.72rem] uppercase tracking-[0.12em] text-ink">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[0.78rem] leading-snug text-slate-ink">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="gift-name" className={FIELD_LABEL}>
              Name for the donor wall
            </label>
            <input
              id="gift-name"
              name="donorName"
              type="text"
              autoComplete="name"
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              disabled={anonymous}
              placeholder={anonymous ? "Withheld" : "Optional"}
              className={cx(FIELD, "mt-2 disabled:opacity-50")}
            />
          </div>
          <div>
            <label htmlFor="gift-batch" className={FIELD_LABEL}>
              Your batch
            </label>
            <select
              id="gift-batch"
              name="batch"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              className={cx(FIELD, "font-mono mt-2 tabular-nums")}
            >
              <option value="">Prefer not to say</option>
              {[...BATCH_YEARS].reverse().map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-5 flex items-start gap-2.5">
          <input
            type="checkbox"
            name="anonymous"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="mt-1 accent-maroon"
          />
          <span className="text-[0.88rem] leading-snug text-ink">
            Give anonymously — the gift still counts on the wall, the name does not
            appear.
          </span>
        </label>

        <div className="mt-5">
          <label htmlFor="gift-message" className={FIELD_LABEL}>
            Message for the donor wall
          </label>
          <textarea
            id="gift-message"
            name="message"
            rows={3}
            maxLength={240}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional. A line about why you gave."
            className={cx(FIELD, "mt-2 resize-y")}
          />
          <p className="font-mono mt-1 text-right text-[0.68rem] tabular-nums text-slate-ink">
            {message.length}/240
          </p>
        </div>

        <div className="mt-6 border-t border-line pt-6">
          <p className="font-mono text-[0.72rem] tabular-nums text-ink">
            {amountValid ? inr(Math.round(parsed)) : "₹—"} · {methodLabel(method)} ·{" "}
            {campaignTitle}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit">Send my gift details</Button>
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-ink">
              No payment on this page
            </span>
          </div>
        </div>

        {draftHref ? (
          <div className="mt-5 border border-jade/30 bg-jade/5 p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-jade">
              Email draft opened
            </p>
            <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-ink">
              Your mail app should now hold a message to {RITAA.email} with these
              details. Nothing has been charged. The association replies with the
              payment details for {methodLabel(method)}, and the gift joins this
              campaign&rsquo;s total once the payment is confirmed. If no draft
              opened,{" "}
              <a
                href={draftHref}
                className="text-maroon underline decoration-brass/50 underline-offset-4"
              >
                open it again
              </a>{" "}
              or write to {RITAA.email} directly.
            </p>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

export default function CampaignPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const campaign = useQuery(api.giving.bySlug, { slug });

  // undefined = still loading, null = no such campaign. Kept strictly apart so
  // the not-found state never flashes over a query that is simply in flight.
  if (campaign === undefined) {
    return (
      <>
        <PageHeader
          module="Fundraising & Giving"
          title="Loading campaign"
          lede="Fetching the goal, the donor count and the fund usage record."
        />
        <Shell>
          <section className="py-16 sm:py-20" aria-busy>
            <LoadingRows rows={5} />
          </section>
        </Shell>
      </>
    );
  }

  if (campaign === null) {
    return (
      <>
        <PageHeader
          module="Fundraising & Giving"
          title="That campaign is not on the register"
          lede="The link may be out of date, or the campaign may have been renamed."
        />
        <Shell>
          <section className="py-16 sm:py-20">
            <Empty
              title="No campaign matches this address"
              hint={`Nothing is registered under "${slug}". The giving index lists every campaign the association has run, open and closed.`}
              action={<Button href="/giving">Back to giving</Button>}
            />
          </section>
        </Shell>
      </>
    );
  }

  return <CampaignDetail campaign={campaign} />;
}

function CampaignDetail({ campaign }: { campaign: Campaign }) {
  // bySlug returns the raw document, so derive both figures here — guarding the
  // divide so a goal of zero cannot produce NaN or Infinity.
  const progress =
    campaign.goalInr > 0 ? Math.min(1, campaign.raisedInr / campaign.goalInr) : 0;
  const allocated = campaign.allocations.reduce((s, a) => s + a.amountInr, 0);
  const remaining = Math.max(0, campaign.goalInr - campaign.raisedInr);
  const closed = !campaign.active;

  return (
    <>
      <PageHeader
        module={campaign.cause}
        title={campaign.title}
        lede={campaign.summary}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Both halves of "by batch/cause" are named outright: the cause is the
              module label above, the cohort is here. */}
          {campaign.batch ? (
            <Pill tone="dark">{campaign.batch} batch fund</Pill>
          ) : (
            <Pill tone="dark">Institute-wide</Pill>
          )}
          {/* Jade is too dark to sit on the ink hero, so brass carries both
              positive states — only one of them ever renders. */}
          {progress >= 1 ? (
            <Pill tone="brass">Fully funded</Pill>
          ) : closed ? (
            <Pill tone="dark">Closed</Pill>
          ) : (
            <Pill tone="brass">Open for gifts</Pill>
          )}
          {campaign.closesAt ? (
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-bone/60">
              {closed ? "Closed" : "Closes"} {formatDate(campaign.closesAt)}
            </span>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="#donate" variant="onDark">
            Give to this campaign
          </Button>
          <Button
            href="/giving"
            variant="ghost"
            className="!text-brass-soft hover:!text-bone"
          >
            ← Back to giving
          </Button>
        </div>
      </PageHeader>

      {/* ---- Headline figures -------------------------------------------- */}
      <section className="border-b border-line bg-white">
        <Shell>
          <div className="grid grid-cols-2 gap-8 py-10 sm:grid-cols-4">
            <Stat value={inr(campaign.raisedInr)} label="Raised so far" />
            <Stat value={inr(campaign.goalInr)} label="Goal" />
            <Stat value={campaign.donorCount} label="Donors on record" />
            <Stat
              value={
                closed && progress < 1
                  ? "Closed"
                  : progress >= 1
                    ? "Goal met"
                    : inr(remaining)
              }
              label={
                closed && progress < 1
                  ? "Campaign no longer taking gifts"
                  : progress >= 1
                    ? "Nothing left to raise"
                    : "Still to raise"
              }
            />
          </div>
          <div className="pb-10">
            <Meter
              value={progress}
              label={`${inr(campaign.raisedInr, { compact: true })} of ${inr(
                campaign.goalInr,
                { compact: true },
              )}`}
              tone={progress >= 1 ? "jade" : closed ? "maroon" : "jade"}
            />
          </div>
        </Shell>
      </section>

      {/* ---- Fund usage + donate panel ----------------------------------- */}
      <Shell>
        <section className="py-16 sm:py-20">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.05fr]">
            <div id="usage">
              <SectionHead
                eyebrow="Fund usage tracker"
                title="What this campaign has spent"
                lede="Every line the treasurer has published, measured against the amount raised."
              />
              <div className="border border-line bg-white p-6 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <Eyebrow>{campaign.cause}</Eyebrow>
                  <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] tabular-nums text-slate-ink">
                    {campaign.allocations.length} line
                    {campaign.allocations.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-5">
                  <AllocationBreakdown
                    raisedInr={campaign.raisedInr}
                    allocated={allocated}
                    allocations={campaign.allocations}
                  />
                </div>
              </div>

              <p className="mt-6 text-[0.88rem] leading-relaxed text-slate-ink">
                Unallocated money stays with the campaign until the association
                publishes the next line. Queries about any figure on this page go
                to{" "}
                <a
                  href={`mailto:${RITAA.email}`}
                  className="text-maroon underline decoration-brass/50 underline-offset-4"
                >
                  {RITAA.email}
                </a>
                .
              </p>
            </div>

            <div id="donate">
              <SectionHead
                eyebrow="Make a gift"
                title="UPI, card, netbanking or wallet"
                lede="Pick an amount and how you would rather pay. The association sends the payment details for that method."
              />
              <div className="border border-line bg-white p-6">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-maroon">
                  Read this first
                </p>
                <p className="mt-3 text-[0.92rem] leading-relaxed text-ink">
                  This page does not take payments — there is no payment gateway
                  connected to the portal yet.
                </p>
                <p className="mt-3 text-[0.92rem] leading-relaxed text-slate-ink">
                  The button opens an email to the association with your amount,
                  method and this campaign filled in. RITAA replies with the
                  payment details, you pay through that channel, and the gift is
                  added to this campaign&rsquo;s total and the donor wall only
                  after the treasurer confirms the payment has arrived.
                </p>
              </div>
              <div className="mt-6">
                <DonatePanel campaignTitle={campaign.title} />
              </div>
            </div>
          </div>
        </section>
      </Shell>

      {/* ---- This campaign's ledger, anonymity applied server side -------- */}
      <CampaignLedgerReport
        slug={campaign.slug}
        donorCount={campaign.donorCount}
        raisedInr={campaign.raisedInr}
      />

      {/* ---- Back out ---------------------------------------------------- */}
      <section className="border-t border-line bg-bone-deep">
        <Shell className="py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-[0.9rem] text-slate-ink">
              Every campaign RITAA has run, open and closed, with its own usage
              record.
            </p>
            <Link
              href="/giving"
              className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-maroon hover:text-maroon-deep"
            >
              ← Back to giving
            </Link>
          </div>
        </Shell>
      </section>
    </>
  );
}
